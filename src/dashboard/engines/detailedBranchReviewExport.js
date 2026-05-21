/**
 * Detailed Branch Operational Review — executive boardroom PDF.
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  fillPage,
  drawKpiCard,
  drawCallout,
  drawContentPanel,
  drawMicroSparkline,
  paintExportText,
  setExportFont,
  buildExportTableStyles,
  applyExportTableRowStriping,
  applyConvPctHighlight,
  parsePctValue,
  sanitizeExportText,
  sanitizeTableForPdf,
  NAC_GOLD,
  NAC_TEAL,
  EXPORT_GOLD,
  EXPORT_RISK,
} from "./pdfVisualTheme";
import { branchDisplayName } from "../utils/rangeState";
import {
  formatGoogleMovementLine,
  formatGoogleTrackingFootnote,
} from "../utils/googleReviewSnapshotHistory";
import {
  REVIEW_METRIC_PDF,
  STAFF_AUDIT_TABLE_HEAD_PDF,
  drawStaffAuditTableLegend,
} from "../config/reviewMetricLabels";

const BRAND = "NAC HOSPITALITY OS";
const AMBER = [230, 168, 65];
const ROW_GOLD = [42, 56, 50];
const ROW_TEAL = [32, 48, 52];
const ROW_AMBER = [56, 46, 32];
const ROW_RISK = [56, 34, 34];
const CONV_COLS = [5, 6];
const METRIC_COLS = [4, 5, 6];

function toneFill(tone) {
  if (tone === "gold") return ROW_GOLD;
  if (tone === "teal") return ROW_TEAL;
  if (tone === "amber") return ROW_AMBER;
  if (tone === "critical") return ROW_RISK;
  return null;
}

function clip(str, max) {
  const s = sanitizeExportText(str);
  if (!s) return "-";
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}...`;
}

function networkTotals(reports) {
  return reports.reduce(
    (acc, r) => ({
      scans: acc.scans + (r.kpis?.qr_scans || 0),
      reviews: acc.reviews + (r.kpis?.reviews_generated || 0),
      google: acc.google + (r.kpis?.google_redirects || 0),
      staff: acc.staff + (r.staffRows?.length || 0),
    }),
    { scans: 0, reviews: 0, google: 0, staff: 0 },
  );
}

function sparklineValues(movementRow) {
  if (!movementRow) return [];
  const vals = [
    movementRow.period_delta,
    movementRow.week_delta,
    movementRow.month_delta,
    movementRow.today_delta,
  ].filter((v) => v != null && Number.isFinite(v));
  return vals.length >= 2 ? vals : [];
}

function drawGoogleMovementBlock(doc, margin, contentW, startY, googleMovement = []) {
  const lines = (googleMovement || []).map(formatGoogleMovementLine);
  const panelH = 28 + lines.length * 12 + 20;
  drawContentPanel(doc, margin, startY - 6, contentW, panelH);

  setExportFont(doc, 600, 9);
  paintExportText(doc, "Google review movement (snapshot-based)", margin + 8, startY + 8, {
    tier: "gold",
    shadow: true,
  });

  setExportFont(doc, 500, 8);
  let y = startY + 22;
  if (!lines.length) {
    paintExportText(doc, "No Google review snapshots stored yet.", margin + 8, y, {
      tier: "secondary",
      shadow: true,
    });
    return y + 16;
  }
  lines.forEach((line) => {
    paintExportText(doc, clip(line, 110), margin + 8, y, { tier: "secondary", shadow: true });
    y += 12;
  });

  const footnotes = (googleMovement || [])
    .map(formatGoogleTrackingFootnote)
    .filter(Boolean);
  if (footnotes.length) {
    setExportFont(doc, 500, 7);
    footnotes.forEach((note) => {
      paintExportText(doc, clip(note, 120), margin + 8, y + 2, { tier: "muted", shadow: true });
      y += 10;
    });
    y += 4;
  } else {
    y += 6;
  }
  return y;
}

function drawCoverPage(doc, margin, contentW, pageH, { periodLabel, rangeLabel, generated, reports, googleMovement }) {
  fillPage(doc);
  doc.setFillColor(...NAC_GOLD);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 5, "F");

  setExportFont(doc, 600, 9);
  paintExportText(doc, BRAND, margin, 36, { tier: "gold", shadow: true });

  setExportFont(doc, "bold", 28);
  paintExportText(doc, "Branch Operational Review", margin, 72, { tier: "primary", shadow: true });

  setExportFont(doc, 600, 12);
  paintExportText(doc, "Staff audit | card handoff funnel | coaching priorities", margin, 94, {
    tier: "secondary",
    shadow: true,
  });

  setExportFont(doc, 500, 10);
  paintExportText(doc, `Period: ${periodLabel || rangeLabel}`, margin, 118, {
    tier: "muted",
    shadow: true,
  });
  paintExportText(doc, `Generated ${generated} | Asia/Riyadh`, margin, 132, {
    tier: "muted",
    shadow: true,
  });

  const net = networkTotals(reports);
  const cardW = (contentW - 36) / 4;
  const cardH = 58;
  const cardY = 152;
  const cards = [
    { label: "Branches", value: String(reports.length), accent: NAC_GOLD },
    { label: "Network card taps", value: String(net.scans), accent: NAC_TEAL },
    { label: REVIEW_METRIC_PDF.reviewInteractions, value: String(net.reviews), accent: NAC_TEAL },
    { label: REVIEW_METRIC_PDF.googleRedirects, value: String(net.google), accent: NAC_GOLD },
  ];
  cards.forEach((c, i) => {
    drawKpiCard(doc, margin + i * (cardW + 12), cardY, cardW, cardH, c.label, c.value, c.accent);
  });

  const movementY = drawGoogleMovementBlock(
    doc,
    margin,
    contentW,
    cardY + cardH + 14,
    googleMovement,
  );

  const topBranch = [...reports].sort(
    (a, b) => (b.kpis?.google_redirects || 0) - (a.kpis?.google_redirects || 0),
  )[0];
  const leakBranch = [...reports].sort(
    (a, b) => (a.kpis?.conversion_pct || 0) - (b.kpis?.conversion_pct || 0),
  )[0];

  const brief = topBranch
    ? `${topBranch.branchLabel} leads Google follow-through (${topBranch.kpis?.google_redirects ?? 0}). ${
        leakBranch
          ? `${leakBranch.branchLabel} weakest tap/scan-to-Google (${leakBranch.kpis?.conversion_pct ?? 0}%).`
          : ""
      } ${net.staff} staff | ${net.scans} card taps in period.`
    : "Insufficient card-handoff events for network narrative.";

  drawCallout(doc, margin, movementY + 8, contentW, {
    accent: NAC_GOLD,
    title: "Intelligence brief",
    body: clip(brief, 220),
    hint: "One page per branch follows | full roster included",
  });

  setExportFont(doc, 500, 7);
  paintExportText(doc, "Confidential | Operational use only", margin, pageH - 32, {
    tier: "muted",
    shadow: true,
  });
}

function drawBranchHeader(doc, margin, contentW, report, rangeLabel, googleMovementRow) {
  fillPage(doc);
  doc.setFillColor(...NAC_GOLD);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 3, "F");

  setExportFont(doc, 600, 8);
  paintExportText(doc, BRAND, margin, 32, { tier: "gold", shadow: true });

  setExportFont(doc, "bold", 18);
  paintExportText(doc, report.branchLabel, margin, 52, { tier: "primary", shadow: true });

  setExportFont(doc, 500, 9);
  paintExportText(
    doc,
    `${rangeLabel} | ${report.staffRows.length} staff | ${report.summary.branchConversion}% tap-to-Google`,
    margin,
    68,
    { tier: "secondary", shadow: true },
  );

  let y = 82;
  if (googleMovementRow) {
    setExportFont(doc, 500, 8);
    paintExportText(doc, clip(formatGoogleMovementLine(googleMovementRow), 100), margin, y, {
      tier: "secondary",
      shadow: true,
    });
    const spark = sparklineValues(googleMovementRow);
    if (spark.length >= 2) {
      drawMicroSparkline(doc, margin + contentW - 88, y - 8, 72, 14, spark, NAC_TEAL);
    }
    y = 96;
  }

  return y;
}

function drawSummaryKpiGrid(doc, margin, contentW, y, summary, kpis) {
  const cardW = (contentW - 24) / 4;
  const cardH = 50;
  const row1 = [
    { label: REVIEW_METRIC_PDF.cardTaps, value: String(kpis?.qr_scans ?? 0), accent: NAC_TEAL },
    { label: REVIEW_METRIC_PDF.reviewInteractions, value: String(kpis?.reviews_generated ?? 0), accent: NAC_TEAL },
    { label: REVIEW_METRIC_PDF.googleRedirects, value: String(kpis?.google_redirects ?? 0), accent: NAC_GOLD },
    { label: "Recoverable est.", value: String(summary.estimatedRecoverableReviews), accent: NAC_GOLD },
  ];
  row1.forEach((c, i) => {
    drawKpiCard(doc, margin + i * (cardW + 8), y, cardW, cardH, c.label, c.value, c.accent);
  });

  const y2 = y + cardH + 12;
  const insightW = (contentW - 16) / 2;
  const insights = [
    { title: "Top performer", name: summary.strongestName, val: summary.strongestValue, accent: NAC_GOLD },
    { title: "Weakest follow-through", name: summary.weakestName, val: summary.weakestValue, accent: AMBER },
    { title: "Most card presentations", name: summary.bestVisName, val: summary.bestVisValue, accent: NAC_TEAL },
    { title: "Follow-through upside", name: summary.hiddenName, val: summary.hiddenValue, accent: AMBER },
  ];

  insights.forEach((item, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = margin + col * (insightW + 16);
    const iy = y2 + row * 54;
    drawContentPanel(doc, x, iy, insightW, 48);
    doc.setDrawColor(...item.accent);
    doc.setLineWidth(0.4);
    doc.roundedRect(x, iy, insightW, 48, 4, 4, "S");
    setExportFont(doc, 600, 7);
    paintExportText(doc, item.title, x + 8, iy + 13, { tier: "muted", shadow: true });
    setExportFont(doc, 600, 9);
    paintExportText(doc, clip(item.name, 22), x + 8, iy + 26, { tier: "primary", shadow: true });
    setExportFont(doc, 500, 8);
    paintExportText(doc, clip(item.val, 28), x + 8, iy + 38, { tier: "secondary", shadow: true });
  });

  return y2 + 118;
}

function staffTableBody(staffRows) {
  return staffRows.map((s) => [
    clip(s.name, 20),
    clip(s.role, 10),
    String(s.scans),
    String(s.generated),
    String(s.google),
    `${s.reviewConv}%`,
    `${s.cardToReviewEfficiency ?? s.visibilityEfficiency}%`,
    s.archetype,
    s.classification.label,
    clip(s.coaching, 48),
    s.shiftBehavior,
  ]);
}

function drawStaffAuditTable(doc, margin, contentW, startY, staffRows) {
  const tableH = Math.min(420, 28 + staffRows.length * 18);
  drawContentPanel(doc, margin - 4, startY - 6, contentW + 8, tableH);

  const tableData = sanitizeTableForPdf([STAFF_AUDIT_TABLE_HEAD_PDF], staffTableBody(staffRows));

  autoTable(doc, {
    ...buildExportTableStyles(),
    startY: startY + 2,
    head: tableData.head,
    body: tableData.body,
    margin: { left: margin, right: margin },
    tableWidth: contentW,
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const row = staffRows[data.row.index];
      if (!row) return;
      applyExportTableRowStriping(data, data.row.index);
      const tone = toneFill(row.tone);
      if (tone) data.cell.styles.fillColor = tone;

      if (METRIC_COLS.includes(data.column.index)) {
        data.cell.styles.fontStyle = "bold";
        if (data.column.index === 4) {
          data.cell.styles.textColor = EXPORT_GOLD;
        }
      }
      applyConvPctHighlight(data, parsePctValue(row.reviewConv), CONV_COLS);
      if (data.column.index === 6) {
        applyConvPctHighlight(data, parsePctValue(row.cardToReviewEfficiency ?? row.visibilityEfficiency), [6]);
      }

      if (row.tone === "gold") {
        data.cell.styles.textColor = NAC_GOLD;
        data.cell.styles.fontStyle = "bold";
      } else if (row.tone === "critical") {
        data.cell.styles.textColor = EXPORT_RISK;
      } else if (row.tone === "amber") {
        data.cell.styles.textColor = AMBER;
      }
      if (data.column.index === 9) {
        data.cell.styles.overflow = "hidden";
        data.cell.styles.cellWidth = 118;
      }
      if (data.column.index === 10) {
        data.cell.styles.overflow = "hidden";
        data.cell.styles.minCellWidth = 36;
      }
    },
    columnStyles: {
      0: { cellWidth: 58 },
      1: { cellWidth: 32 },
      2: { cellWidth: 26, halign: "right" },
      3: { cellWidth: 26, halign: "right" },
      4: { cellWidth: 28, halign: "right", fontStyle: "bold" },
      5: { cellWidth: 34, halign: "right", fontStyle: "bold" },
      6: { cellWidth: 36, halign: "right", fontStyle: "bold" },
      7: { cellWidth: 42 },
      8: { cellWidth: 52 },
      9: { cellWidth: 118 },
      10: { cellWidth: 38, overflow: "hidden" },
    },
  });
}

export function exportDetailedBranchOperationalReview({
  reports = [],
  rangeLabel,
  periodLabel,
  selectedRange,
  googleMovement = [],
}) {
  const period = periodLabel || rangeLabel;
  const movementByBranch = Object.fromEntries(
    (googleMovement || []).map((g) => [g.branch_id, g]),
  );
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const margin = 36;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - margin * 2;
  const generated = new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Riyadh",
    dateStyle: "medium",
    timeStyle: "short",
  });

  drawCoverPage(doc, margin, contentW, pageH, {
    periodLabel: period,
    rangeLabel: period,
    generated,
    reports,
    googleMovement,
  });

  reports.forEach((report, branchIdx) => {
    doc.addPage();
    let y = drawBranchHeader(
      doc,
      margin,
      contentW,
      report,
      period,
      movementByBranch[report.branchId],
    );
    y = drawSummaryKpiGrid(doc, margin, contentW, y, report.summary, report.kpis);

    setExportFont(doc, 600, 8);
    paintExportText(doc, "Full staff roster", margin, y, { tier: "teal", shadow: true });
    y += 10;
    y = drawStaffAuditTableLegend(doc, margin, y);

    if (report.staffRows.length === 0) {
      setExportFont(doc, 500, 9);
      paintExportText(doc, "No staff-tagged events in this period.", margin, y, {
        tier: "secondary",
        shadow: true,
      });
    } else {
      drawStaffAuditTable(doc, margin, contentW, y, report.staffRows);
    }

    setExportFont(doc, 500, 7);
    paintExportText(
      doc,
      `${BRAND} | ${report.branchLabel} | ${branchDisplayName(report.branchId)}`,
      margin,
      pageH - 24,
      { tier: "muted", shadow: true },
    );
    if (branchIdx === reports.length - 1) {
      paintExportText(
        doc,
        "Confidential operational intelligence",
        margin + contentW - 140,
        pageH - 24,
        { tier: "muted", shadow: true },
      );
    }
  });

  const safeRange = (selectedRange || "report").replace(/\s+/g, "-");
  doc.save(`nac-hospitality-branch-operational-review-${safeRange}.pdf`);
}
