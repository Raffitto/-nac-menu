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
  NAC_TEAL,
  drawContentPanel,
} from "../../../dashboard/engines/pdfVisualTheme";
import { buildAskNacExportFilename, EXPORT_FORMATS } from "./askNacExportPayload";
import {
  extractExecutiveKpiMetrics,
  formatExportAnswerText,
  hasExecutiveBriefPayload,
} from "./executiveBriefExport";

const BRAND = "NAC Hospitality OS · Ask NAC";
const MARGIN = 44;
const PAGE_W = 595;
const CONTENT_W = PAGE_W - MARGIN * 2;
const PAGE_H = 842;

function formatMetricValue(m) {
  const v = m.value;
  if (typeof v === "number") return `${v.toLocaleString()}${m.unit ? ` ${m.unit}` : ""}`;
  return `${v}${m.unit ? ` ${m.unit}` : ""}`;
}

function ensurePageSpace(doc, y, needed = 72) {
  if (y + needed <= PAGE_H - 56) return y;
  doc.addPage();
  fillPage(doc);
  return 48;
}

function drawAccentRule(doc, y, width = CONTENT_W) {
  doc.setDrawColor(...NAC_TEAL);
  doc.setLineWidth(1.2);
  doc.line(MARGIN, y, MARGIN + width, y);
  return y + 10;
}

function drawSectionHeading(doc, y, title) {
  y = ensurePageSpace(doc, y, 40);
  y = drawAccentRule(doc, y, 72);
  setExportFont(doc, "bold", 11);
  paintExportText(doc, title, MARGIN, y, { tier: "gold", shadow: true });
  return y + 18;
}

function drawParagraph(doc, y, text, tier = "primary") {
  setExportFont(doc, "normal", 9);
  const lines = doc.splitTextToSize(sanitizeExportText(text), CONTENT_W);
  lines.forEach((line, index) => {
    y = ensurePageSpace(doc, y, 14);
    paintExportText(doc, line, MARGIN, y + index * 12, { tier, lineHeight: 12 });
  });
  return y + Math.max(1, lines.length) * 12 + 8;
}

function drawBulletList(doc, y, items, maxItems = 8) {
  setExportFont(doc, "normal", 8.5);
  (items || []).slice(0, maxItems).forEach((line) => {
    y = ensurePageSpace(doc, y, 18);
    const wrapped = doc.splitTextToSize(sanitizeExportText(`• ${line}`), CONTENT_W - 8);
    wrapped.forEach((ln) => {
      paintExportText(doc, ln, MARGIN + 4, y, { tier: "secondary", lineHeight: 11 });
      y += 11;
    });
    y += 2;
  });
  return y + 4;
}

function drawExecutiveKpiCards(doc, y, payload) {
  const metrics = extractExecutiveKpiMetrics(payload.keyMetrics);
  if (!metrics.length) return y;

  y = drawSectionHeading(doc, y, "Executive KPIs");
  const cardW = (CONTENT_W - 12) / 2;
  const cardH = 42;
  let column = 0;
  let rowY = y;

  metrics.forEach((metric, index) => {
    if (column === 0) rowY = ensurePageSpace(doc, rowY, cardH + 12);
    const x = MARGIN + column * (cardW + 12);
    drawContentPanel(doc, x, rowY, cardW, cardH);
    doc.setDrawColor(...NAC_TEAL);
    doc.setLineWidth(1);
    doc.line(x + 8, rowY + 8, x + 28, rowY + 8);

    setExportFont(doc, "bold", 7.5);
    paintExportText(doc, metric.label, x + 10, rowY + 18, { tier: "gold", maxWidth: cardW - 16 });
    setExportFont(doc, "bold", 11);
    paintExportText(doc, formatMetricValue(metric), x + 10, rowY + 32, { tier: "primary", maxWidth: cardW - 16 });

    column += 1;
    if (column > 1) {
      column = 0;
      rowY += cardH + 10;
    } else if (index === metrics.length - 1) {
      rowY += cardH + 10;
    }
  });

  return rowY + 6;
}

function drawExecutiveBriefSections(doc, y, payload) {
  const brief = payload.executiveBrief;
  if (!brief) return y;

  y = drawSectionHeading(doc, y, "Executive Summary");
  y = drawParagraph(doc, y, brief.executiveSummary, "primary");
  y = drawExecutiveKpiCards(doc, y, payload);

  if (brief.keyFindings?.length) {
    y = drawSectionHeading(doc, y, "Key Findings");
    y = drawBulletList(doc, y, brief.keyFindings, 8);
  }
  if (brief.operationalRisks?.length) {
    y = drawSectionHeading(doc, y, "Operational Risks");
    y = drawBulletList(doc, y, brief.operationalRisks, 6);
  }
  if (brief.recommendedActions?.length) {
    y = drawSectionHeading(doc, y, "Recommended Actions");
    y = drawBulletList(doc, y, brief.recommendedActions, 6);
  }
  if (brief.dataSources?.length) {
    y = drawSectionHeading(doc, y, "Data Sources");
    y = drawBulletList(doc, y, brief.dataSources, 6);
  }

  return y;
}

