/**
 * Synthetic invariants: answers must not contradict the evidence they are built from.
 */
const path = require("path");
const { execFileSync } = require("child_process");
const { pairDailyBreakdownsByOffset, buildMatchedCoverageComparison } = require("../vault/cashUpMatchedCoverageComparison");

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

function makeDay(date, sales, guests, orders) {
  return { date, totalSales: sales, totalGuests: guests, totalOrders: orders, averageSpend: guests ? sales / guests : null };
}

describe("canonical matched population", () => {
  test("headline helper and contributor pairing share the same dates", () => {
    const current = {
      totalSales: 180000,
      dayCount: 10,
      requestedStartDate: "2026-08-05",
      requestedEndDate: "2026-08-14",
      dailyBreakdown: Array.from({ length: 10 }, (_, i) => {
        const d = `2026-08-${String(5 + i).padStart(2, "0")}`;
        return makeDay(d, i === 0 ? 8000 : 19111, 250, 100);
      }),
    };
    const previous = {
      totalSales: 220000,
      dayCount: 10,
      requestedStartDate: "2026-07-26",
      requestedEndDate: "2026-08-04",
      dailyBreakdown: Array.from({ length: 10 }, (_, i) => {
        const start = new Date("2026-07-26T12:00:00Z");
        start.setUTCDate(start.getUTCDate() + i);
        const d = start.toISOString().slice(0, 10);
        return makeDay(d, 22000, 300, 110);
      }),
    };
    const comparison = buildMatchedCoverageComparison(current, previous);
    const pairs = pairDailyBreakdownsByOffset(current, previous);
    expect(comparison.matchedPairs.map((p) => p.currentDate)).toEqual(pairs.map((p) => p.currentDate));
    const pairNet = pairs.reduce((s, p) => s + (p.currentSales - p.previousSales), 0);
    const headlineDelta = comparison.mode === "full"
      ? current.totalSales - previous.totalSales
      : (comparison.currentMatched.totalSales - comparison.previousMatched.totalSales);
    expect(Math.sign(pairNet)).toBe(Math.sign(headlineDelta));
  });
});

