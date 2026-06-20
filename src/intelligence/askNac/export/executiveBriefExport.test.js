import {
  applyExecutiveMetricDisplayLabels,
  extractExecutiveKpiMetrics,
  formatExportAnswerText,
  hasExecutiveBriefPayload,
  normalizeExecutiveBriefForExport,
  resolveExecutiveMetricLabel,
} from "./executiveBriefExport";

describe("executiveBriefExport helpers", () => {
  test("formatExportAnswerText never returns [object Object]", () => {
    expect(formatExportAnswerText("Net sales 22,522 SAR")).toBe("Net sales 22,522 SAR");
    expect(formatExportAnswerText({ headline: "bad object" })).toBe("");
    expect(formatExportAnswerText(null)).toBe("");
  });

  test("normalizeExecutiveBriefForExport preserves structured sections", () => {
    const brief = normalizeExecutiveBriefForExport({
      executiveSummary: " Khobar cash-up summary ",
      keyFindings: ["Finding one"],
      operationalRisks: ["Risk one"],
      recommendedActions: ["Action one"],
      dataSources: ["Cash up 2026.xlsx · 2026-06-19 · cash_up"],
    });

    expect(brief.executiveSummary).toBe("Khobar cash-up summary");
    expect(brief.keyFindings).toEqual(["Finding one"]);
    expect(brief.dataSources[0]).toMatch(/Cash up 2026/);
  });

  test("hasExecutiveBriefPayload detects brief-backed exports", () => {
    expect(
      hasExecutiveBriefPayload({
        executiveBrief: { executiveSummary: "Summary", keyFindings: [] },
      }),
    ).toBe(true);
    expect(hasExecutiveBriefPayload({ executiveBrief: { keyFindings: ["a"] } })).toBe(true);
    expect(hasExecutiveBriefPayload({ executiveBrief: null })).toBe(false);
  });

  test("resolveExecutiveMetricLabel maps card_sales to Electronic Payments", () => {
    expect(resolveExecutiveMetricLabel({ key: "card_sales", label: "Card sales" })).toBe(
      "Electronic Payments",
    );
    expect(
      applyExecutiveMetricDisplayLabels([{ key: "card_sales", label: "Card sales", value: 19046 }])[0]
        .label,
    ).toBe("Electronic Payments");
  });

  test("extractExecutiveKpiMetrics returns priority headline metrics", () => {
    const kpis = extractExecutiveKpiMetrics([
      { key: "discounts", label: "Discounts", value: 100, unit: "SAR" },
      { key: "gross_sales", label: "Gross sales", value: 25901, unit: "SAR" },
      { key: "card_sales", label: "Card sales", value: 24293, unit: "SAR" },
      { key: "cash_sales", label: "Cash sales", value: 546, unit: "SAR" },
    ]);

    expect(kpis.map((row) => row.key)).toEqual(["gross_sales", "card_sales", "cash_sales"]);
    expect(kpis[1].label).toBe("Electronic Payments");
  });
});
