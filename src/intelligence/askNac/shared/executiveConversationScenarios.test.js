/**
 * Realistic executive multi-turn conversations for metric-aware Ask NAC.
 */
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");
const REF = "new Date('2026-08-15T12:00:00.000Z')";

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

describe("Scenario 1: MTD snapshot → covers → spend → last month", () => {
  test("each turn switches metric while period/comparison survive", () => {
    const out = run(`
      const ref = ${REF};
      const t1 = mod.resolveTurnSemantics({ question: "How are we doing this month?", branchHint: "khobar", referenceDate: ref });
      const t2 = mod.resolveTurnSemantics({ question: "What about covers?", previous: t1.conversation, referenceDate: ref });
      const t3 = mod.resolveTurnSemantics({ question: "Average spend?", previous: t2.conversation, referenceDate: ref });
      const t4 = mod.resolveTurnSemantics({ question: "Against last month?", previous: t3.conversation, referenceDate: ref });
      const period = { startDate: t1.period.startDate, endDate: t1.period.endDate, label: t1.period.label };
      function ev(k, v) {
        return mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: k, value: v, textSummary: k, period });
      }
      const evidence = [
        ev("net_sales", 590127), ev("covers", 8000), ev("orders", 3100), ev("avg_spend", 73.77),
        ev("previous_net_sales", 540000), ev("previous_covers", 8200), ev("previous_avg_spend", 65.85),
        ev("delta_pct", ((590127-540000)/540000)*100),
        ev("covers_delta_pct", ((8000-8200)/8200)*100),
        ev("avg_spend_delta_pct", ((73.77-65.85)/65.85)*100),
      ];
      const a1 = mod.synthesizeDeterministicAnswer({ question: "How are we doing this month?", branchId: "khobar", period, evidence, claims: [], coverage: [], primaryMetric: t1.metric });
      const a2 = mod.synthesizeDeterministicAnswer({ question: "What about covers?", branchId: "khobar", period, evidence, claims: [], coverage: [], primaryMetric: t2.metric });
      const a3 = mod.synthesizeDeterministicAnswer({ question: "Average spend?", branchId: "khobar", period, evidence, claims: [], coverage: [], primaryMetric: t3.metric });
      const a4 = mod.synthesizeDeterministicAnswer({
        question: "Against last month?", branchId: "khobar", period,
        comparisonPeriod: t4.comparisonPeriod, evidence, claims: [], coverage: [],
        primaryMetric: t4.metric, comparisonIntent: true,
        comparability: { status: "comparable", recommendedMethod: "full_period" },
      });
      return {
        metrics: [t1.metric, t2.metric, t3.metric, t4.metric],
        compare: t4.comparisonIntent,
        compareStart: t4.comparisonPeriod?.startDate,
        periodStart: [t1.period?.startDate, t2.period?.startDate, t3.period?.startDate, t4.period?.startDate],
        a1, a2, a3, a4,
      };
    `);
    expect(out.metrics).toEqual(["commercial", "covers", "avg_spend", "avg_spend"]);
    expect(out.compare).toBe(true);
    expect(out.compareStart).toBeTruthy();
    expect(new Set(out.periodStart).size).toBe(1);
    expect(out.a1).toMatch(/net sales/i);
    expect(out.a2).toMatch(/covers/i);
    expect(out.a2).not.toMatch(/net sales were/i);
    expect(out.a3).toMatch(/average spend/i);
    expect(out.a3).not.toMatch(/net sales were/i);
    expect(out.a4).toMatch(/average spend/i);
    expect(out.a4).toMatch(/%/);
  });
});

describe("Scenario 2: July ranking chain", () => {
  test("best 3 days defaults to sales, then covers, then worst", () => {
    const out = run(`
      const ref = ${REF};
      const t1 = mod.resolveTurnSemantics({ question: "How was July?", branchHint: "khobar", referenceDate: ref });
      const t2 = mod.resolveTurnSemantics({ question: "What were the best 3 days?", previous: t1.conversation, referenceDate: ref });
      const t3 = mod.resolveTurnSemantics({ question: "By covers instead", previous: t2.conversation, referenceDate: ref });
      const t4 = mod.resolveTurnSemantics({ question: "And the worst?", previous: t3.conversation, referenceDate: ref });
      const dailyFacts = [
        { date: "2026-07-12", net_sales: 45000, covers: 200, orders: 80, avg_spend: 225 },
        { date: "2026-07-18", net_sales: 41000, covers: 520, orders: 90, avg_spend: 79 },
        { date: "2026-07-04", net_sales: 12000, covers: 90, orders: 40, avg_spend: 133 },
        { date: "2026-07-22", net_sales: 38000, covers: 400, orders: 85, avg_spend: 95 },
      ];
      const period = t1.period;
      const evidence = [mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "net_sales", value: 200000, textSummary: "sales", period })];
      const a2 = mod.synthesizeDeterministicAnswer({ question: "best 3 days", branchId: "khobar", period, evidence, claims: [], coverage: [], primaryMetric: t2.metric, ranking: t2.ranking, rankingCount: t2.rankingCount, dailyFacts });
      const a3 = mod.synthesizeDeterministicAnswer({ question: "by covers", branchId: "khobar", period, evidence, claims: [], coverage: [], primaryMetric: t3.metric, ranking: t3.ranking, rankingCount: t3.rankingCount, dailyFacts });
      const a4 = mod.synthesizeDeterministicAnswer({ question: "worst", branchId: "khobar", period, evidence, claims: [], coverage: [], primaryMetric: t4.metric, ranking: t4.ranking, rankingCount: t4.rankingCount, dailyFacts });
      return {
        t2: { metric: t2.metric, ranking: t2.ranking, n: t2.rankingCount, intent: t2.intent },
        t3: { metric: t3.metric, ranking: t3.ranking },
        t4: { metric: t4.metric, ranking: t4.ranking },
        a2, a3, a4,
      };
    `);
    expect(out.t2.metric).toBe("sales");
    expect(out.t2.ranking).toBe("top");
    expect(out.t2.n).toBe(3);
    expect(out.t3.metric).toBe("covers");
    expect(out.t3.ranking).toBe("top");
    expect(out.t4.ranking).toBe("bottom");
    expect(out.t4.metric).toBe("covers");
    expect(out.a2).toMatch(/Sunday, 12 July/);
    expect(out.a3).toMatch(/Saturday, 18 July/);
    expect(out.a4).toMatch(/Saturday, 4 July/);
    expect(out.a3).not.toMatch(/net sales were/i);
  });
});

