import {
  aggregateCashUpFactsOverRange,
  groupCashUpFactsByBusinessDate,
} from "../vault/vaultCashUpAggregation";
import {
  buildManagementComparison,
  buildPeriodSide,
  contributionFromDailyFacts,
  deltaPair,
  formatManagementComparison,
  managementBriefForCashUp,
  rankDailyFacts,
  trendFromDailyFacts,
} from "./managementAnalysis";

const AUGUST = buildPeriodSide({
  label: "August 2026",
  start: "2026-08-01",
  end: "2026-08-31",
  days: 31,
  sales: 494904.26,
  covers: 6605,
  orders: 2867,
});

const SEPTEMBER = buildPeriodSide({
  label: "September 1–24",
  start: "2026-09-01",
  end: "2026-09-24",
  days: 24,
  sales: 403481.17,
  covers: 5155,
  orders: 2335,
});

describe("comparison direction contract", () => {
  test("September relative to August uses August as the denominator", () => {
    const model = buildManagementComparison({ baseline: AUGUST, subject: SEPTEMBER });
    expect(model.sales.delta).toBeCloseTo(-91423.09, 2);
    expect(model.sales.deltaPct).toBeCloseTo(-18.4728, 3);
    expect(model.comparisonMode).toBe("full_vs_open");
    const text = formatManagementComparison(model);
    expect(text).toMatch(/September 1–24 vs August 2026: -91,423\.09 SAR \(-18\.47%\)/);
    expect(text).toMatch(/24 represented days versus August 2026's 31/);
    expect(text).not.toMatch(/\bChange:/);
    expect(text).toMatch(/per-day basis/);
    expect(text).not.toMatch(/performing worse/);
  });

  test("August relative to September reverses the sign and denominator", () => {
    const model = buildManagementComparison({ baseline: SEPTEMBER, subject: AUGUST });
    expect(model.sales.delta).toBeCloseTo(91423.09, 2);
    expect(model.sales.deltaPct).toBeCloseTo(22.6586, 3);
    const text = formatManagementComparison(model);
    expect(text).toMatch(/August 2026 vs September 1–24: \+91,423\.09 SAR \(\+22\.66%\)/);
  });

  test("like-for-like August 1–24 versus September 1–24", () => {
    const august24 = buildPeriodSide({
      label: "August 1–24",
      days: 24,
      sales: 385000.52,
      covers: 5400,
      orders: 2244,
    });
    const model = buildManagementComparison({ baseline: august24, subject: SEPTEMBER });
    expect(model.comparisonMode).toBe("like_for_like");
    expect(model.sales.delta).toBeCloseTo(403481.17 - 385000.52, 2);
    expect(model.sales.deltaPct).toBeGreaterThan(0);
    expect(formatManagementComparison(model)).toMatch(/Like-for-like comparison/);
  });

  test("zero denominator does not produce Infinity", () => {
    expect(deltaPair(100, 0)).toEqual({ delta: 100, deltaPct: null, reason: "zero_denominator" });
    const model = buildManagementComparison({
      baseline: buildPeriodSide({ label: "Empty", days: 1, sales: 0, covers: 0, orders: 0 }),
      subject: buildPeriodSide({ label: "Some", days: 1, sales: 10, covers: 1, orders: 1 }),
    });
    expect(model.sales.deltaPct).toBeNull();
    expect(formatManagementComparison(model)).not.toMatch(/Infinity|NaN/);
  });
});

describe("rankings, trends, and mix", () => {
  const rows = [
    { date: "2026-09-01", totalSales: 100, totalGuests: 10, totalOrders: 4 },
    { date: "2026-09-02", totalSales: null, totalGuests: null, totalOrders: null },
    { date: "2026-09-03", totalSales: 400, totalGuests: 20, totalOrders: 8 },
    { date: "2026-09-04", totalSales: 400, totalGuests: 10, totalOrders: 5 },
    { date: "2026-09-05", totalSales: 50, totalGuests: 5, totalOrders: 2 },
  ];

  test("missing days are excluded rather than ranked as zero", () => {
    const ranked = rankDailyFacts(rows, { metric: "sales", direction: "bottom", limit: 5 });
    expect(ranked.map((row) => row.date)).toEqual(["2026-09-05", "2026-09-01", "2026-09-03", "2026-09-04"]);
    expect(ranked.find((row) => row.date === "2026-09-02")).toBeUndefined();
    const top = rankDailyFacts(rows, { metric: "sales", direction: "top", limit: 2 });
    expect(top[0].date).toBe("2026-09-03");
    expect(top[1].tiedWithPrevious).toBe(true);
  });

  test("latest 7 represented days are compared with the preceding 7", () => {
    const series = Array.from({ length: 14 }, (_, index) => ({
      date: `2026-09-${String(index + 1).padStart(2, "0")}`,
      totalSales: index < 7 ? 100 : 150,
    }));
    const trend = trendFromDailyFacts(series, "sales");
    expect(trend.method).toBe("latest_7_vs_preceding_7");
    expect(trend.precedingAverage).toBe(100);
    expect(trend.latestAverage).toBe(150);
    expect(trend.deltaPct).toBeCloseTo(50, 5);
    expect(trend.direction).toBe("up");
  });

  test("top 5 share ignores days without sales", () => {
    const mix = contributionFromDailyFacts(rows);
    expect(mix.representedDays).toBe(4);
    expect(mix.total).toBe(950);
    expect(mix.topShare).toBeCloseTo(100, 5);
  });

  test("canonical duplicate facts count once before ranking", () => {
    const facts = [
      {
        metric_key: "net_sales",
        metric_value: 100,
        dimensions: {},
        period_end: "2026-09-01",
        created_at: "2026-09-02T00:00:00Z",
        source_row_ref: "pdf-day-2026-09-01",
      },
      {
        metric_key: "net_sales",
        metric_value: 180,
        dimensions: {},
        period_end: "2026-09-01",
        created_at: "2026-09-25T00:00:00Z",
        file_version_id: "version-1",
        source_row_ref: "sheet-9-row-3",
      },
      {
        metric_key: "net_sales",
        metric_value: 90,
        dimensions: {},
        period_end: "2026-09-02",
        created_at: "2026-09-25T00:00:00Z",
        file_version_id: "version-1",
        source_row_ref: "sheet-9-row-4",
      },
    ];
    const aggregation = aggregateCashUpFactsOverRange({
      startDate: "2026-09-01",
      endDate: "2026-09-02",
      factsByDate: groupCashUpFactsByBusinessDate(facts),
      includeDailyBreakdown: true,
    });
    expect(aggregation.totalSales).toBeCloseTo(270, 5);
    const ranked = rankDailyFacts(aggregation.dailyBreakdown, { metric: "sales", direction: "top", limit: 2 });
    expect(ranked[0]).toMatchObject({ date: "2026-09-01", value: 180 });
    expect(ranked).toHaveLength(2);
    const brief = managementBriefForCashUp({
      question: "best sales day",
      daily: aggregation.dailyBreakdown,
      label: "September",
    });
    expect(brief).toMatch(/2026-09-01/);
    expect(brief).not.toMatch(/\b280\b/);
  });

  test("why follow-up states measured differences and refuses unproven causes", () => {
    const brief = managementBriefForCashUp({
      question: "why?",
      baseline: AUGUST,
      subject: SEPTEMBER,
    });
    expect(brief).toMatch(/Measured differences/);
    expect(brief).toMatch(/Unproven causes are not in this evidence/);
    expect(brief).toMatch(/-91,423\.09 SAR/);
    expect(brief).not.toMatch(/causal_question_without_explanatory_evidence/);
  });
});