describe("synthetic answer invariants", () => {
  test("A. volume-led decline never called spend-led", () => {
    const out = run(`
      const period = { startDate: "2026-08-05", endDate: "2026-08-14", label: "last 10 days" };
      const prev = { startDate: "2026-07-26", endDate: "2026-08-04", label: "previous 10" };
      const curr = []; const previous = [];
      for (let i = 0; i < 10; i++) {
        curr.push({ date: mod.addIsoDays("2026-08-05", i), net_sales: 18000, covers: 250, orders: 100, avg_spend: 72 });
        previous.push({ date: mod.addIsoDays("2026-07-26", i), net_sales: 22000, covers: 305, orders: 110, avg_spend: 72.1 });
      }
      return mod.synthesizeDeterministicAnswer({
        question: "Why were sales down?",
        branchId: "khobar",
        period, comparisonPeriod: prev, comparisonIntent: true,
        analysisIntent: "why", primaryMetric: "sales",
        evidence: [
          mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "net_sales", value: 180000, textSummary: "s", period }),
          mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "previous_net_sales", value: 220000, textSummary: "p", period: prev }),
          mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "covers", value: 2500, textSummary: "c", period }),
          mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "previous_covers", value: 3050, textSummary: "pc", period: prev }),
          mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "avg_spend", value: 72, textSummary: "a", period }),
          mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "previous_avg_spend", value: 72.1, textSummary: "pa", period: prev }),
          mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "delta_pct", value: ((180000-220000)/220000)*100, textSummary: "d", period }),
        ],
        claims: [], coverage: [], dailyFacts: curr, previousDailyFacts: previous, historyDailyFacts: [...previous, ...curr],
        openingDate: "2025-04-27",
      });
    `);
    expect(out).toMatch(/volume|covers|traffic/i);
    expect(out).not.toMatch(/spend-led|mainly associated with lower spend/i);
  });

  test("B. negative headline never renders increase", () => {
    const out = run(`
      const period = { startDate: "2026-08-05", endDate: "2026-08-14", label: "last 10 days" };
      const prev = { startDate: "2026-07-26", endDate: "2026-08-04", label: "previous 10" };
      return mod.synthesizeDeterministicAnswer({
        question: "How did last 10 days compare with the previous 10?",
        branchId: "khobar", period, comparisonPeriod: prev, comparisonIntent: true, primaryMetric: "sales",
        evidence: [
          mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "net_sales", value: 180000, textSummary: "s", period }),
          mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "previous_net_sales", value: 220000, textSummary: "p", period: prev }),
          mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "delta_pct", value: -18.18, textSummary: "d", period }),
        ],
        claims: [], coverage: [],
        comparability: { status: "comparable", recommendedMethod: "matched_days" },
        openingDate: "2025-04-27",
      });
    `);
    expect(out.toLowerCase()).toMatch(/down|lower|decline/);
    expect(out.toLowerCase()).not.toMatch(/\bincrease\b|\bwere up\b/);
  });

  test("C. all matched days down is not concentrated on a positive day", () => {
    const out = run(`
      const period = { startDate: "2026-08-05", endDate: "2026-08-14", label: "last 10 days" };
      const prev = { startDate: "2026-07-26", endDate: "2026-08-04", label: "previous 10" };
      const curr = []; const previous = [];
      for (let i = 0; i < 10; i++) {
        curr.push({ date: mod.addIsoDays("2026-08-05", i), net_sales: 18000, covers: 250, orders: 100, avg_spend: 72 });
        previous.push({ date: mod.addIsoDays("2026-07-26", i), net_sales: 22000, covers: 300, orders: 110, avg_spend: 73 });
      }
      return mod.synthesizeDeterministicAnswer({
        question: "Was it one bad day or broad weakness?",
        branchId: "khobar", period, comparisonPeriod: prev, comparisonIntent: true,
        analysisIntent: "breadth", primaryMetric: "sales",
        evidence: [
          mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "net_sales", value: 180000, textSummary: "s", period }),
          mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "previous_net_sales", value: 220000, textSummary: "p", period: prev }),
          mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "delta_pct", value: -18.18, textSummary: "d", period }),
        ],
        claims: [], coverage: [], dailyFacts: curr, previousDailyFacts: previous, historyDailyFacts: [...previous, ...curr],
        openingDate: "2025-04-27",
      });
    `);
    expect(out).toMatch(/broad-based/i);
    expect(out).not.toMatch(/one unusually strong day/i);
  });

  test("D. same-weekday normal cannot be a strong outlier", () => {
    const out = run(`
      const day = { startDate: "2026-08-14", endDate: "2026-08-14", label: "14 August 2026" };
      const prior = [
        { date: "2026-07-17", net_sales: 22000, covers: 310, orders: 115, avg_spend: 71 },
        { date: "2026-07-24", net_sales: 22100, covers: 312, orders: 116, avg_spend: 70.8 },
        { date: "2026-07-31", net_sales: 21800, covers: 305, orders: 112, avg_spend: 71.5 },
        { date: "2026-08-07", net_sales: 21900, covers: 308, orders: 114, avg_spend: 71.1 },
      ];
      const yesterday = { date: "2026-08-14", net_sales: 22050, covers: 310, orders: 115, avg_spend: 71.1 };
      return mod.synthesizeDeterministicAnswer({
        question: "Was yesterday unusual?",
        branchId: "khobar", period: day, analysisIntent: "anomaly", primaryMetric: "sales",
        evidence: [
          mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "net_sales", value: 22050, textSummary: "s", period: day }),
          mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "covers", value: 310, textSummary: "c", period: day }),
        ],
        claims: [], coverage: [], dailyFacts: [yesterday], historyDailyFacts: [...prior, yesterday],
        openingDate: "2025-04-27",
      });
    `);
    expect(out).toMatch(/normal/i);
    expect(out).not.toMatch(/strong (high )?outlier|unusually weak/i);
    expect(out).not.toMatch(/mildly unusual/i);
  });

  test("E. partial coverage does not claim a complete period", () => {
    const out = run(`
      const mtd = { startDate: "2026-08-01", endDate: "2026-08-14", label: "August MTD", semantic: "this_month" };
      return mod.synthesizeDeterministicAnswer({
        question: "How did we do this month?",
        branchId: "khobar", period: mtd, primaryMetric: "sales",
        evidence: [
          mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "net_sales", value: 148335, textSummary: "s", period: mtd }),
        ],
        claims: [],
        coverage: [mod.buildCoverageReport({ domain: "sales", range: mtd, expectedRecords: 14, availableRecords: 9 })],
        openingDate: "2025-04-27",
      });
    `);
    expect(out.toLowerCase()).not.toMatch(/complete month|complete period/);
  });

  test("G. unsupported baseline does not force yes/no judgement", () => {
    const out = run(`
      const day = { startDate: "2026-08-14", endDate: "2026-08-14", label: "14 August 2026" };
      return mod.synthesizeDeterministicAnswer({
        question: "Was yesterday good?",
        branchId: "khobar", period: day, analysisIntent: "judgement", primaryMetric: "sales",
        evidence: [
          mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "net_sales", value: 23836.52, textSummary: "s", period: day }),
        ],
        claims: [], coverage: [], dailyFacts: [{ date: "2026-08-14", net_sales: 23836.52, covers: 331, orders: 121, avg_spend: 72.01 }],
        historyDailyFacts: [{ date: "2026-08-14", net_sales: 23836.52, covers: 331, orders: 121, avg_spend: 72.01 }],
        openingDate: "2026-08-10",
      });
    `);
    expect(out).toMatch(/isn't enough comparable Friday history/i);
    expect(out).not.toMatch(/^Yes\\./);
  });
});
