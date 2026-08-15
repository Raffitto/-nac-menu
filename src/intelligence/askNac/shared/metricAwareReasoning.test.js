/**
 * Metric-aware reasoning + synthesis matrix (Ask NAC executive intelligence).
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

const EVIDENCE_HELPER = `
  const period = { startDate: "2026-08-01", endDate: "2026-08-14", label: "August MTD" };
  const day = { startDate: "2026-08-14", endDate: "2026-08-14", label: "14 August 2026" };
  function ev(metricOrEvent, value) {
    return mod.createEvidence({
      source: "cash_up",
      domain: "INTERNAL_STRUCTURED",
      branchId: "khobar",
      metricOrEvent,
      value,
      textSummary: metricOrEvent + "=" + value,
      period,
    });
  }
  function synth(question, evidence, extra = {}) {
    return mod.synthesizeDeterministicAnswer({
      question,
      branchId: extra.branchId || "khobar",
      period: extra.period || period,
      comparisonPeriod: extra.comparisonPeriod || null,
      evidence,
      claims: [],
      coverage: extra.coverage || [mod.buildCoverageReport({
        domain: "sales",
        range: extra.period || period,
        expectedRecords: extra.expected || 14,
        availableRecords: extra.available || 14,
      })],
      comparability: extra.comparability || null,
      primaryMetric: extra.primaryMetric || null,
      ranking: extra.ranking || null,
      rankingCount: extra.rankingCount || null,
      comparisonIntent: Boolean(extra.comparisonIntent),
      rankings: extra.rankings || [],
      dailyFacts: extra.dailyFacts || [],
    });
  }
`;

describe("A. primary metric selection", () => {
  test.each([
    ["sales", "generated", /covers/i],
    ["covers", "covers", /net sales/i],
    ["orders", "orders", /net sales/i],
    ["avg_spend", "average spend", /net sales/i],
  ])("%s headlines the requested metric", (primaryMetric, headline, notSalesWhenNotSales) => {
    const out = run(`
      ${EVIDENCE_HELPER}
      const evidence = [ev("net_sales", 590127), ev("covers", 8000), ev("orders", 3100), ev("avg_spend", 73.77)];
      return synth("metric fact", evidence, { primaryMetric: ${JSON.stringify(primaryMetric)}, period: day, expected: 1, available: 1 });
    `);
    expect(out.toLowerCase()).toMatch(new RegExp(headline));
    if (primaryMetric !== "sales") {
      expect(out).not.toMatch(/net sales were/i);
    }
  });
});

describe("B. metric follow-up replacement", () => {
  test("sales → covers → spend semantics", () => {
    const out = run(`
      const ref = ${REF};
      const t1 = mod.resolveTurnSemantics({ question: "How were sales this month?", branchHint: "khobar", referenceDate: ref });
      const t2 = mod.resolveTurnSemantics({ question: "What about covers?", previous: t1.conversation, referenceDate: ref });
      const t3 = mod.resolveTurnSemantics({ question: "Average spend?", previous: t2.conversation, referenceDate: ref });
      return { m1: t1.metric, m2: t2.metric, m3: t3.metric, p2: t2.period?.startDate, p3: t3.period?.startDate };
    `);
    expect(out.m1).toBe("sales");
    expect(out.m2).toBe("covers");
    expect(out.m3).toBe("avg_spend");
    expect(out.p2).toBe(out.p3);
  });
});

describe("C. comparison metric preservation", () => {
  test("covers July → compare June keeps covers", () => {
    const out = run(`
      const ref = ${REF};
      const t1 = mod.resolveTurnSemantics({ question: "How were covers in July compared with June?", branchHint: "khobar", referenceDate: ref });
      const t2 = mod.resolveTurnSemantics({ question: "How were covers in July?", branchHint: "khobar", referenceDate: ref });
      const t3 = mod.resolveTurnSemantics({ question: "Compared with June?", previous: t2.conversation, referenceDate: ref });
      return { t1: t1.metric, t3: t3.metric, intent: t3.comparisonIntent, prev: t3.comparisonPeriod?.startDate };
    `);
    expect(out.t1).toBe("covers");
    expect(out.t3).toBe("covers");
    expect(out.intent).toBe(true);
    expect(out.prev).toBe("2026-06-01");
  });
});

describe("D/E. branch + explicit metric", () => {
  test("Khobar sales → Riyadh covers", () => {
    const out = run(`
      const ref = ${REF};
      const t1 = mod.resolveTurnSemantics({ question: "How were sales this month?", branchHint: "khobar", referenceDate: ref });
      const t2 = mod.resolveTurnSemantics({ question: "What about Riyadh covers?", previous: t1.conversation, referenceDate: ref });
      return { b1: t1.scope.branchId, m1: t1.metric, b2: t2.scope.branchId, m2: t2.metric };
    `);
    expect(out.b1).toBe("khobar");
    expect(out.m1).toBe("sales");
    expect(out.b2).toBe("riyadh");
    expect(out.m2).toBe("covers");
  });
});

describe("F/G. cross-metric relationships and thresholds", () => {
  test.each([
    [{ sales: -12, covers: -14, spend: 0.4 }, "volume_led_decline", /fewer covers/i],
    [{ sales: -10, covers: 0.3, spend: -9 }, "spend_led_decline", /spend per guest/i],
    [{ sales: 0.4, covers: -8, spend: 9 }, "offsetting_volume_spend", /offset/i],
    [{ sales: 11, covers: 10, spend: 0.2 }, "volume_led_growth", /volume-led/i],
    [{ sales: 9, covers: 0.5, spend: 8 }, "spend_led_growth", /spend-led/i],
  ])("%s → %s", (deltas, type, phrase) => {
    const out = run(`
      const snap = {
        net_sales: 100, covers: 10, orders: 5, avg_spend: 10,
        previous_net_sales: 100, previous_covers: 10, previous_orders: 5, previous_avg_spend: 10,
        sales_delta_pct: ${deltas.sales},
        covers_delta_pct: ${deltas.covers},
        orders_delta_pct: 0,
        avg_spend_delta_pct: ${deltas.spend},
        aov: 20, previous_aov: 20, aov_delta_pct: 0,
      };
      const rel = mod.deriveCommercialRelationships(snap);
      return rel.map((r) => ({ type: r.type, statement: r.statement }));
    `);
    expect(out.some((r) => r.type === type)).toBe(true);
    expect(out.find((r) => r.type === type).statement).toMatch(phrase);
  });

  test("tiny 0.5% change is flat, not dramatic", () => {
    const out = run(`
      return {
        band: mod.classifyMagnitude(0.5),
        phrase: mod.magnitudePhrase(0.5),
        sharp: mod.classifyMagnitude(-25),
        format: mod.formatPercent(12.320648311275702),
        money: mod.formatMoney(23836.52),
        moneyInt: mod.formatMoney(590127),
      };
    `);
    expect(out.band).toBe("flat");
    expect(out.phrase).toMatch(/unchanged/i);
    expect(out.sharp).toBe("sharp");
    expect(out.format).toBe("12.3%");
    expect(out.money).toBe("SAR 23,836.52");
    expect(out.moneyInt).toBe("SAR 590,127");
  });

  test("1.9% is flat and 2.0% is slight", () => {
    const out = run(`
      return { a: mod.classifyMagnitude(1.9), b: mod.classifyMagnitude(2.0) };
    `);
    expect(out.a).toBe("flat");
    expect(out.b).toBe("slight");
  });
});

describe("H. partial coverage comparison explanation", () => {
  test("matched partial coverage mentions like-for-like and coverage ratio", () => {
    const out = run(`
      ${EVIDENCE_HELPER}
      const evidence = [
        ev("net_sales", 148335.174),
        ev("previous_net_sales", 135000),
        ev("delta_pct", ((148335.174 - 135000) / 135000) * 100),
        ev("covers", 2196),
        ev("previous_covers", 1980),
        ev("covers_delta_pct", ((2196 - 1980) / 1980) * 100),
      ];
      return synth("How did this month compare with last month?", evidence, {
        primaryMetric: "sales",
        comparisonIntent: true,
        comparability: { status: "partially_comparable", recommendedMethod: "matched_days", weekdayComposition: { match: true } },
        expected: 10,
        available: 9,
      });
    `);
    expect(out).toMatch(/like-for-like/i);
    expect(out).toMatch(/9\/10/);
    expect(out).not.toMatch(/12\.320648/);
  });
});

describe("I. numeric formatting", () => {
  test("does not emit raw float percents", () => {
    const out = run(`
      ${EVIDENCE_HELPER}
      return synth("sales", [ev("net_sales", 23836.52), ev("covers", 331)], { primaryMetric: "sales", period: day, expected: 1, available: 1 });
    `);
    expect(out).toMatch(/23,836\.52/);
    expect(out).toMatch(/331 covers/);
  });
});

describe("J. ranking metric clarification", () => {
  test("best day this month without metric asks only for the metric", () => {
    const out = run(`
      const t = mod.resolveTurnSemantics({ question: "What was the best day this month?", branchHint: "khobar", referenceDate: ${REF} });
      return t.ambiguity;
    `);
    expect(out.needsClarification).toBe(true);
    expect(out.kind).toBe("missing_ranking_metric");
    expect(out.prompt).toMatch(/sales, covers/i);
    expect(out.prompt).not.toMatch(/which period/i);
  });
});

describe("K. RBAC during metric/branch follow-up", () => {
  test("unauthorized Riyadh follow-up stays in Khobar scope", () => {
    const out = run(`
      const scope = mod.createIntelligenceScope({
        primaryBranchId: "khobar",
        branchIds: ["khobar"],
        allowedBranchIds: ["khobar"],
        canSeeNetwork: false,
        role: "branch_manager",
      });
      const t1 = await mod.runCompanyIntelligenceOrchestration({
        question: "How were sales last week?",
        scope,
        branchHint: "khobar",
        referenceDate: ${REF},
        mode: "heuristic",
      });
      const t2 = await mod.runCompanyIntelligenceOrchestration({
        question: "What about Riyadh covers?",
        conversation: t1.nextConversation,
        scope,
        branchHint: "khobar",
        referenceDate: ${REF},
        mode: "heuristic",
      });
      return { b1: t1.state.scope.primaryBranchId, b2: t2.state.scope.primaryBranchId };
    `);
    expect(out.b1).toBe("khobar");
    expect(out.b2).toBe("khobar");
  });
});

describe("L. event comparison metric-specific synthesis", () => {
  test("Ramadan infeasible baseline is preserved", () => {
    const out = run(`
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: "Compare Ramadan this year with last year",
        branchHint: "khobar",
        referenceDate: ${REF},
        mode: "heuristic",
      });
      return { status: result.state.feasibility.status, text: result.answerText };
    `);
    expect(out.status).toBe("NOT_ANSWERABLE_AS_REQUESTED");
    expect(out.text).toMatch(/not operating/i);
  });
});
