/**
 * Production regressions 14 Aug 2026:
 * A) "3 days ago" must be an exact Asia/Riyadh day, never last_7_days.
 * B) "what about last 10 days compared to the previous 10 days" must keep both periods.
 */
const path = require("path");
const { execFileSync } = require("child_process");
const {
  parseVaultPeriodFromQuestion,
  parseVaultComparePeriodsFromQuestion,
} = require("../vault/vaultPeriodParser");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");
const followUpPath = path.join(root, "supabase/functions/_shared/companyIntelligence/conversationFollowUp.ts");
const REF = new Date("2026-08-14T16:16:00.000Z");

function run(body, entry = fabricPath) {
  const script = `
    global.Deno = { env: { get: () => undefined } };
    import(${JSON.stringify(entry)}).then(async (mod) => {
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out));
    }).catch((err) => { console.error(err); process.exit(1); });
  `;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  return JSON.parse(stdout.trim());
}

function clientHint(profile) {
  return {
    authenticated: Boolean(profile.authenticated),
    allBranches: Boolean(profile.allBranches),
    branchScope: profile.branchScope ?? null,
  };
}

const EXECUTOR_HELPER = `
  const calls = [];
  const cashUpTool = {
    answerType: "metric",
    directAnswer: "Cash-up aggregation for the requested period.",
    keyMetrics: [{ label: "Net sales", value: "1000", unit: "SAR", source: "cash_up" }],
    conversationDataset: {
      kind: "cash_up_aggregation",
      reportType: "cash_up",
      aggregation: { totalSales: 1000, totalGuests: 10, dayCount: 1, expectedDayCount: 1 },
    },
  };
  const executor = mod.createVaultCapabilityExecutor(async ({ request }) => {
    calls.push({
      capability: request.capability,
      currentStart: request.currentPeriod?.startDate || null,
      currentEnd: request.currentPeriod?.endDate || null,
      compareStart: request.comparisonPeriod?.startDate || null,
      compareEnd: request.comparisonPeriod?.endDate || null,
    });
    return cashUpTool;
  });
`;

describe("relative calendar-day offsets", () => {
  test.each([
    ["How was the sales 3 days ago", "2026-08-11"],
    ["sales 3 days ago", "2026-08-11"],
    ["what were sales 2 days ago", "2026-08-12"],
    ["sales 5 days ago", "2026-08-09"],
    ["sales a day ago", "2026-08-13"],
    ["sales one day ago", "2026-08-13"],
    ["sales yesterday", "2026-08-13"],
    ["sales on 12 aug", "2026-08-12"],
  ])("%s → %s", (question, iso) => {
    const period = parseVaultPeriodFromQuestion(question, REF);
    expect(period?.startDate).toBe(iso);
    expect(period?.endDate).toBe(iso);
    expect(period?.isSingleDay).toBe(true);
    expect(period?.periodType === "single_day" || period?.startDate === period?.endDate).toBe(true);
  });

  test("from 9 to 13 aug stays a custom range", () => {
    const period = parseVaultPeriodFromQuestion("sales from 9 to 13 aug", REF);
    expect(period?.startDate).toBe("2026-08-09");
    expect(period?.endDate).toBe("2026-08-13");
    expect(period?.periodType).toBe("custom_range");
  });
});

describe("last 10 vs previous 10 comparison periods", () => {
  test("standalone last 10 days compared to previous 10 days", () => {
    const compare = parseVaultComparePeriodsFromQuestion(
      "last 10 days compared to the previous 10 days",
      REF,
    );
    expect(compare?.current?.startDate).toBe("2026-08-05");
    expect(compare?.current?.endDate).toBe("2026-08-14");
    expect(compare?.previous?.startDate).toBe("2026-07-26");
    expect(compare?.previous?.endDate).toBe("2026-08-04");
  });
});