describe("Scenario 3: Khobar last week → Riyadh", () => {
  test("authorized branch switch vs RBAC isolation", () => {
    const out = run(`
      const ref = ${REF};
      const t1 = mod.resolveTurnSemantics({ question: "How did Khobar do last week?", branchHint: "khobar", referenceDate: ref });
      const t2 = mod.resolveTurnSemantics({ question: "What about Riyadh?", previous: t1.conversation, referenceDate: ref });
      return { b1: t1.scope.branchId, b2: t2.scope.branchId, p1: t1.period?.startDate, p2: t2.period?.startDate };
    `);
    expect(out.b1).toBe("khobar");
    expect(out.b2).toBe("riyadh");
    expect(out.p1).toBe(out.p2);
  });
});

describe("Scenario 4: Ramadan infeasible", () => {
  test("does not manufacture a baseline", () => {
    const out = run(`
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: "Compare Ramadan this year with last year",
        branchHint: "khobar",
        referenceDate: ${REF},
        mode: "heuristic",
      });
      return result.answerText;
    `);
    expect(out).toMatch(/not operating/i);
  });
});

describe("Scenario 5: last 10 days compare then covers", () => {
  test("comparison periods persist while metric changes", () => {
    const out = run(`
      const ref = ${REF};
      const t1 = mod.resolveTurnSemantics({ question: "How were sales over the last 10 days?", branchHint: "khobar", referenceDate: ref });
      const t2 = mod.resolveTurnSemantics({ question: "Compare with the previous 10", previous: t1.conversation, referenceDate: ref });
      const t3 = mod.resolveTurnSemantics({ question: "What about covers?", previous: t2.conversation, referenceDate: ref });
      return {
        m1: t1.metric, m3: t3.metric,
        cur: t3.period?.startDate,
        prev: t3.comparisonPeriod?.startDate,
        intent: t3.comparisonIntent,
        t2cur: t2.period?.startDate,
        t2prev: t2.comparisonPeriod?.startDate,
      };
    `);
    expect(out.m1).toBe("sales");
    expect(out.m3).toBe("covers");
    expect(out.intent).toBe(true);
    expect(out.cur).toBe(out.t2cur);
    expect(out.prev).toBe(out.t2prev);
    expect(out.prev).toBeTruthy();
  });
});

describe("previous-period follow-up after an exact day", () => {
  test("compare with the previous period uses the equivalent prior window", () => {
    const out = run(`
      const ref = ${REF};
      const t1 = mod.resolveTurnSemantics({ question: "what were sales yesterday", branchHint: "khobar", referenceDate: ref });
      const t2 = mod.resolveTurnSemantics({ question: "compare that with the previous period", previous: t1.conversation, referenceDate: ref });
      return {
        current: t1.period?.startDate,
        compare: t2.comparisonPeriod?.startDate,
        intent: t2.comparisonIntent,
        amb: t2.ambiguity.needsClarification,
      };
    `);
    expect(out.amb).toBe(false);
    expect(out.intent).toBe(true);
    expect(out.compare).toBeTruthy();
    expect(out.compare).not.toBe(out.current);
  });
});

describe("Scenario 6: was that good?", () => {
  test("uses a defensible weekday benchmark rather than inventing a target", () => {
    const out = run(`
      const ref = ${REF};
      const t1 = mod.resolveTurnSemantics({ question: "How did we perform yesterday?", branchHint: "khobar", referenceDate: ref });
      const t2 = mod.resolveTurnSemantics({ question: "Was that good?", previous: t1.conversation, referenceDate: ref });
      const period = t1.period;
      const evidence = [
        mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "net_sales", value: 23836.52, textSummary: "sales", period }),
        mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "covers", value: 331, textSummary: "covers", period }),
      ];
      const a2 = mod.synthesizeDeterministicAnswer({
        question: "Was that good?",
        branchId: "khobar",
        period,
        evidence,
        claims: [],
        coverage: [mod.buildCoverageReport({ domain: "sales", range: period, expectedRecords: 1, availableRecords: 1 })],
        primaryMetric: t2.metric,
        comparisonIntent: t2.comparisonIntent,
        openingDate: "2025-04-27",
      });
      return { compare: t2.comparisonIntent, a2, period: period.startDate, intent: t2.analysisIntent };
    `);
    expect(out.compare).toBe(false);
    expect(out.intent).toBe("judgement");
    expect(out.a2).toMatch(/Friday history|previous four Fridays|isn't enough comparable/i);
    expect(out.a2).not.toMatch(/because/i);
    expect(out.a2).not.toMatch(/good performance/i);
  });
});
