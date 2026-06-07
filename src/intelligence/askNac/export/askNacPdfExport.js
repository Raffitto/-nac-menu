/**
 * Ask NAC PDF exports — reuses jsPDF + project pdfVisualTheme.
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  fillPage,
  drawPageTitle,
  paintExportText,
  setExportFont,
  sanitizeExportText,
  buildExportTableStyles,
} from "../../../dashboard/engines/pdfVisualTheme";
import { buildAskNacExportFilename, EXPORT_FORMATS } from "./askNacExportPayload";

const BRAND = "NAC Hospitality OS · Ask NAC";
const MARGIN = 44;
const PAGE_W = 595;
const CONTENT_W = PAGE_W - MARGIN * 2;

function formatMetricValue(m) {
  const v = m.value;
  if (typeof v === "number") return `${v.toLocaleString()}${m.unit ? ` ${m.unit}` : ""}`;
  return `${v}${m.unit ? ` ${m.unit}` : ""}`;
}

function drawSectionHeading(doc, y, title) {
  setExportFont(doc, "bold", 10);
  paintExportText(doc, title, MARGIN, y, { tier: "gold", shadow: true });
  return y + 16;
}

function drawBulletList(doc, y, items, maxItems = 8) {
  setExportFont(doc, "normal", 8);
  let cy = y;
  (items || []).slice(0, maxItems).forEach((line) => {
    const wrapped = doc.splitTextToSize(sanitizeExportText(`• ${line}`), CONTENT_W - 8);
    wrapped.forEach((ln) => {
      paintExportText(doc, ln, MARGIN + 4, cy, { tier: "secondary", lineHeight: 10 });
      cy += 10;
    });
  });
  return cy + 4;
}

function drawProvenanceFooter(doc, payload, y) {
  const pageH = doc.internal.pageSize.getHeight();
  if (y > pageH - 48) {
    doc.addPage();
    fillPage(doc);
    y = 48;
  }
  setExportFont(doc, "normal", 7);
  paintExportText(
    doc,
    `${payload.meta.provenance.label} · ${payload.meta.generatedAtLabel} · ${BRAND}`,
    MARGIN,
    pageH - 28,
    { tier: "muted", maxWidth: CONTENT_W },
  );
  return y;
}

function drawMetricsTable(doc, y, payload) {
  const metrics = payload.keyMetrics || [];
  if (!metrics.length) return y;

  autoTable(doc, {
    startY: y,
    head: [["Metric", "Value", "Source"]],
    body: metrics.slice(0, 12).map((m) => [
      sanitizeExportText(m.label),
      sanitizeExportText(formatMetricValue(m)),
      sanitizeExportText(m.source || m.note || "—"),
    ]),
    ...buildExportTableStyles(),
    margin: { left: MARGIN, right: MARGIN },
  });
  return doc.lastAutoTable.finalY + 12;
}

function drawSourcesTable(doc, y, payload) {
  const sources = payload.sources || [];
  if (!sources.length) return y;

  y = drawSectionHeading(doc, y, "Sources & confidence");
  autoTable(doc, {
    startY: y,
    head: [["Source", "Detail", "Confidence"]],
    body: sources.map((s) => [
      sanitizeExportText(s.name),
      sanitizeExportText(s.detail || "—"),
      sanitizeExportText(payload.meta.confidence || "—"),
    ]),
    ...buildExportTableStyles(),
    margin: { left: MARGIN, right: MARGIN },
  });
  return doc.lastAutoTable.finalY + 12;
}

function createBaseDoc(payload, subtitle) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  fillPage(doc);
  let y = drawPageTitle(doc, MARGIN, sanitizeExportText(payload.meta.reportTitle), subtitle);
  setExportFont(doc, "normal", 8);
  paintExportText(doc, payload.meta.provenance.label, MARGIN, y, { tier: "teal" });
  y += 14;
  paintExportText(
    doc,
    `Generated ${payload.meta.generatedAtLabel} · ${payload.context.filterSummary}`,
    MARGIN,
    y,
    { tier: "muted", maxWidth: CONTENT_W },
  );
  return { doc, y: y + 18 };
}

/** Clean one-page answer report */
export function exportAskNacPdf(payload) {
  const { doc, y: startY } = createBaseDoc(payload, "Intelligence answer report");
  let y = startY;

  y = drawSectionHeading(doc, y, "Question");
  setExportFont(doc, "normal", 9);
  doc.splitTextToSize(sanitizeExportText(payload.question), CONTENT_W).forEach((ln, i) => {
    paintExportText(doc, ln, MARGIN, y + i * 11, { tier: "primary" });
  });
  y += Math.max(1, doc.splitTextToSize(sanitizeExportText(payload.question), CONTENT_W).length) * 11 + 10;

  y = drawSectionHeading(doc, y, "Answer");
  doc.splitTextToSize(sanitizeExportText(payload.answer.directAnswer), CONTENT_W).forEach((ln, i) => {
    paintExportText(doc, ln, MARGIN, y + i * 11, { tier: "primary" });
  });
  y +=
    Math.max(1, doc.splitTextToSize(sanitizeExportText(payload.answer.directAnswer), CONTENT_W).length) *
      11 +
    8;

  y = drawMetricsTable(doc, y, payload);

  if (payload.warnings?.length) {
    y = drawSectionHeading(doc, y, "Warnings");
    y = drawBulletList(doc, y, payload.warnings, 4);
  }

  drawProvenanceFooter(doc, payload, y);
  doc.save(buildAskNacExportFilename(EXPORT_FORMATS.PDF));
}

