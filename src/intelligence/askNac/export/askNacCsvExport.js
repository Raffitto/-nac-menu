/**
 * Ask NAC CSV + JSON raw exports.
 */

import { downloadBlob, buildAskNacExportFilename, EXPORT_FORMATS, hasTabularKeyMetrics } from "./askNacExportPayload";

function escapeCsvCell(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildAskNacCsvContent(payload) {
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
