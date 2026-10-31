/**
 * Ask NAC CSV + JSON raw exports.
 */

import { downloadBlob, buildAskNacExportFilename, EXPORT_FORMATS, hasTabularKeyMetrics, hasOperationalFindings } from "./askNacExportPayload";

function escapeCsvCell(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildIncidentCsv(payload) {
  const header = [
    "date",
    "branch",
    "service_period",
    "table_number",
    "category",
    "product",
    "issue",
    "action",
    "resolution",
    "source_document",
    "source_section",
    "provenance",
    "confidence",
    "evidence_excerpt",
  ];
  const rows = payload.operationalFindings.map((finding) => header.map((column) => {
    const key = {
      date: "date",
      branch: "branch",
      service_period: "servicePeriod",
      table_number: "tableNumber",
      category: "categoryLabel",
      product: "product",
      issue: "issue",
      action: "action",
      resolution: "resolution",
      source_document: "sourceDocument",
      source_section: "sourceSection",
      provenance: "provenance",
      confidence: "confidence",
      evidence_excerpt: "evidenceExcerpt",
    }[column];
    return escapeCsvCell(finding[key]);
  }).join(","));
  return ["# Ask NAC incident register", header.join(","), ...rows].join("\n");
}

export function buildAskNacCsvContent(payload) {
  if (hasOperationalFindings(payload)) return buildIncidentCsv(payload);
  if (!hasTabularKeyMetrics(payload)) {
    return null;
  }

  const header = ["label", "value", "unit", "source", "note"];
  const rows = payload.keyMetrics.map((m) =>
    header.map((col) => escapeCsvCell(m[col])).join(","),
  );

  const metaRows = [
    ["question", escapeCsvCell(payload.question)],
    ["direct_answer", escapeCsvCell(payload.answer?.directAnswer)],
    ["period", escapeCsvCell(payload.context?.periodLabel)],
    ["branch", escapeCsvCell(payload.context?.branchLabel)],
    ["provenance", escapeCsvCell(payload.meta?.provenance?.label)],
    ["generated_at", escapeCsvCell(payload.meta?.generatedAtLabel)],
  ].map(([k, v]) => `${k},${v}`);

  return ["# Ask NAC key metrics", header.join(","), ...rows, "", "# Context", ...metaRows].join("\n");
}

export function exportAskNacRawJson(payload) {
  const exportDoc = {
    exportedAt: payload.meta.generatedAt,
    exportedAtLabel: payload.meta.generatedAtLabel,
    provenance: payload.meta.provenance,
    question: payload.question,
    context: payload.context,
    answer: payload.answer,
    keyMetrics: payload.keyMetrics,
    insights: payload.insights,
    recommendations: payload.recommendations,
    operationalFindings: payload.operationalFindings || [],
    sources: payload.sources,
    warnings: payload.warnings,
    missingData: payload.missingData,
    diagnostics: payload.diagnostics,
    assumptions: payload.assumptions,
    dataCompleteness: payload.dataCompleteness,
    rawResponse: payload.rawResponse,
  };

  const blob = new Blob([JSON.stringify(exportDoc, null, 2)], { type: "application/json" });
  downloadBlob(blob, buildAskNacExportFilename(EXPORT_FORMATS.JSON));
}

export function exportAskNacRawCsv(payload) {
  const csv = buildAskNacCsvContent(payload);
  if (!csv) {
    throw new Error("No tabular key metrics available for CSV export.");
  }
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, buildAskNacExportFilename(EXPORT_FORMATS.CSV));
}
