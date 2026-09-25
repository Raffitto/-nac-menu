const path = require("path");
const { execFileSync } = require("child_process");
const { resolveFollowUpQuestion } = require("./resolveFollowUpQuestion");
const { parseVaultComparePeriodsFromQuestion } = require("../vault/vaultPeriodParser");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");

function runFabric(body) {
  const script = `
    global.Deno = { env: { get: () => undefined } };
    import(${JSON.stringify(fabricPath)}).then(async (mod) => {
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out));
    }).catch((err) => { console.error(err); process.exit(1); });
  `;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
  });
  return JSON.parse(stdout.trim());
}

const REF = "2026-09-25T12:00:00.000Z";
const PREVIOUS = {
  activeBranchId: null,
  activeMetricFamily: "commercial",
  previousIntent: "performance_overview",
  activeCapabilities: ["commercial.compare"],
  activePeriods: {
    current: { startDate: "2026-08-01", endDate: "2026-08-31", label: "August 2026", semantic: "named_month" },
    comparison: { startDate: "2026-09-01", endDate: "2026-09-24", label: "1–24 September 2026", semantic: "named_month" },
  },
};

const FOLLOW_UPS = [
  "what about per day?",
  "and covers?",
  "orders?",
  "average spend?",
  "what about the first 24 days?",
  "why?",
];

describe("comparison continuity", () => {
  test("follow-ups keep August and September, and yesterday resets", () => {
    const out = runFabric(`
      const previous = ${JSON.stringify(PREVIOUS)};
      const ref = new Date(${JSON.stringify(REF)});
      const followUps = ${JSON.stringify(FOLLOW_UPS)};
      const kept = followUps.map((question) => {
        const resolved = mod.resolveFabricFollowUp({ question, previous, referenceDate: ref });
        return {
          question,
          usedFollowUp: resolved.usedFollowUp,
          baseline: resolved.currentPeriod && resolved.currentPeriod.startDate,
          baselineEnd: resolved.currentPeriod && resolved.currentPeriod.endDate,
          subject: resolved.comparisonPeriod && resolved.comparisonPeriod.startDate,
          subjectEnd: resolved.comparisonPeriod && resolved.comparisonPeriod.endDate,
          questionKept: resolved.resolvedQuestion,
        };
      });
      const yesterday = mod.resolveFabricFollowUp({
        question: "sales yesterday",
        previous,
        referenceDate: ref,
      });
      const spine = followUps.map((question) => mod.isManagementIntelligenceQuestion(question, { intent: "unknown", confidence: "low" }, {
        priorFabricConversation: previous,
        referenceDate: ref,
      }));
      return { kept, yesterday: {
        baseline: yesterday.currentPeriod && yesterday.currentPeriod.startDate,
        subject: yesterday.comparisonPeriod && yesterday.comparisonPeriod.startDate,
      }, spine };
    `);

    for (const row of out.kept) {
      expect(row.baseline).toBe("2026-08-01");
      expect(row.subject).toBe("2026-09-01");
      if (row.question.includes("first 24")) {
        expect(row.baselineEnd).toBe("2026-08-24");
        expect(row.subjectEnd).toBe("2026-09-24");
      } else {
        expect(row.baselineEnd).toBe("2026-08-31");
        expect(row.subjectEnd).toBe("2026-09-24");
      }
    }
    expect(out.spine.every(Boolean)).toBe(true);
    expect(out.yesterday.baseline).toBe("2026-09-24");
    expect(out.yesterday.subject).toBeFalsy();
  });

  test("client follow-up resolver does not rewrite an active comparison or a named-month why", () => {
    const context = {
      lastQuestion: "compare August with September so far",
      lastResolvedQuestion: "compare August with September so far",
      fabricConversation: { activePeriods: PREVIOUS.activePeriods },
      activeState: { version: 1, resolvedQuestion: "compare August with September so far", metric: "net_sales", period: { label: "August 2026" } },
    };
    for (const question of FOLLOW_UPS) {
      const resolved = resolveFollowUpQuestion(question, context);
      expect(resolved.resolvedQuestion.replace(/\?$/, "").toLowerCase()).toBe(question.replace(/\?$/, "").toLowerCase());
    }
    const named = resolveFollowUpQuestion("why are September sales lower than August?", context);
    expect(named.resolvedQuestion).toMatch(/September sales lower than August/i);
    const soFar = resolveFollowUpQuestion("compare September so far with August", context);
    expect(soFar.resolvedQuestion).toMatch(/September so far with August/i);
  });

  test("so far between the month and the connector still resolves both periods", () => {
    const ref = new Date(REF);
    const parsed = parseVaultComparePeriodsFromQuestion("compare September so far with August", ref);
    expect(parsed.current.startDate).toBe("2026-09-01");
    expect(parsed.current.endDate).toBe("2026-09-24");
    expect(parsed.previous.startDate).toBe("2026-08-01");
    expect(parsed.previous.endDate).toBe("2026-08-31");
  });
});
