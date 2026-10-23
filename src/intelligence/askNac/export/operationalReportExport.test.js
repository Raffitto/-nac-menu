import { buildIncidentRegister } from "../vault/operationalIncidentExtractor";
import { buildAskNacExportPayload, executiveReportWarnings } from "./askNacExportPayload";
import { buildAskNacCsvContent } from "./askNacCsvExport";
import { composeAskNacPdfDocument } from "./askNacPdfExport";
import { EXPORT_FORMATS } from "./askNacExportPayload";

function findingFacts() {
  const text = [
    "Table 21 complained about quinoa salad tasting different. Management tasted it, offered another salad, and removed the original item from the bill.",
    "Table 10 became upset about the popcorn chicken service sequence. Staff offered popcorn chicken as recovery.",
  ].join(" ");
  return [{
    periodStart: "2026-10-01",
    metricKey: "dinner_notes",
    fileTitle: "1 October logbook",
    dimensions: { text_value: text, provenance: "historical_docx_recovery" },
  }];
}

function responseFromRegister(register) {
  return {
    answerType: "executive",
    title: register.title,
    directAnswer: register.directAnswer,
    keyMetrics: register.keyMetrics,
    insights: register.insights,
    recommendations: register.recommendations,
    operationalFindings: register.operationalFindings,
    sources: [{ name: "ask_nac_structured_facts", detail: "Recovered daily_logbook narratives" }],
    warnings: [
      "Structured logbook facts were read in the browser because the Ask NAC server did not return recovered narrative evidence.",
    ],
    confidence: register.confidence,
    periodLabel: "1–14 October 2026",
    branchLabel: "Khobar",
    intent: "vault_operational_review",
  };
}

describe("operational report exports", () => {
  const register = buildIncidentRegister({
    facts: findingFacts(),
    branchLabel: "Khobar",
    periodLabel: "1–14 October 2026",
    mode: "complaints",
    textKeys: ["dinner_notes"],
    sectionLabels: { dinner_notes: "Dinner" },
  });
  const payload = buildAskNacExportPayload({
    question: "What guest complaints occurred in Khobar between October 1 and October 14, 2026?",
    response: responseFromRegister(register),
    filters: { branch: "khobar" },
  });

  test("chat, metrics, JSON findings, and CSV rows share one incident count", () => {
    const csv = buildAskNacCsvContent(payload);
    const csvRows = csv.split("\n").slice(2).filter(Boolean);
    expect(payload.operationalFindings).toHaveLength(2);
    expect(payload.keyMetrics.find((metric) => metric.label === "Documented incidents").value).toBe("2");
    expect(payload.answer.directAnswer).toMatch(/2 documented items identified/);
    expect(csvRows).toHaveLength(2);
    expect(csv).toMatch(/Quinoa Salad/);
    expect(csv).toMatch(/historical_docx_recovery/);
    expect(csv).not.toMatch(/Management tasted it, offered another salad, and removed the original item from the bill\. Table 10/);
    const json = JSON.stringify({
      answer: payload.answer,
      operationalFindings: payload.operationalFindings,
      keyMetrics: payload.keyMetrics,
    });
    expect(json).toMatch(/"product":"Quinoa Salad"/);
    expect(json).toMatch(/historical_docx_recovery/);
  });

  test("executive PDF omits the browser fallback warning and separates incidents", () => {
    expect(executiveReportWarnings(payload.warnings)).toHaveLength(0);
    const report = composeAskNacPdfDocument(payload);
    expect(report.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    const rendered = report.output("arraybuffer");
    expect(rendered.byteLength).toBeGreaterThan(1000);
  });

  test("a long incident register uses more than one page", () => {
    const many = Array.from({ length: 14 }, (_, index) => ({
      ...payload.operationalFindings[0],
      date: `2026-10-${String(index + 1).padStart(2, "0")}`,
      dateLabel: `${index + 1} October`,
      product: `Item ${index + 1}`,
      issue: `Table ${index + 1} reported a distinct guest complaint about item ${index + 1}.`,
      evidenceExcerpt: `Evidence for item ${index + 1}.`,
    }));
    const longPayload = { ...payload, operationalFindings: many };
    const report = composeAskNacPdfDocument(longPayload);
    expect(report.getNumberOfPages()).toBeGreaterThan(1);
  });

  test("sales metric CSV is unchanged when there are no incidents", () => {
    const sales = buildAskNacExportPayload({
      question: "What were sales on 5 June?",
      response: {
        answerType: "metric",
        directAnswer: "Net sales were 18,500 SAR.",
        keyMetrics: [{ label: "Net sales", value: "18,500", unit: "SAR", source: "cash_up" }],
        periodLabel: "5 June 2026",
        branchLabel: "Khobar",
      },
      filters: { branch: "khobar" },
    });
    const csv = buildAskNacCsvContent(sales);
    expect(csv).toMatch(/Net sales,"18,500",SAR,cash_up/);
    expect(sales.operationalFindings).toEqual([]);
    expect(EXPORT_FORMATS.CSV).toBe("csv");
  });

  test("CSV export failure stays explicit when nothing is tabular", () => {
    const empty = buildAskNacExportPayload({
      question: "Hello",
      response: { directAnswer: "No metrics." },
    });
    expect(buildAskNacCsvContent(empty)).toBeNull();
  });
});
