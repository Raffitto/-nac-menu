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

  test("modifiers, resets, branch, source, and ambiguity stay deterministic", () => {
    const out = runFabric(`
      const previous = ${JSON.stringify(PREVIOUS)};
      const ref = new Date(${JSON.stringify(REF)});
      const questions = [
        "same but per day",
        "which one is stronger daily?",
        "what changed?",
        "why though?",
        "top 5 days?",
        "first 10 days",
        "same comparison but orders",
        "what about covers instead?",
        "what about Riyadh?",
      ];
      const rows = questions.map((question) => {
        const resolved = mod.resolveFabricFollowUp({ question, previous, referenceDate: ref });
        return {
          question,
          baseline: resolved.currentPeriod && resolved.currentPeriod.startDate,
          baselineEnd: resolved.currentPeriod && resolved.currentPeriod.endDate,
          subject: resolved.comparisonPeriod && resolved.comparisonPeriod.startDate,
          subjectEnd: resolved.comparisonPeriod && resolved.comparisonPeriod.endDate,
          branch: resolved.branchId,
          clarification: resolved.clarification || null,
          metric: resolved.conversation.management && resolved.conversation.management.metric,
        };
      });
      const ambiguous = mod.resolveFabricFollowUp({ question: "what about that?", previous, referenceDate: ref });
      const forgotten = mod.resolveFabricFollowUp({ question: "forget that, sales yesterday", previous, referenceDate: ref });
      const yesterday = mod.resolveFabricFollowUp({ question: "sales yesterday", previous, referenceDate: ref });
      const perDayAfter = mod.resolveFabricFollowUp({
        question: "per day?",
        previous: yesterday.conversation,
        referenceDate: ref,
      });
      const menu = mod.resolveFabricFollowUp({ question: "how many menu QR scans today?", previous, referenceDate: ref });
      const salesAfterMenu = mod.resolveFabricFollowUp({
        question: "sales yesterday",
        previous: menu.conversation,
        referenceDate: ref,
      });
      const why = mod.defaultTemporalService.resolveFromQuestion("why are September sales lower than August?", ref);
      const reversed = mod.defaultTemporalService.resolveFromQuestion("compare September so far with August", ref);
      const nowReversed = mod.defaultTemporalService.resolveFromQuestion("now September vs August", ref);
      return {
        rows,
        ambiguous: ambiguous.clarification,
        forgotten: {
          baseline: forgotten.currentPeriod && forgotten.currentPeriod.startDate,
          subject: forgotten.comparisonPeriod && forgotten.comparisonPeriod.startDate,
        },
        perDayAfter: {
          baseline: perDayAfter.currentPeriod && perDayAfter.currentPeriod.startDate,
          subject: perDayAfter.comparisonPeriod && perDayAfter.comparisonPeriod.startDate,
        },
        menuSource: menu.conversation.management && menu.conversation.management.source,
        menuComparison: menu.comparisonPeriod && menu.comparisonPeriod.startDate,
        salesAfterMenu: {
          baseline: salesAfterMenu.currentPeriod && salesAfterMenu.currentPeriod.startDate,
          subject: salesAfterMenu.comparisonPeriod && salesAfterMenu.comparisonPeriod.startDate,
        },
        why: { baseline: why.range && why.range.startDate, subject: why.compareRange && why.compareRange.startDate },
        reversed: { baseline: reversed.range && reversed.range.startDate, subject: reversed.compareRange && reversed.compareRange.startDate },
        nowReversed: { baseline: nowReversed.range && nowReversed.range.startDate, subject: nowReversed.compareRange && nowReversed.compareRange.startDate },
      };
    `);

    for (const row of out.rows) {
      expect(row.baseline).toBe("2026-08-01");
      expect(row.subject).toBe("2026-09-01");
      if (row.question === "first 10 days") {
        expect(row.baselineEnd).toBe("2026-08-10");
        expect(row.subjectEnd).toBe("2026-09-10");
      }
    }
    expect(out.rows.find((row) => row.question === "what about Riyadh?").branch).toBe("riyadh");
    expect(out.rows.find((row) => row.question === "same comparison but orders").metric).toBe("orders");
    expect(out.ambiguous).toMatch(/which period/i);
    expect(out.forgotten.baseline).toBe("2026-09-24");
    expect(out.forgotten.subject).toBeFalsy();
    expect(out.perDayAfter.baseline).toBe("2026-09-24");
    expect(out.perDayAfter.subject).toBeFalsy();
    expect(out.menuSource).toBe("menu_analytics");
    expect(out.menuComparison).toBeFalsy();
    expect(out.salesAfterMenu.baseline).toBe("2026-09-24");
    expect(out.salesAfterMenu.subject).toBeFalsy();
    expect(out.why.baseline).toBe("2026-08-01");
    expect(out.why.subject).toBe("2026-09-01");
    expect(out.reversed.baseline).toBe("2026-09-01");
    expect(out.reversed.subject).toBe("2026-08-01");
    expect(out.nowReversed.baseline).toBe("2026-09-01");
    expect(out.nowReversed.subject).toBe("2026-08-01");
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
