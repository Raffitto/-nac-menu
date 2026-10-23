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
import { executiveReportWarnings } from "./askNacExportPayload";

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
  y = ensurePageSpace(doc, y, 88);
  y = drawAccentRule(doc, y, 72);
  setExportFont(doc, "bold", 12);
  paintExportText(doc, title, MARGIN, y, { tier: "gold", shadow: true });
  return y + 20;
}

function drawWrappedLine(doc, y, text, { size = 10, tier = "primary", indent = 0 } = {}) {
  setExportFont(doc, "normal", size);
  const lines = doc.splitTextToSize(sanitizeExportText(text), CONTENT_W - indent);
  lines.forEach((line) => {
    y = ensurePageSpace(doc, y, size + 8);
    paintExportText(doc, line, MARGIN + indent, y, { tier });
    y += size + 5;
  });
  return y;
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

function stampReportChrome(doc, payload) {
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    setExportFont(doc, "normal", 8);
    paintExportText(
      doc,
      sanitizeExportText(`${BRAND} · ${payload.context.branchLabel} · ${payload.context.periodLabel}`),
      MARGIN,
      PAGE_H - 28,
      { tier: "muted", maxWidth: 360 },
    );
    paintExportText(doc, `Page ${page} of ${total}`, PAGE_W - MARGIN - 78, PAGE_H - 28, { tier: "muted" });
  }
}

function drawIncidentRegister(doc, y, findings) {
  findings.forEach((finding, index) => {
    y = ensurePageSpace(doc, y, 108);
    setExportFont(doc, "bold", 11);
    const heading = `${index + 1}. ${finding.dateLabel || finding.date || "Undated"}${finding.product ? ` — ${finding.product}` : ""}`;
    paintExportText(doc, sanitizeExportText(heading), MARGIN, y, { tier: "primary" });
    y += 16;
    y = drawWrappedLine(doc, y, finding.issue || "", { size: 10 });
    if (finding.tableNumber) y = drawWrappedLine(doc, y, `Table ${finding.tableNumber}`, { size: 9, tier: "secondary" });
    if (finding.action) y = drawWrappedLine(doc, y, `Action: ${finding.action}`, { size: 10, tier: "secondary" });
    y = drawWrappedLine(doc, y, `Outcome: ${finding.resolution || "Final satisfaction not documented."}`, { size: 10, tier: "secondary" });
    y = drawWrappedLine(
      doc,
      y,
      `Source: ${finding.sourceDocument || "logbook"}${finding.sourceSection ? `, ${finding.sourceSection}` : ""}.`,
      { size: 9, tier: "muted" },
    );
    y += 8;
  });
  return y;
}