describe("Fabric/follow-up production phrases", () => {
  test("3 days ago reaches Fabric as 11 Aug single day, not last 7", () => {
    const out = run(`
      ${EXECUTOR_HELPER}
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        profile: ${JSON.stringify(clientHint({ authenticated: true, allBranches: false, branchScope: "khobar" }))},
      });
      const spine = await mod.runCompanyIntelligenceOrchestration({
        question: "How was the sales 3 days ago",
        scope: authorized.scope,
        referenceDate: new Date("2026-08-14T16:16:00.000Z"),
        mode: "heuristic",
        executor,
      });
      return {
        current: spine.state.periods.current,
        comparison: spine.state.periods.comparison,
        caps: calls.map((c) => c.capability),
        currentStart: calls[0]?.currentStart || null,
      };
    `);
    expect(out.current.startDate).toBe("2026-08-11");
    expect(out.current.endDate).toBe("2026-08-11");
    expect(out.current.semantic).not.toBe("last_7_days");
    expect(out.comparison).toBeNull();
    expect(out.currentStart).toBe("2026-08-11");
  });

  test("standalone last 10 vs previous 10 keeps both periods into capabilities", () => {
    const out = run(`
      ${EXECUTOR_HELPER}
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        profile: ${JSON.stringify(clientHint({ authenticated: true, allBranches: false, branchScope: "khobar" }))},
      });
      const spine = await mod.runCompanyIntelligenceOrchestration({
        question: "last 10 days compared to the previous 10 days",
        scope: authorized.scope,
        referenceDate: new Date("2026-08-14T16:16:00.000Z"),
        mode: "heuristic",
        executor,
      });
      const cmp = calls.find((c) => c.capability === "commercial.compare") || calls[0];
      return {
        current: spine.state.periods.current,
        comparison: spine.state.periods.comparison,
        caps: calls.map((c) => c.capability),
        cmp,
      };
    `);
    expect(out.current.startDate).toBe("2026-08-05");
    expect(out.current.endDate).toBe("2026-08-14");
    expect(out.comparison.startDate).toBe("2026-07-26");
    expect(out.comparison.endDate).toBe("2026-08-04");
    expect(out.caps).toContain("commercial.compare");
    expect(out.cmp.compareStart).toBe("2026-07-26");
    expect(out.cmp.compareEnd).toBe("2026-08-04");
  });

  test.each([
    ["sales on 12 aug"],
    ["sales last 7 days"],
    ["How was the sales 3 days ago"],
  ])("follow-up last 10 vs previous 10 after %s keeps comparison", (prior) => {
    const out = run(`
      ${EXECUTOR_HELPER}
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        profile: ${JSON.stringify(clientHint({ authenticated: true, allBranches: false, branchScope: "khobar" }))},
      });
      const first = await mod.runCompanyIntelligenceOrchestration({
        question: ${JSON.stringify(prior)},
        scope: authorized.scope,
        referenceDate: new Date("2026-08-14T16:16:00.000Z"),
        mode: "heuristic",
        executor,
      });
      const before = calls.length;
      const follow = await mod.runCompanyIntelligenceOrchestration({
        question: "What about last 10 days compared to the previous 10 days?",
        scope: authorized.scope,
        conversation: first.nextConversation,
        referenceDate: new Date("2026-08-14T16:16:00.000Z"),
        mode: "heuristic",
        executor,
      });
      const followCalls = calls.slice(before);
      return {
        notes: follow.state.conversation ? true : false,
        current: follow.state.periods.current,
        comparison: follow.state.periods.comparison,
        caps: followCalls.map((c) => c.capability),
        resolved: follow.state.request?.normalizedQuestion || null,
      };
    `);
    expect(out.current.startDate).toBe("2026-08-05");
    expect(out.current.endDate).toBe("2026-08-14");
    expect(out.comparison).not.toBeNull();
    expect(out.comparison.startDate).toBe("2026-07-26");
    expect(out.comparison.endDate).toBe("2026-08-04");
    expect(out.caps).toContain("commercial.compare");
  });
});

describe("conversationFollowUp boundary", () => {
  test("what about last 10 vs previous 10 does not collapse to period-only", () => {
    const out = run(`
      const prev = {
        activePeriods: {
          current: { startDate: "2026-08-11", endDate: "2026-08-11", label: "11 August 2026", semantic: "single_day" },
          comparison: null,
        },
        activeMetricFamily: "commercial",
        previousIntent: "performance_overview",
        activeCapabilities: ["commercial.performance"],
        activeBranchId: "khobar",
      };
      const follow = mod.resolveFabricFollowUp({
        question: "What about last 10 days compared to the previous 10 days?",
        previous: prev,
        branchHint: "khobar",
        referenceDate: new Date("2026-08-14T16:16:00.000Z"),
      });
      return {
        usedFollowUp: follow.usedFollowUp,
        notes: follow.notes,
        current: follow.currentPeriod,
        comparison: follow.comparisonPeriod,
        periodOnly: mod.isPeriodOnlyFollowUpTurn(
          "What about last 10 days compared to the previous 10 days?",
          new Date("2026-08-14T16:16:00.000Z"),
        ),
      };
    `, followUpPath);
    expect(out.periodOnly).toBe(false);
    expect(out.notes).toContain("self_contained_comparison_preserved");
    expect(out.current.startDate).toBe("2026-08-05");
    expect(out.comparison.startDate).toBe("2026-07-26");
    expect(out.comparison.endDate).toBe("2026-08-04");
  });
});
