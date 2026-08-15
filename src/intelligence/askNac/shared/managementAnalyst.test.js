/**
 * Parameterized management analyst tests: benchmarks, anomalies, trends, breadth, contributors.
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

const HELPER = `
  const day = { startDate: "2026-08-14", endDate: "2026-08-14", label: "14 August 2026" };
  const mtd = { startDate: "2026-08-01", endDate: "2026-08-14", label: "August MTD", semantic: "this_month" };
  function ev(metricOrEvent, value, period = mtd) {
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
  function fact(date, net_sales, covers = 300, orders = 110) {
    return { date, net_sales, covers, orders, avg_spend: covers ? net_sales / covers : null };
  }
  const priorFridays = [
    fact("2026-07-17", 22000, 310, 115),
    fact("2026-07-24", 22100, 312, 116),
    fact("2026-07-31", 21800, 305, 112),
    fact("2026-08-07", 21900, 308, 114),
  ];
  const yesterday = fact("2026-08-14", 23836.52, 331, 121);
  const history = [...priorFridays, yesterday];
  function synth(question, extra = {}) {
    const period = extra.period || day;
    const evidence = extra.evidence || [
      ev("net_sales", extra.sales ?? 23836.52, period),
      ev("covers", extra.covers ?? 331, period),
      ev("orders", extra.orders ?? 121, period),
      ev("avg_spend", extra.spend ?? 72.01, period),
    ];
    return mod.synthesizeDeterministicAnswer({
      question,
      branchId: extra.branchId || "khobar",
      period,
      comparisonPeriod: extra.comparisonPeriod || null,
      evidence,
      claims: [],
      coverage: extra.coverage || [mod.buildCoverageReport({
        domain: "sales",
        range: period,
        expectedRecords: extra.expected || 1,
        availableRecords: extra.available || 1,
      })],
      comparability: extra.comparability || null,
      primaryMetric: extra.primaryMetric || "sales",
      ranking: extra.ranking || null,
      rankingCount: extra.rankingCount || null,
      comparisonIntent: Boolean(extra.comparisonIntent),
      dailyFacts: extra.dailyFacts || [yesterday],
      historyDailyFacts: extra.historyDailyFacts || history,
      previousDailyFacts: extra.previousDailyFacts || [],
      analysisIntent: extra.analysisIntent,
      openingDate: extra.openingDate === undefined ? "2025-04-27" : extra.openingDate,
    });
  }
`;

describe("A. default benchmark selection", () => {
  test.each([
    ["Was yesterday good?", /previous four Fridays|previous 4 Fridays/i],
    ["Was that good?", /previous four Fridays|previous 4 Fridays/i],
  ])("%s uses same-weekday default", (question, re) => {
    const out = run(`
      ${HELPER}
      return synth(${JSON.stringify(question)}, { analysisIntent: "judgement" });
    `);
    expect(out).toMatch(re);
    expect(out).not.toMatch(/I can compare it with the previous same weekday/i);
  });

  test("MTD judgement uses elapsed prior month when history exists", () => {
    const out = run(`
      ${HELPER}
      const july = [];
      for (let d = 1; d <= 14; d++) {
        const dd = String(d).padStart(2, "0");
        july.push(fact("2026-07-" + dd, 40000, 500, 180));
      }
      const august = [];
      for (let d = 1; d <= 14; d++) {
        const dd = String(d).padStart(2, "0");
        august.push(fact("2026-08-" + dd, 42000, 520, 185));
      }
      return synth("Is this month strong?", {
        period: mtd,
        analysisIntent: "judgement",
        sales: 42000 * 14,
        covers: 520 * 14,
        expected: 14,
        available: 14,
        dailyFacts: august,
        historyDailyFacts: [...july, ...august],
      });
    `);
    expect(out).toMatch(/previous month|first 14 days/i);
    expect(out).toMatch(/above|strong|Yes/i);
  });
});

describe("B. explicit baseline precedence", () => {
  test("compared with normal Fridays is same-weekday, not a missing baseline", () => {
    const out = run(`
      const t = mod.resolveTurnSemantics({
        question: "How was Friday compared with normal Fridays?",
        branchHint: "khobar",
        referenceDate: ${REF},
      });
      return { compare: t.comparisonIntent, clarify: t.ambiguity.needsClarification, analysis: t.analysisIntent, period: t.period?.startDate };
    `);
    expect(out.clarify).toBe(false);
    expect(out.compare).toBe(false);
    expect(out.period).toBeTruthy();
  });

  test("compared with last Friday beats default weekday average", () => {
    const out = run(`
      ${HELPER}
      const evidence = [
        ev("net_sales", 23836.52, day),
        ev("covers", 331, day),
        ev("avg_spend", 72.01, day),
        ev("previous_net_sales", 20000, day),
        ev("previous_covers", 280, day),
        ev("previous_avg_spend", 71.4, day),
        ev("delta_pct", ((23836.52-20000)/20000)*100),
      ];
      return synth("Was yesterday good compared with last Friday?", {
        analysisIntent: "judgement",
        comparisonIntent: true,
        comparisonPeriod: { startDate: "2026-08-07", endDate: "2026-08-07", label: "last Friday" },
        evidence,
      });
    `);
    expect(out).toMatch(/stated baseline|last Friday|previous comparable period|versus/i);
    expect(out).not.toMatch(/previous four Fridays/i);
  });
});

describe("C. same-weekday judgement", () => {
  test("strong Friday vs recent Fridays", () => {
    const out = run(`
      ${HELPER}
      return synth("Was yesterday good?", { analysisIntent: "judgement" });
    `);
    expect(out).toMatch(/Yes|above/i);
    expect(out).toMatch(/%/);
  });

  test("weak Friday vs recent Fridays", () => {
    const out = run(`
      ${HELPER}
      const weak = fact("2026-08-14", 16000, 220, 90);
      return synth("Was Friday weak?", {
        analysisIntent: "judgement",
        sales: 16000,
        covers: 220,
        spend: 16000/220,
        dailyFacts: [weak],
        historyDailyFacts: [...priorFridays, weak],
      });
    `);
    expect(out).toMatch(/below|weak|No/i);
  });
});

describe("D. insufficient history", () => {
  test("does not invent a Friday judgement", () => {
    const out = run(`
      ${HELPER}
      return synth("Was yesterday good?", {
        analysisIntent: "judgement",
        historyDailyFacts: [yesterday],
        openingDate: "2026-08-10",
      });
    `);
    expect(out).toMatch(/isn't enough comparable Friday history/i);
    expect(out).not.toMatch(/^Yes\\./);
  });
});

describe("E. anomaly detection", () => {
  test("normal Friday is not an outlier versus Fridays", () => {
    const out = run(`
      ${HELPER}
      const normal = fact("2026-08-14", 22050, 310, 115);
      return synth("Was yesterday unusual?", {
        analysisIntent: "anomaly",
        sales: 22050,
        covers: 310,
        dailyFacts: [normal],
        historyDailyFacts: [...priorFridays, normal, fact("2026-07-10", 21950, 308, 114), fact("2026-07-03", 22150, 311, 115)],
      });
    `);
    expect(out).toMatch(/normal/i);
    expect(out).not.toMatch(/strong high outlier/i);
  });

  test("deep miss versus Fridays is a weak outlier", () => {
    const out = run(`
      ${HELPER}
      const weak = fact("2026-08-14", 9000, 140, 60);
      return synth("Was yesterday unusual?", {
        analysisIntent: "anomaly",
        sales: 9000,
        covers: 140,
        dailyFacts: [weak],
        historyDailyFacts: [...priorFridays, weak, fact("2026-07-10", 21950, 308, 114), fact("2026-07-03", 22150, 311, 115)],
      });
    `);
    expect(out).toMatch(/outlier|unusual|weak/i);
  });
});

describe("F. trend", () => {
  test.each([
    ["up", 1000, /upward/i],
    ["down", -1000, /downward/i],
    ["flat", 20, /flat|variation|noisy/i],
  ])("%s series", (_name, step, re) => {
    const out = run(`
      ${HELPER}
      const rows = [];
      for (let i = 0; i < 16; i++) {
        const date = mod.addIsoDays("2026-07-30", i);
        rows.push(fact(date, 20000 + i * ${step}, 300, 110));
      }
      return synth("Are sales trending up or down?", {
        analysisIntent: "trend",
        period: { startDate: "2026-08-14", endDate: "2026-08-14", label: "14 August" },
        dailyFacts: [rows[rows.length - 1]],
        historyDailyFacts: rows,
      });
    `);
    expect(out).toMatch(re);
    expect(out).not.toMatch(/collapsing/i);
  });

  test("insufficient trend history", () => {
    const out = run(`
      ${HELPER}
      return synth("Are sales trending down?", {
        analysisIntent: "trend",
        historyDailyFacts: [yesterday, fact("2026-08-13", 23000, 320, 118)],
      });
    `);
    expect(out).toMatch(/isn't enough completed daily history/i);
  });
});

describe("G. broad vs concentrated", () => {
  test("most matched days down is broad-based", () => {
    const out = run(`
      ${HELPER}
      const curr = [];
      const prev = [];
      for (let i = 0; i < 10; i++) {
        curr.push(fact(mod.addIsoDays("2026-08-05", i), 18000, 250, 100));
        prev.push(fact(mod.addIsoDays("2026-07-26", i), 22000, 300, 110));
      }
      const evidence = [
        ev("net_sales", 180000, mtd), ev("previous_net_sales", 220000, mtd),
        ev("covers", 2500, mtd), ev("previous_covers", 3000, mtd),
        ev("avg_spend", 72, mtd), ev("previous_avg_spend", 73.3, mtd),
        ev("delta_pct", ((180000-220000)/220000)*100),
        ev("covers_delta_pct", ((2500-3000)/3000)*100),
      ];
      return synth("Was it one bad day or broad weakness?", {
        analysisIntent: "breadth",
        period: { startDate: "2026-08-05", endDate: "2026-08-14", label: "last 10 days" },
        comparisonPeriod: { startDate: "2026-07-26", endDate: "2026-08-04", label: "previous 10" },
        comparisonIntent: true,
        expected: 10, available: 10,
        evidence,
        dailyFacts: curr,
        previousDailyFacts: prev,
        historyDailyFacts: [...prev, ...curr],
      });
    `);
    expect(out).toMatch(/broad-based/i);
  });

  test("one day explains the gap as concentrated", () => {
    const out = run(`
      ${HELPER}
      const curr = [];
      const prev = [];
      for (let i = 0; i < 10; i++) {
        const c = i === 0 ? 8000 : 22000;
        curr.push(fact(mod.addIsoDays("2026-08-05", i), c, i === 0 ? 120 : 305, 110));
        prev.push(fact(mod.addIsoDays("2026-07-26", i), 22000, 300, 110));
      }
      return synth("Was it one bad day or broad weakness?", {
        analysisIntent: "breadth",
        period: { startDate: "2026-08-05", endDate: "2026-08-14", label: "last 10 days" },
        comparisonPeriod: { startDate: "2026-07-26", endDate: "2026-08-04", label: "previous 10" },
        comparisonIntent: true,
        expected: 10, available: 10,
        dailyFacts: curr,
        previousDailyFacts: prev,
        historyDailyFacts: [...prev, ...curr],
        evidence: [
          ev("net_sales", 8000 + 21900*9, mtd), ev("previous_net_sales", 220000, mtd),
          ev("delta_pct", -5),
        ],
      });
    `);
    expect(out).toMatch(/one unusually weak|few unusually weak|concentrated/i);
  });
});

describe("H. daily contribution ranking", () => {
  test("names the weakest matched days", () => {
    const out = run(`
      ${HELPER}
      const curr = [
        fact("2026-08-07", 15000, 200, 90),
        fact("2026-08-08", 16000, 210, 92),
        fact("2026-08-09", 22000, 300, 110),
        fact("2026-08-10", 22100, 302, 111),
      ];
      const prev = [
        fact("2026-07-31", 22000, 300, 110),
        fact("2026-08-01", 22100, 301, 110),
        fact("2026-08-02", 21900, 298, 109),
        fact("2026-08-03", 21800, 297, 108),
      ];
      return synth("Which days hurt us most?", {
        analysisIntent: "contributors",
        period: { startDate: "2026-08-07", endDate: "2026-08-10", label: "those days" },
        comparisonPeriod: { startDate: "2026-07-31", endDate: "2026-08-03", label: "prior" },
        comparisonIntent: true,
        expected: 4, available: 4,
        dailyFacts: curr,
        previousDailyFacts: prev,
        historyDailyFacts: [...prev, ...curr],
      });
    `);
    expect(out).toMatch(/Friday, 7 August|Saturday, 8 August/i);
    expect(out).toMatch(/negative day gap/i);
  });
});

describe("I. volume-led plus anomaly", () => {
  test("why combines driver language without invented causes", () => {
    const out = run(`
      ${HELPER}
      const evidence = [
        ev("net_sales", 20000, day), ev("previous_net_sales", 24000, day),
        ev("covers", 260, day), ev("previous_covers", 330, day),
        ev("avg_spend", 76.9, day), ev("previous_avg_spend", 72.7, day),
        ev("delta_pct", ((20000-24000)/24000)*100),
        ev("covers_delta_pct", ((260-330)/330)*100),
        ev("avg_spend_delta_pct", ((76.9-72.7)/72.7)*100),
      ];
      return synth("Why were sales down?", {
        analysisIntent: "why",
        comparisonIntent: true,
        comparisonPeriod: { startDate: "2026-08-07", endDate: "2026-08-07", label: "last Friday" },
        evidence,
      });
    `);
    expect(out).toMatch(/covers|volume|traffic/i);
    expect(out).not.toMatch(/weather|staffing|marketing|competition/i);
  });
});

describe("J. one-off vs sustained", () => {
  test("weak Friday with flat Friday trend is a one-off", () => {
    const out = run(`
      ${HELPER}
      const rows = [];
      const fridays = ["2026-05-15","2026-05-22","2026-05-29","2026-06-05","2026-06-12","2026-06-19","2026-06-26","2026-07-03","2026-07-10","2026-07-17","2026-07-24","2026-07-31","2026-08-07","2026-08-14"];
      fridays.forEach((d, i) => {
        rows.push(fact(d, i === fridays.length - 1 ? 15000 : 22000, i === fridays.length - 1 ? 200 : 310, 114));
      });
      for (let i = 0; i < 20; i++) {
        const date = mod.addIsoDays("2026-07-20", i);
        if (fridays.includes(date)) continue;
        rows.push(fact(date, 19000, 280, 100));
      }
      const weak = rows.find((r) => r.date === "2026-08-14");
      return synth("Was yesterday unusual?", {
        analysisIntent: "anomaly",
        sales: 15000, covers: 200,
        dailyFacts: [weak],
        historyDailyFacts: rows,
      });
    `);
    expect(out).toMatch(/one-off|unusual|outlier|weak/i);
  });
});

describe("K. partial coverage safety", () => {
  test("matched partial coverage still mentions like-for-like", () => {
    const out = run(`
      ${HELPER}
      const evidence = [
        ev("net_sales", 148335, mtd), ev("previous_net_sales", 135000, mtd),
        ev("delta_pct", ((148335-135000)/135000)*100),
        ev("covers", 2196, mtd), ev("previous_covers", 1980, mtd),
      ];
      return synth("How did this month compare with last month?", {
        period: mtd, primaryMetric: "sales", comparisonIntent: true,
        comparability: { status: "partially_comparable", recommendedMethod: "matched_days", weekdayComposition: { match: true } },
        expected: 10, available: 9, evidence, analysisIntent: null,
        dailyFacts: [], historyDailyFacts: [],
      });
    `);
    expect(out).toMatch(/like-for-like/i);
    expect(out).toMatch(/9\/10/);
  });
});

describe("L. branch operating history", () => {
  test("pre-opening days are not used as zeros", () => {
    const out = run(`
      ${HELPER}
      return synth("Was yesterday good?", {
        analysisIntent: "judgement",
        historyDailyFacts: [fact("2025-04-20", 0, 0, 0), yesterday],
        openingDate: "2025-04-27",
      });
    `);
    expect(out).toMatch(/isn't enough comparable Friday history/i);
  });
});

describe("M. why safety", () => {
  test("rejects weather causality", () => {
    const out = run(`
      ${HELPER}
      const evidence = [
        ev("net_sales", 20000, day), ev("previous_net_sales", 24000, day),
        ev("covers", 260, day), ev("previous_covers", 330, day),
        ev("avg_spend", 76.9, day), ev("previous_avg_spend", 72.7, day),
        ev("delta_pct", -16.7), ev("covers_delta_pct", -21.2), ev("avg_spend_delta_pct", 5.8),
      ];
      return synth("Why were sales down because of the weather?", {
        analysisIntent: "why", comparisonIntent: true,
        comparisonPeriod: { startDate: "2026-08-07", endDate: "2026-08-07", label: "last Friday" },
        evidence,
      });
    `);
    expect(out).toMatch(/don't have connected evidence|will not infer/i);
    expect(out).not.toMatch(/because of the weather, sales/i);
  });
});

describe("N. what stands out prioritization", () => {
  test("returns a short set of findings not a dump", () => {
    const out = run(`
      ${HELPER}
      return synth("What stands out?", {
        analysisIntent: "stands_out",
        period: day,
      });
    `);
    expect(out.length).toBeLessThan(900);
    expect(out).not.toMatch(/Benchmark score/i);
  });
});

describe("O. presentation grammar/date/rounding", () => {
  test("average spend uses was, ranking uses weekday dates", () => {
    const out = run(`
      ${HELPER}
      const evidence = [
        ev("net_sales", 23836.52, day), ev("previous_net_sales", 22000, day),
        ev("avg_spend", 80, day), ev("previous_avg_spend", 70, day),
        ev("avg_spend_delta_pct", ((80-70)/70)*100),
        ev("delta_pct", 8.3),
      ];
      const spend = synth("Average spend compared with last Friday?", {
        primaryMetric: "avg_spend", comparisonIntent: true,
        comparisonPeriod: { startDate: "2026-08-07", endDate: "2026-08-07", label: "last Friday" },
        evidence, analysisIntent: null, dailyFacts: [], historyDailyFacts: [],
      });
      const rank = synth("Best 3 sales days", {
        ranking: "top", rankingCount: 3, analysisIntent: null,
        period: mtd, expected: 14, available: 14,
        dailyFacts: [
          fact("2026-08-01", 30000, 400, 140),
          fact("2026-08-02", 28000, 380, 130),
          fact("2026-08-03", 26000, 360, 120),
        ],
        historyDailyFacts: [],
      });
      return { spend, rank, date: mod.formatManagerDate("2026-08-01") };
    `);
    expect(out.spend).toMatch(/Average spend was/i);
    expect(out.spend).not.toMatch(/Average spend were/i);
    expect(out.rank).toMatch(/Saturday, 1 August/);
    expect(out.rank).not.toMatch(/2026-08-01:/);
    expect(out.date).toBe("Saturday, 1 August");
  });
});

describe("P. RBAC", () => {
  test("unauthorized Riyadh follow-up stays Khobar", () => {
    const out = run(`
      const scope = mod.createIntelligenceScope({
        primaryBranchId: "khobar",
        branchIds: ["khobar"],
        allowedBranchIds: ["khobar"],
        canSeeNetwork: false,
        role: "branch_manager",
      });
      const t1 = await mod.runCompanyIntelligenceOrchestration({
        question: "How were sales yesterday?",
        scope, branchHint: "khobar", referenceDate: ${REF}, mode: "heuristic",
      });
      const t2 = await mod.runCompanyIntelligenceOrchestration({
        question: "What about Riyadh?",
        conversation: t1.nextConversation,
        scope, branchHint: "khobar", referenceDate: ${REF}, mode: "heuristic",
      });
      return { b1: t1.state.scope.primaryBranchId, b2: t2.state.scope.primaryBranchId };
    `);
    expect(out.b1).toBe("khobar");
    expect(out.b2).toBe("khobar");
  });
});

describe("semantics: analysis intents and routing", () => {
  test.each([
    ["Was yesterday good?", "judgement"],
    ["Was that unusual?", "anomaly"],
    ["Are sales trending down?", "trend"],
    ["Why?", "why"],
    ["What stands out?", "stands_out"],
    ["Which days hurt us most?", "contributors"],
    ["Was it one bad day or broad weakness?", "breadth"],
    ["What should I pay attention to?", "action"],
  ])("%s → %s", (q, intent) => {
    const out = run(`
      const t = mod.resolveTurnSemantics({ question: ${JSON.stringify(q)}, branchHint: "khobar", referenceDate: ${REF} });
      const prev = mod.resolveTurnSemantics({ question: "How did we do yesterday?", branchHint: "khobar", referenceDate: ${REF} });
      const t2 = mod.resolveTurnSemantics({ question: ${JSON.stringify(q)}, previous: prev.conversation, referenceDate: ${REF} });
      return {
        intent: t.analysisIntent,
        follow: t2.analysisIntent,
        clarify: t2.ambiguity.needsClarification,
        fabric: mod.isManagementIntelligenceQuestion(${JSON.stringify(q)}, { intent: "unknown", confidence: "none" }, { priorFabricConversation: prev.conversation, referenceDate: ${REF} }),
      };
    `);
    expect(out.follow || out.intent).toBe(intent);
    expect(out.clarify).toBe(false);
    expect(out.fabric).toBe(true);
  });
});

describe("action-turn composition", () => {
  test("what should I pay attention to does not dump the metric bundle", () => {
    const out = run(`
      ${HELPER}
      const august = [];
      for (let d = 1; d <= 14; d++) {
        august.push(fact("2026-08-" + String(d).padStart(2, "0"), 18000, 250, 100));
      }
      const july = [];
      for (let d = 1; d <= 14; d++) {
        july.push(fact("2026-07-" + String(d).padStart(2, "0"), 22000, 320, 110));
      }
      return synth("What should I pay attention to?", {
        period: mtd,
        analysisIntent: "action",
        sales: 18000 * 14,
        covers: 250 * 14,
        expected: 14,
        available: 14,
        dailyFacts: august,
        historyDailyFacts: [...july, ...august],
        previousDailyFacts: july,
        comparisonIntent: true,
        comparisonPeriod: { startDate: "2026-07-01", endDate: "2026-07-14", label: "1–14 July" },
        evidence: [
          ev("net_sales", 18000 * 14, mtd), ev("previous_net_sales", 22000 * 14),
          ev("covers", 250 * 14, mtd), ev("previous_covers", 320 * 14),
          ev("orders", 100 * 14, mtd), ev("previous_orders", 110 * 14),
          ev("avg_spend", 72, mtd), ev("previous_avg_spend", 68.75),
        ],
      });
    `);
    expect(out).toMatch(/main thing to watch/i);
    expect(out).not.toMatch(/Covers were \d|Orders were \d|Average spend was/i);
  });
});