function drawOperationalIntelligence(doc, y, payload) {
  const findings = payload.operationalFindings || [];
  y = drawSectionHeading(doc, y, "Executive summary");
  const summary = [
    `${payload.context.branchLabel}, ${payload.context.periodLabel}.`,
    `${findings.length} documented item${findings.length === 1 ? "" : "s"} identified from recovered logbook narratives.`,
    ...(payload.insights || []).slice(0, 3),
  ].join(" ");
  y = drawWrappedLine(doc, y, summary, { size: 11 });
  y += 6;
  y = drawExecutiveKpiCards(doc, y, payload);
  y = drawSectionHeading(doc, y, "Incident register");
  y = drawIncidentRegister(doc, y, findings);
  const actions = findings.filter((finding) => finding.action);
  if (actions.length) {
    y = drawSectionHeading(doc, y, "Management actions");
    y = drawBulletList(doc, y, actions.map((finding) => `${finding.dateLabel || finding.date} · ${finding.product}: ${finding.action}`), 12);
  }
  const recurring = (payload.insights || []).filter((line) => /recurring/i.test(line));
  if (recurring.length) {
    y = drawSectionHeading(doc, y, "Recurring themes");
    y = drawBulletList(doc, y, recurring, 4);
  }
  const openItems = findings.filter((finding) => /not documented/i.test(finding.resolution || ""));
  if (openItems.length) {
    y = drawSectionHeading(doc, y, "Open follow-up");
    y = drawWrappedLine(
      doc,
      y,
      `${openItems.length} item(s) do not record final guest satisfaction. A bill removal or recovery offer is not a confirmed resolution.`,
      { size: 10 },
    );
  }
  if (payload.recommendations?.length) {
    y = drawSectionHeading(doc, y, "Recommendations");
    y = drawBulletList(doc, y, payload.recommendations, 6);
  }
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

function renderAnswerDocument(payload, subtitle) {
  const { doc, y: startY } = createBaseDoc(payload, subtitle);
  let y = startY;
  const findings = payload.operationalFindings || [];
  if (findings.length) {
    y = drawOperationalIntelligence(doc, y, payload);
    y = drawSourcesTable(doc, y, payload);
  } else if (hasExecutiveBriefPayload(payload)) {
    y = drawExecutiveBriefSections(doc, y, payload);
    y = drawMetricsAppendix(doc, y, payload);
    y = drawSourcesTable(doc, y, payload);
  } else {
    y = drawSectionHeading(doc, y, "Answer");
    y = drawParagraph(doc, y, resolveLegacyAnswerText(payload), "primary");
    y = drawMetricsTable(doc, y, payload);
    y = drawSourcesTable(doc, y, payload);
  }
  const visibleWarnings = executiveReportWarnings(payload.warnings);
  if (!findings.length && visibleWarnings.length) {
    y = drawSectionHeading(doc, y, "Coverage notes");
    y = drawBulletList(doc, y, visibleWarnings, 4);
  }
  stampReportChrome(doc, payload);
  return y ? doc : doc;
}

/** Clean answer report. Operational answers use the incident register, not one paragraph. */
export function composeAskNacPdfDocument(payload) {
  return renderAnswerDocument(payload, "Intelligence answer report");
}

export function exportAskNacPdf(payload) {
  composeAskNacPdfDocument(payload).save(buildAskNacExportFilename(EXPORT_FORMATS.PDF));
}

/** CEO-ready executive report */
function buildExecutiveReportPdf(payload) {
  const { doc, y: startY } = createBaseDoc(payload, "Executive intelligence brief");
  let y = startY;

  if (payload.operationalFindings?.length) {
    y = drawOperationalIntelligence(doc, y, payload);
  } else if (hasExecutiveBriefPayload(payload)) {
    y = drawExecutiveBriefSections(doc, y, payload);
    y = drawMetricsAppendix(doc, y, payload);
  } else {
    y = drawSectionHeading(doc, y, "Executive summary");
    y = drawBulletList(doc, y, [resolveLegacyAnswerText(payload)], 1);
    y = drawSectionHeading(doc, y, "KPI snapshot");
    y = drawMetricsTable(doc, y, payload);
  }

  const riskNotes = [
    ...executiveReportWarnings(payload.warnings),
    ...(payload.diagnostics?.partialLive
      ? ["Month-to-date uses hybrid rollup + live Today — treat as operational signal, not final close."]
      : []),
  ];
  if (riskNotes.length) {
    y = drawSectionHeading(doc, y, "Key movement / risk notes");
    y = drawBulletList(doc, y, riskNotes, 6);
  }

  if (!hasExecutiveBriefPayload(payload) && !payload.operationalFindings?.length && payload.recommendations?.length) {
    y = drawSectionHeading(doc, y, "Recommendations");
    y = drawBulletList(doc, y, payload.recommendations, 6);
  }

  y = drawSourcesTable(doc, y, payload);
  stampReportChrome(doc, payload);
  return y ? doc : doc;
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

  if (payload.operationalFindings?.length) {
    y = drawOperationalIntelligence(doc, y, payload);
  } else if (hasExecutiveBriefPayload(payload)) {
    y = drawExecutiveBriefSections(doc, y, payload);
    y = drawMetricsAppendix(doc, y, payload);
  } else {
    y = drawSectionHeading(doc, y, "Full answer");
    y = drawBulletList(doc, y, [resolveLegacyAnswerText(payload)], 1);
    y = drawSectionHeading(doc, y, "Supporting metrics");
    y = drawMetricsTable(doc, y, payload);
  }

  if (!payload.operationalFindings?.length && payload.insights?.length) {
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

  const visibleWarnings = executiveReportWarnings(payload.warnings);
  const internalWarnings = (payload.warnings || []).filter((warning) => !visibleWarnings.includes(warning));
  if (visibleWarnings.length) {
    y = drawSectionHeading(doc, y, "Coverage notes");
    y = drawBulletList(doc, y, visibleWarnings, 8);
  }
  if (internalWarnings.length) {
    y = drawSectionHeading(doc, y, "Technical diagnostics");
    y = drawBulletList(doc, y, internalWarnings, 8);
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

  if (payload.recommendations?.length && !(payload.operationalFindings || []).length) {
    y = drawSectionHeading(doc, y, "Recommendations");
    y = drawBulletList(doc, y, payload.recommendations, 8);
  }

  stampReportChrome(doc, payload);
  if (y < 0) return;
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