/** CEO-ready executive report */
export function exportAskNacExecutiveReport(payload) {
  const { doc, y: startY } = createBaseDoc(payload, "Executive intelligence brief");
  let y = startY;

  y = drawSectionHeading(doc, y, "Executive summary");
  y = drawBulletList(doc, y, [payload.answer.directAnswer], 1);

  y = drawSectionHeading(doc, y, "KPI snapshot");
  y = drawMetricsTable(doc, y, payload);

  const riskNotes = [
    ...(payload.warnings || []),
    ...(payload.diagnostics?.partialLive
      ? ["Month-to-date uses hybrid rollup + live Today — treat as operational signal, not final close."]
      : []),
  ];
  if (riskNotes.length) {
    y = drawSectionHeading(doc, y, "Key movement / risk notes");
    y = drawBulletList(doc, y, riskNotes, 6);
  }

  if (payload.recommendations?.length) {
    y = drawSectionHeading(doc, y, "Recommendations");
    y = drawBulletList(doc, y, payload.recommendations, 6);
  }

  y = drawSourcesTable(doc, y, payload);
  drawProvenanceFooter(doc, payload, y);
  doc.save(buildAskNacExportFilename(EXPORT_FORMATS.EXECUTIVE));
}

/** Detailed analysis report (multi-section, may span pages) */
export function exportAskNacDetailedAnalysis(payload) {
  const { doc, y: startY } = createBaseDoc(payload, "Detailed analysis");
  let y = startY;

  y = drawSectionHeading(doc, y, "Question");
  y = drawBulletList(doc, y, [payload.question], 1);

  y = drawSectionHeading(doc, y, "Full answer");
  y = drawBulletList(doc, y, [payload.answer.directAnswer], 1);

  y = drawSectionHeading(doc, y, "Supporting metrics");
  y = drawMetricsTable(doc, y, payload);

  if (payload.insights?.length) {
    y = drawSectionHeading(doc, y, "Insights");
    y = drawBulletList(doc, y, payload.insights, 10);
  }

  if (payload.diagnostics) {
    y = drawSectionHeading(doc, y, "Source diagnostics");
    const diagLines = [
      `Source: ${payload.diagnostics.source || "n/a"}`,
      `Includes current business day: ${payload.diagnostics.includesCurrentBusinessDay ? "yes" : "no"}`,
      `Partial live: ${payload.diagnostics.partialLive ? "yes" : "no"}`,
      ...(payload.diagnostics.warnings || []),
    ];
    y = drawBulletList(doc, y, diagLines, 8);
  }

  if (payload.assumptions?.length) {
    y = drawSectionHeading(doc, y, "Assumptions");
    y = drawBulletList(doc, y, payload.assumptions, 8);
  }

  y = drawSectionHeading(doc, y, "Data completeness");
  y = drawBulletList(doc, y, payload.dataCompleteness, 10);

  if (payload.warnings?.length) {
    y = drawSectionHeading(doc, y, "Warnings");
    y = drawBulletList(doc, y, payload.warnings, 12);
  }

  if (payload.missingData?.length) {
    y = drawSectionHeading(doc, y, "Missing data");
    y = drawBulletList(
      doc,
      y,
      payload.missingData.map((m) => m.label || m.intent || "Unknown gap"),
      8,
    );
  }

  y = drawSourcesTable(doc, y, payload);

  if (payload.recommendations?.length) {
    y = drawSectionHeading(doc, y, "Recommendations");
    y = drawBulletList(doc, y, payload.recommendations, 8);
  }

  drawProvenanceFooter(doc, payload, y);
  doc.save(buildAskNacExportFilename(EXPORT_FORMATS.DETAILED));
}

/** Dispatch export by format id */
export function runAskNacExport(format, payload) {
  switch (format) {
    case EXPORT_FORMATS.PDF:
      exportAskNacPdf(payload);
      return;
    case EXPORT_FORMATS.EXECUTIVE:
      exportAskNacExecutiveReport(payload);
      return;
    case EXPORT_FORMATS.DETAILED:
      exportAskNacDetailedAnalysis(payload);
      return;
    default:
      throw new Error(`Unsupported PDF export format: ${format}`);
  }
}
