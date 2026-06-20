import { buildAskNacExportPayload } from "./askNacExportPayload";
import { formatExportAnswerText, hasExecutiveBriefPayload } from "./executiveBriefExport";

describe("askNacPdfExport executive brief payload wiring", () => {
  const executiveResponse = {
    answerType: "executive",
    title: "Sales performance · 19 June 2026",
    directAnswer: { invalid: "object payload" },
    executiveBrief: {
      executiveSummary: "Khobar cash-up for 2026-06-19 shows net sales of 22,522.609 SAR.",
      keyFindings: [
        "Dinner generated 17,178.259 SAR and contributed 66% of gross sales.",
        "Electronic payments 24,293 SAR and cash 546 SAR — electronic payments represented 97.8% of recorded card/cash settlement.",
      ],
      operationalRisks: ["Coverage marked partial — treat as uploaded-file snapshot, not final close."],
      recommendedActions: [],
      dataSources: ["Cash up 2026.xlsx · 2026-06-19 · cash_up"],
    },
    keyMetrics: [
      { key: "gross_sales", label: "Gross sales", value: "25,901", unit: "SAR" },
      { key: "net_sales", label: "Net sales", value: "22,522.609", unit: "SAR" },
      { key: "card_sales", label: "Card sales", value: "24,293", unit: "SAR" },
      { key: "cash_sales", label: "Cash sales", value: "546", unit: "SAR" },
    ],
    confidence: "high",
    periodLabel: "19 June 2026",
    branchLabel: "Khobar",
  };

  test("export payload uses executiveBrief instead of object directAnswer", () => {
    const payload = buildAskNacExportPayload({
      question: "show latest cash up",
      response: executiveResponse,
      filters: { branch: "khobar", selectedRange: "today" },
    });

    expect(hasExecutiveBriefPayload(payload)).toBe(true);
    expect(payload.executiveBrief.keyFindings[0]).toMatch(/66% of gross sales/);
    expect(payload.executiveBrief.executiveSummary).toMatch(/22,522\.609 SAR/);
    expect(payload.keyMetrics.find((m) => m.key === "card_sales")?.label).toBe("Electronic Payments");
    expect(formatExportAnswerText(payload.answer.directAnswer)).toBe("");
    expect(JSON.stringify(payload.executiveBrief)).not.toMatch(/\[object Object\]/);
  });
});
