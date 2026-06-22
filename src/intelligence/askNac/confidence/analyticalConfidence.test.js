import { resolveAnalyticalConfidence, formatConfidenceLine } from "./analyticalConfidence";

describe("analyticalConfidence", () => {
  test("confidence appears for analytical answer", () => {
    const result = resolveAnalyticalConfidence({
      route: {
        vaultPeriod: {
          startDate: "2026-01-01",
          endDate: "2026-06-23",
          label: "2026 year-to-date",
          periodType: "year_to_date",
        },
      },
      tool: {
        aggregation: {
          dayCount: 10,
          dailyBreakdown: [{ date: "2026-06-01", totalSales: 1000 }],
          totalSales: 10000,
        },
        warnings: [],
        coverage: [],
        vaultSources: [],
      },
    });

    expect(result.level).toBeTruthy();
    expect(result.explanation).toMatch(/cash-up/i);
    const line = formatConfidenceLine(result);
    expect(line).toMatch(/Confidence:/i);
  });
});
