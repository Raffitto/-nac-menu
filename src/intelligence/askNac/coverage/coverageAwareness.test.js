import { assessPeriodCoverage, buildCoverageAnswerLines } from "./coverageAwareness";

describe("coverageAwareness", () => {
  test("partial YTD coverage is stated clearly", () => {
    const assessment = assessPeriodCoverage({
      requestedPeriod: {
        startDate: "2026-01-01",
        endDate: "2026-06-23",
        label: "2026 year-to-date",
        periodType: "year_to_date",
      },
      aggregation: {
        dayCount: 45,
        dailyBreakdown: [
          { date: "2026-01-02", totalSales: 1000, totalDeliveryOrders: null },
          { date: "2026-03-01", totalSales: 1200, totalDeliveryOrders: 50 },
        ],
        totalSales: 50000,
        totalDeliverySales: 8000,
        totalDeliveryOrders: 500,
        salesCoverageStart: "2026-01-02",
        salesCoverageEnd: "2026-05-31",
        deliveryOrderCoverageStart: "2026-03-01",
      },
    });

    expect(assessment.completeness).toBe("partial");
    expect(assessment.coverageNotes.some((n) => /delivery tracking began/i.test(n))).toBe(true);
    const lines = buildCoverageAnswerLines(assessment);
    expect(lines.some((l) => /Confidence:/i.test(l))).toBe(true);
    expect(lines.some((l) => /Requested period/i.test(l))).toBe(true);
  });

  test("unavailable when no days", () => {
    const assessment = assessPeriodCoverage({
      requestedPeriod: { label: "2026 year-to-date", startDate: "2026-01-01", endDate: "2026-06-23" },
      aggregation: { dayCount: 0, dailyBreakdown: [] },
    });
    expect(assessment.completeness).toBe("unavailable");
    expect(assessment.confidence).toBe("low");
  });

  test("one available day in a 10-day request is partial and not treated as complete", () => {
    const assessment = assessPeriodCoverage({
      requestedPeriod: {
        startDate: "2026-06-11",
        endDate: "2026-06-20",
        label: "last 10 days",
        periodType: "last_10_days",
      },
      aggregation: {
        dayCount: 1,
        dailyBreakdown: [{ date: "2026-06-20", totalSales: 5000 }],
        totalSales: 5000,
        salesCoverageStart: "2026-06-20",
        salesCoverageEnd: "2026-06-20",
      },
    });
    expect(assessment.completeness).toBe("partial");
    expect(assessment.expectedDays).toBe(10);
    expect(assessment.availableDays).toBe(1);
    expect(assessment.missingDays).toBe(9);
    expect(assessment.confidence).toBe("low");
    expect(assessment.coverageNotes.some((n) => /Only 1 of 10 requested days/i.test(n))).toBe(true);
  });
});
