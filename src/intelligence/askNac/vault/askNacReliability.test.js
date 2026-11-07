import { parseVaultPeriodFromQuestion } from "./vaultPeriodParser";
import { isComparisonAnalysisFollowUp } from "../conversation/comparisonContinuity";
import { buildCashUpPeriodAggregateAnswer } from "./vaultSalesPerformanceIntelligence";
import { resolveAnalyticalConfidence } from "../confidence/analyticalConfidence";
import { CONFIDENCE_LEVELS } from "../askNacContract";

const REF = new Date("2026-10-16T12:00:00+03:00");

describe("Ask NAC period and answer integrity", () => {
  test("sales 2 days ago is 14 October 2026, not a seven-day window", () => {
    const period = parseVaultPeriodFromQuestion("What was the sales 2 days ago?", REF);
    expect(period).toMatchObject({
      startDate: "2026-10-14",
      endDate: "2026-10-14",
      periodType: "single_day",
      isSingleDay: true,
      expectedDayCount: 1,
    });
  });

  test("sales yesterday is 15 October 2026", () => {
    const period = parseVaultPeriodFromQuestion("What were sales yesterday?", REF);
    expect(period).toMatchObject({
      startDate: "2026-10-15",
      endDate: "2026-10-15",
      isSingleDay: true,
    });
  });

  test("in September is the full month, not 30 September", () => {
    const period = parseVaultPeriodFromQuestion(
      "How much in September was delivery app sales, and how many total orders?",
      REF,
    );
    expect(period).toMatchObject({
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      periodType: "named_month",
    });
  });

  test("an explicit month is not treated as a follow-up that reuses the previous day", () => {
    expect(isComparisonAnalysisFollowUp(
      "How much in September was delivery app sales, and how many total orders?",
    )).toBe(false);
    expect(isComparisonAnalysisFollowUp("orders")).toBe(true);
  });

  test("a delivery-and-orders question returns both metrics for the same period", () => {
    const answer = buildCashUpPeriodAggregateAnswer(
      "How much in September was delivery platform net sales, and how many total orders?",
      {
        totalDeliverySales: 22000,
        totalOrders: 4100,
        totalSales: 400000,
        dayCount: 30,
        expectedDayCount: 30,
      },
      { branchLabel: "Khobar", periodLabel: "September 2026" },
    );
    expect(answer).toMatch(/delivery-app sales/);
    expect(answer).toMatch(/22,000/);
    expect(answer).toMatch(/Total orders/);
    expect(answer).toMatch(/4,100/);
    expect(answer).toMatch(/September 2026/);
    expect(answer).not.toMatch(/13,842/);
  });

  test("a period mismatch is not high confidence", () => {
    const result = resolveAnalyticalConfidence({
      route: {
        vaultPeriod: {
          startDate: "2026-09-01",
          endDate: "2026-09-30",
          label: "September 2026",
          periodType: "named_month",
        },
      },
      tool: {
        startDate: "2026-09-30",
        endDate: "2026-09-30",
        aggregation: { dayCount: 1, totalSales: 13842.61, salesCoverageStart: "2026-09-30", salesCoverageEnd: "2026-09-30" },
      },
    });
    expect(result.level).toBe(CONFIDENCE_LEVELS.LOW);
    expect(result.explanation).toMatch(/September 2026/);
    expect(result.explanation).toMatch(/2026-09-30/);
  });

  test("a missing October day does not borrow another date", () => {
    const answer = buildCashUpPeriodAggregateAnswer(
      "What was the sales 2 days ago?",
      { totalSales: null, dayCount: 0, expectedDayCount: 1, latestCompletedDate: "2026-09-30" },
      { branchLabel: "Khobar", periodLabel: "14 October 2026" },
    );
    expect(answer).toMatch(/14 October 2026|No cash-up sales data/);
    expect(answer).not.toMatch(/13,842/);
  });
});