function drawMetricsAppendix(doc, y, payload) {
  const metrics = payload.keyMetrics || [];
  if (!metrics.length) return y;
  y = drawSectionHeading(doc, y, "Metrics Appendix");
  return drawMetricsTable(doc, y, payload);
}

function drawProvenanceFooter(doc, payload, y) {
  y = ensurePageSpace(doc, y, 40);
  const pageH = doc.internal.pageSize.getHeight();
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
    body: metrics.slice(0, 16).map((m) => [
      sanitizeExportText(m.label),
      sanitizeExportText(formatMetricValue(m)),
      sanitizeExportText(m.source || m.note || "—"),
    ]),
    ...buildExportTableStyles({
      headStyles: {
        fillColor: NAC_TEAL,
        textColor: [12, 14, 16],
        fontStyle: "bold",
      },
    }),
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
    { tier: "secondary", maxWidth: CONTENT_W },
  );
  return { doc, y: y + 18 };
}

function resolveLegacyAnswerText(payload) {
  const text = formatExportAnswerText(payload.answer?.directAnswer);
  if (text) return text;
  if (hasExecutiveBriefPayload(payload)) return payload.executiveBrief.executiveSummary;
  return "No narrative answer available.";
}

/** Clean one-page answer report */
export function exportAskNacPdf(payload) {
  const { doc, y: startY } = createBaseDoc(payload, "Intelligence answer report");
  let y = startY;

  y = drawSectionHeading(doc, y, "Question");
  y = drawParagraph(doc, y, payload.question, "primary");

  if (hasExecutiveBriefPayload(payload)) {
    y = drawExecutiveBriefSections(doc, y, payload);
    y = drawMetricsAppendix(doc, y, payload);
  } else {
    y = drawSectionHeading(doc, y, "Answer");
    y = drawParagraph(doc, y, resolveLegacyAnswerText(payload), "primary");
    y = drawMetricsTable(doc, y, payload);
  }

  if (payload.warnings?.length) {
    y = drawSectionHeading(doc, y, "Warnings");
    y = drawBulletList(doc, y, payload.warnings, 4);
  }

  drawProvenanceFooter(doc, payload, y);
  doc.save(buildAskNacExportFilename(EXPORT_FORMATS.PDF));
}

/** CEO-ready executive report */
function buildExecutiveReportPdf(payload) {
  const { doc, y: startY } = createBaseDoc(payload, "Executive intelligence brief");
  let y = startY;

  if (hasExecutiveBriefPayload(payload)) {
    y = drawExecutiveBriefSections(doc, y, payload);
    y = drawMetricsAppendix(doc, y, payload);
  } else {
    y = drawSectionHeading(doc, y, "Executive summary");
    y = drawBulletList(doc, y, [resolveLegacyAnswerText(payload)], 1);
    y = drawSectionHeading(doc, y, "KPI snapshot");
    y = drawMetricsTable(doc, y, payload);
  }

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

  if (!hasExecutiveBriefPayload(payload) && payload.recommendations?.length) {
    y = drawSectionHeading(doc, y, "Recommendations");
    y = drawBulletList(doc, y, payload.recommendations, 6);
  }

  y = drawSourcesTable(doc, y, payload);
  drawProvenanceFooter(doc, payload, y);
  return doc;
}

export function exportAskNacExecutiveReportToBuffer(payload) {
  return buildExecutiveReportPdf(payload).output("arraybuffer");
}

export function exportAskNacExecutiveReport(payload) {
  buildExecutiveReportPdf(payload).save(buildAskNacExportFilename(EXPORT_FORMATS.EXECUTIVE));
}

/** Detailed analysis report (multi-section, may span pages) */
export function exportAskNacDetailedAnalysis(payload) {
  const { doc, y: startY } = createBaseDoc(payload, "Detailed analysis");
  let y = startY;

  y = drawSectionHeading(doc, y, "Question");
  y = drawBulletList(doc, y, [payload.question], 1);

  if (hasExecutiveBriefPayload(payload)) {
    y = drawExecutiveBriefSections(doc, y, payload);
    y = drawMetricsAppendix(doc, y, payload);
  } else {
    y = drawSectionHeading(doc, y, "Full answer");
    y = drawBulletList(doc, y, [resolveLegacyAnswerText(payload)], 1);
    y = drawSectionHeading(doc, y, "Supporting metrics");
    y = drawMetricsTable(doc, y, payload);
  }

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

export { hasExecutiveBriefPayload, formatExportAnswerText };