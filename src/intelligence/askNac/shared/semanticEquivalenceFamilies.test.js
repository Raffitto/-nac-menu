/**
 * Semantic equivalence families — many utterances, one canonical meaning.
 */
const path = require("path");
const { execFileSync } = require("child_process");
const {
  parseVaultPeriodFromQuestion,
  parseVaultComparePeriodsFromQuestion,
} = require("../vault/vaultPeriodParser");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");
const REF = new Date("2026-08-14T16:16:00.000Z");

function run(body) {
  const script = `
    global.Deno = { env: { get: () => undefined } };
    import(${JSON.stringify(fabricPath)}).then(async (mod) => {
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out));
    }).catch((err) => { console.error(err); process.exit(1); });
  `;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  }).trim());
}

function periodOf(q) {
  return parseVaultPeriodFromQuestion(q, REF);
}

describe("A. exact-day equivalence", () => {
  const expected = "2026-08-13";
  test.each([
    "yesterday",
    "yesterday's sales",
    "how did we do yesterday",
    "sales for yesterday",
    "the day before today",
    "sales a day ago",
    "sales one day ago",
  ])("%s → 13 Aug", (q) => {
    const p = periodOf(q);
    expect(p?.startDate).toBe(expected);
    expect(p?.endDate).toBe(expected);
    expect(p?.isSingleDay).toBe(true);
  });
});

describe("B. range equivalence", () => {
  test.each([
    "Aug 9 to Aug 13",
    "9–13 Aug",
    "from the 9th through the 13th Aug",
    "between 9 and 13 August",
    "sales 9 to 13 Aug",
  ])("%s → 9–13 Aug 2026", (q) => {
    const p = periodOf(q);
    expect(p?.startDate).toBe("2026-08-09");
    expect(p?.endDate).toBe("2026-08-13");
  });
});

describe("C. month equivalence", () => {
  test.each([
    "June",
    "jun",
    "June 2026",
    "what about June",
    "how was June",
  ])("%s → June 2026", (q) => {
    const p = periodOf(q);
    expect(p?.startDate).toBe("2026-06-01");
    expect(p?.endDate).toBe("2026-06-30");
  });

  test("this month / MTD share start", () => {
    const a = periodOf("this month");
    const b = periodOf("month to date");
    expect(a?.startDate).toBe(b?.startDate);
    expect(a?.endDate).toBe(b?.endDate);
  });

  test("last month equals previous month", () => {
    const a = periodOf("last month");
    const b = periodOf("previous month");
    expect(a?.startDate).toBe(b?.startDate);
    expect(a?.endDate).toBe(b?.endDate);
  });
});

describe("D. relative-offset equivalence", () => {
  test.each([
    ["2 days ago", "2026-08-12"],
    ["two days ago", "2026-08-12"],
    ["a couple of days ago", "2026-08-12"],
    ["3 days ago", "2026-08-11"],
  ])("%s → %s", (q, iso) => {
    const p = periodOf(q);
    expect(p?.startDate).toBe(iso);
    expect(p?.endDate).toBe(iso);
  });
});

describe("E. comparison equivalence", () => {
  test.each([
    "July vs June",
    "July versus June",
    "compare July with June",
    "July compared with June",
    "July against June",
  ])("%s keeps both months", (q) => {
    const c = parseVaultComparePeriodsFromQuestion(q, REF);
    expect(c?.current?.startDate).toBe("2026-07-01");
    expect(c?.previous?.startDate).toBe("2026-06-01");
  });

  test("this month against last month", () => {
    const c = parseVaultComparePeriodsFromQuestion("How are we doing this month against last month?", REF);
    expect(c?.current?.periodType).toBe("this_month");
    expect(c?.previous?.startDate).toBe(periodOf("last month")?.startDate);
  });
});

