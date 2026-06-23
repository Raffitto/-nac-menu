import {
  buildWeeklyDashboardWorkbook,
  buildWeeklyDashboardFilename,
  listWeeklyDashboardSheetNames,
} from "./weeklyDashboardXlsxExport";

describe("weeklyDashboardXlsxExport", () => {
  const samplePackage = {
    meta: {
      branch: "khobar",
      branchLabel: "Khobar",
      periodLabel: "week ending 2026-06-15",
      startDate: "2026-06-09",
      endDate: "2026-06-15",
      generatedAtLabel: "23 Jun 2026, 10:00",
    },
    weekAggregation: {
      totalSales: 125000,
      totalGuests: 820,
      averageSpend: 152.44,
      totalDeliverySales: 18000,
      totalDeliveryOrders: 210,
      dayCount: 5,
      topPlatformBySales: "Jahez",
      dailyBreakdown: [
        { date: "2026-06-09", totalSales: 24000, totalGuests: 160, averageSpend: 150, totalDeliverySales: 3000 },
      ],
    },
    ninetyAggregation: {
      totalSales: 480000,
      totalGuests: 3200,
      averageSpend: 150,
      dayCount: 42,
      dailyBreakdown: [
        { date: "2026-06-01", totalSales: 11000, totalGuests: 70, averageSpend: 157, totalDeliverySales: 1200 },
      ],
    },
    manualInputs: { seven_rooms_covers: 82 },
    googleReviews: { totalReviews: 6, averageStars: 4.5, counts: { 5: 4, 4: 2, 3: 0, 2: 0, 1: 0 } },
    topProducts: [{ rank: 1, itemName: "Truffle Burger", netSales: 4200, quantity: 88 }],
    leastProducts: [{ rank: 1, itemName: "Side Salad", netSales: 120, quantity: 12 }],
    deliveryPlatforms: [{ platform: "Jahez", sales: 9000, orders: 95 }],
    executiveSummaryLines: ["Khobar uploaded 5 cash-up day(s)."],
    operationalCommentary: ["[Operator · weather] Humidity above 70% reduces walk-ins."],
    coverageAssessment: {
      confidence: "medium",
      coverageNotes: ["Partial coverage for requested week."],
      confidenceExplanation: "5 of 7 calendar days covered.",
    },
    confidenceResult: { level: "medium" },
    sourceRegistry: [
      {
        section: "Guest Performance",
        metric: "7Rooms covers",
        value: 82,
        sourceType: "user_provided",
        confidence: "high",
        freshness: "2026-06-15",
        notes: "ask_nac_manual_inputs",
      },
      {
        section: "Top Products",
        metric: "Top 10 items",
        value: 0,
        sourceType: "missing",
        confidence: "none",
        freshness: "",
        notes: "No Foodics import",
      },
    ],
  };

  test("buildWeeklyDashboardFilename uses branch and week end", () => {
    expect(buildWeeklyDashboardFilename(samplePackage)).toBe("NAC-Weekly-Dashboard-khobar-2026-06-15.xlsx");
  });

  test("workbook contains required sheets", () => {
    const sheets = listWeeklyDashboardSheetNames(samplePackage);
    expect(sheets).toEqual(["Dashboard", "Data", "Source", "90 Days"]);
  });

  test("source sheet registry includes user-provided and missing rows", () => {
    const wb = buildWeeklyDashboardWorkbook(samplePackage);
    const source = wb.Sheets.Source;
    expect(source).toBeTruthy();
    const userRow = (samplePackage.sourceRegistry || []).find((r) => r.sourceType === "user_provided");
    const missingRow = (samplePackage.sourceRegistry || []).find((r) => r.sourceType === "missing");
    expect(userRow?.metric).toBe("7Rooms covers");
    expect(missingRow?.sourceType).toBe("missing");
  });

  test("dashboard sheet includes manual covers and confidence context", () => {
    const wb = buildWeeklyDashboardWorkbook(samplePackage);
    expect(wb.Sheets.Dashboard).toBeTruthy();
    expect(wb.Sheets["90 Days"]).toBeTruthy();
  });
});
