import {
  applyRestaurantHeuristics,
  buildEvidenceMap,
  buildRankedHypotheses,
  rankHypotheses,
} from "./executiveIntelligence";
import {
  shouldUseCashUpRangeRpc,
  mapRpcAggregationRow,
} from "../vault/vaultCashUpRangeRpc";
import {
  getCachedVaultCoverage,
  setCachedVaultCoverage,
  clearVaultCoverageCache,
} from "../vault/vaultCoverageCache";

describe("executiveIntelligence", () => {
  test("detects traffic problem when guests down and spend stable", () => {
    const result = applyRestaurantHeuristics(
      { totalGuests: 80, averageSpend: 100, totalSales: 8000 },
      { totalGuests: 100, averageSpend: 102, totalSales: 10200 },
    );
    expect(result.heuristics.some((h) => h.id === "traffic_problem")).toBe(true);
    expect(result.interpretation).toMatch(/traffic-driven/i);
  });

  test("detects spending problem when guests stable and spend down", () => {
    const result = applyRestaurantHeuristics(
      { totalGuests: 100, averageSpend: 80, totalSales: 8000 },
      { totalGuests: 100, averageSpend: 100, totalSales: 10000 },
    );
    expect(result.heuristics.some((h) => h.id === "spending_problem")).toBe(true);
  });

  test("ranks hypotheses by confidence", () => {
    const ranked = rankHypotheses([
      { hypothesis: "low", confidence: "low", evidence: [] },
      { hypothesis: "high", confidence: "high", evidence: ["a"] },
      { hypothesis: "medium", confidence: "medium", evidence: [] },
    ]);
    expect(ranked[0].confidence).toBe("high");
    expect(ranked[2].confidence).toBe("low");
  });

  test("buildEvidenceMap distinguishes facts from assumptions", () => {
    const map = buildEvidenceMap({
      conclusion: "Traffic issue",
      metrics: [{ label: "Guests", value: "80" }],
      facts: ["Guests down 20%"],
      branchMemory: [{ fact: "Humidity impacts walk-ins", category: "demand_driver" }],
      assumptions: ["Weather may have contributed"],
    });
    expect(map.supportingMetrics[0].type).toBe("fact");
    expect(map.supportingMemory[0].type).toBe("memory");
    expect(map.assumptions[0].type).toBe("assumption");
  });

  test("buildRankedHypotheses merges heuristics and NIL hypotheses", () => {
    const ranked = buildRankedHypotheses({
      heuristics: [{ hypothesis: "Traffic problem", confidence: "medium" }],
      nilHypotheses: [{ text: "Delivery offset", confidence: "low" }],
      metrics: [{ label: "Sales", value: "10k" }],
    });
    expect(ranked.length).toBe(2);
    expect(ranked[0].source).toBe("heuristic");
  });
});

describe("vaultCashUpRangeRpc", () => {
  test("uses RPC for YTD when daily breakdown skipped", () => {
    expect(shouldUseCashUpRangeRpc({
      startDate: "2026-01-01",
      endDate: "2026-06-20",
      periodType: "year_to_date",
      includeDailyBreakdown: false,
    })).toBe(true);
  });

  test("does not use RPC when daily breakdown required", () => {
    expect(shouldUseCashUpRangeRpc({
      startDate: "2026-06-01",
      endDate: "2026-06-20",
      periodType: "this_month",
      includeDailyBreakdown: true,
    })).toBe(false);
  });

  test("maps RPC aggregation row", () => {
    const agg = mapRpcAggregationRow({
      totalSales: 1000000,
      dayCount: 78,
      deliveryPlatformBreakdown: { jahez: { sales: 100 } },
      dailyBreakdown: [],
    });
    expect(agg.totalSales).toBe(1000000);
    expect(agg.dayCount).toBe(78);
    expect(agg.deliveryPlatformBreakdown.jahez.sales).toBe(100);
  });
});

describe("vaultCoverageCache", () => {
  beforeEach(() => clearVaultCoverageCache());

  test("caches and retrieves coverage results", () => {
    const key = { branch: "khobar", startDate: "2026-01-01", endDate: "2026-06-20", reportType: "cash_up", slim: true };
    setCachedVaultCoverage(key, { coverage: [{ reportType: "cash_up" }] });
    expect(getCachedVaultCoverage(key).coverage).toHaveLength(1);
  });
});