describe("F–H. conversational inheritance and precedence", () => {
  const prev = `{
    activeCompanyId: "nac_hospitality",
    activeBrandId: "nac",
    activeBranchId: "khobar",
    activePeriods: { current: { startDate: "2026-08-02", endDate: "2026-08-08", label: "last week" }, comparison: null },
    activeMetricFamily: "commercial",
    activeMetric: "sales",
    activeCapabilities: ["commercial.performance"],
    filters: {},
    evidenceRefs: [],
    hypothesisRefs: [],
    previousIntent: "performance_overview",
  }`;

  test("period-only follow-up inherits metric and branch", () => {
    const out = run(`
      const follow = mod.resolveTurnSemantics({
        question: "What about June?",
        previous: ${prev},
        referenceDate: new Date("2026-08-14T16:16:00.000Z"),
      });
      return {
        metric: follow.metric,
        branch: follow.scope.branchId,
        start: follow.period?.startDate,
        compare: follow.comparisonPeriod,
        inherited: follow.inheritedFromConversation,
        explicit: follow.explicitInCurrentTurn,
      };
    `);
    expect(out.metric).toBe("sales");
    expect(out.branch).toBe("khobar");
    expect(out.start).toBe("2026-06-01");
    expect(out.compare).toBeNull();
    expect(out.inherited.metric).toBe(true);
    expect(out.explicit.period).toBe(true);
  });

  test("metric-only follow-up inherits period and branch", () => {
    const out = run(`
      const follow = mod.resolveTurnSemantics({
        question: "What about covers?",
        previous: ${prev},
        referenceDate: new Date("2026-08-14T16:16:00.000Z"),
      });
      return { metric: follow.metric, start: follow.period?.startDate, branch: follow.scope.branchId };
    `);
    expect(out.metric).toBe("covers");
    expect(out.start).toBe("2026-08-02");
    expect(out.branch).toBe("khobar");
  });

  test("branch-only follow-up inherits metric and period", () => {
    const out = run(`
      const follow = mod.resolveTurnSemantics({
        question: "What about Riyadh?",
        previous: ${prev},
        referenceDate: new Date("2026-08-14T16:16:00.000Z"),
      });
      return { metric: follow.metric, start: follow.period?.startDate, branch: follow.scope.branchId };
    `);
    expect(out.metric).toBe("sales");
    expect(out.start).toBe("2026-08-02");
    expect(out.branch).toBe("riyadh");
  });

  test("compare-only follow-up keeps current period", () => {
    const out = run(`
      const follow = mod.resolveTurnSemantics({
        question: "Compared with June?",
        previous: ${prev},
        referenceDate: new Date("2026-08-14T16:16:00.000Z"),
      });
      return {
        start: follow.period?.startDate,
        compare: follow.comparisonPeriod?.startDate,
        intent: follow.comparisonIntent,
      };
    `);
    expect(out.start).toBe("2026-08-02");
    expect(out.compare).toBe("2026-06-01");
    expect(out.intent).toBe(true);
  });

  test("explicit correction replaces period and does not keep old range", () => {
    const out = run(`
      const follow = mod.resolveTurnSemantics({
        question: "No, I meant 3 days ago",
        previous: ${prev},
        referenceDate: new Date("2026-08-14T16:16:00.000Z"),
      });
      return { start: follow.period?.startDate, end: follow.period?.endDate, compare: follow.comparisonPeriod };
    `);
    expect(out.start).toBe("2026-08-11");
    expect(out.end).toBe("2026-08-11");
    expect(out.compare).toBeNull();
  });

  test("Actually Khobar in July replaces branch and period", () => {
    const out = run(`
      const follow = mod.resolveTurnSemantics({
        question: "Actually Khobar in July",
        previous: {
          ...${prev},
          activeBranchId: "riyadh",
        },
        referenceDate: new Date("2026-08-14T16:16:00.000Z"),
      });
      return { branch: follow.scope.branchId, start: follow.period?.startDate, end: follow.period?.endDate };
    `);
    expect(out.branch).toBe("khobar");
    expect(out.start).toBe("2026-07-01");
    expect(out.end).toBe("2026-07-31");
  });

  test("Compare June without baseline asks for clarification", () => {
    const out = run(`
      const follow = mod.resolveTurnSemantics({
        question: "Compare June",
        previous: null,
        referenceDate: new Date("2026-08-14T16:16:00.000Z"),
      });
      return follow.ambiguity;
    `);
    expect(out.needsClarification).toBe(true);
    expect(out.kind).toBe("missing_comparison_baseline");
    expect(out.prompt).toMatch(/to what/i);
  });
});

describe("I. weeks are Sunday-start", () => {
  test("this week starts Sunday 9 Aug 2026", () => {
    const p = periodOf("this week");
    expect(p?.startDate).toBe("2026-08-09");
    expect(p?.endDate).toBe("2026-08-14");
  });

  test("last week is previous complete Sunday week", () => {
    const p = periodOf("last week");
    expect(p?.startDate).toBe("2026-08-02");
    expect(p?.endDate).toBe("2026-08-08");
  });
});
