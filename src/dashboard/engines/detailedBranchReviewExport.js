/**
 * Detailed Branch Operational Review — executive boardroom PDF.
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  fillPage,
  drawKpiCard,
  drawCallout,
  NAC_GOLD,
  NAC_TEAL,
  CARD_BG,
  NAC_WHITE,
} from "./pdfVisualTheme";
import { branchDisplayName } from "../utils/rangeState";
import {
  formatGoogleMovementLine,
  formatTrackingStartDate,
} from "../utils/googleReviewSnapshotHistory";
import {
  REVIEW_METRIC,
  STAFF_AUDIT_TABLE_HEAD,
  drawStaffAuditTableLegend,
} from "../config/reviewMetricLabels";

const BRAND = "NAC HOSPITALITY OS";
const AMBER = [230, 168, 65];
const DIM = [130, 130, 130];
const ROW_GOLD = [38, 52, 48];
const ROW_TEAL = [30, 44, 48];
const ROW_AMBER = [52, 42, 28];
const ROW_RISK = [52, 30, 30];

function toneFill(tone) {
  if (tone === "gold") return ROW_GOLD;
  if (tone === "teal") return ROW_TEAL;
  if (tone === "amber") return ROW_AMBER;
  if (tone === "critical") return ROW_RISK;
  return [18, 20, 24];
}

function clip(str, max) {
  const s = String(str || "").trim();
  if (s.length <= max) return s || "—";
  return `${s.slice(0, max - 1)}…`;
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

function drawGoogleMovementBlock(doc, margin, contentW, startY, googleMovement = []) {
  const lines = (googleMovement || []).map(formatGoogleMovementLine);
  const hasHistory = lines.some((l) => !l.includes("No snapshot history"));

  doc.setFontSize(9);
  doc.setTextColor(...NAC_GOLD);
  doc.text("Google review movement (snapshot-based)", margin, startY);

  doc.setFontSize(8);
  doc.setTextColor(200, 200, 200);
  let y = startY + 14;
  if (!lines.length) {
    doc.text("No Google review snapshots stored yet.", margin, y);
    return y + 16;
  }
  lines.forEach((line) => {
    doc.text(clip(line, 110), margin, y);
    y += 11;
  });

  const trackingStart = googleMovement.find((g) => g.tracking_start_date)?.tracking_start_date;
  if (hasHistory && trackingStart) {
    doc.setFontSize(7);
    doc.setTextColor(...DIM);
    doc.text(
      `Google review history available from ${formatTrackingStartDate(trackingStart)}. Not QR redirects.`,
      margin,
      y + 4,
    );
    y += 14;
  } else {
    y += 6;
  }
  return y;
}

function drawCoverPage(doc, margin, contentW, pageH, { rangeLabel, generated, reports, googleMovement }) {
  fillPage(doc);
  doc.setFillColor(...NAC_GOLD);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 5, "F");

  doc.setFontSize(9);
  doc.setTextColor(...NAC_GOLD);
  doc.text(BRAND, margin, 36);

  doc.setFontSize(28);
  doc.setTextColor(...NAC_WHITE);
  doc.text("Branch Operational Review", margin, 72);

  doc.setFontSize(12);
  doc.setTextColor(200, 200, 200);
  doc.text("Staff audit · card handoff funnel · coaching priorities", margin, 94);

  doc.setFontSize(10);
  doc.setTextColor(...DIM);
  doc.text(`Period: ${rangeLabel}`, margin, 118);
  doc.text(`Generated ${generated} · Asia/Riyadh`, margin, 132);

  const net = networkTotals(reports);
  const cardW = (contentW - 36) / 4;
  const cardH = 56;
  const cardY = 152;
  const cards = [
    { label: "Branches", value: String(reports.length), accent: NAC_GOLD },
    { label: "Network card taps", value: String(net.scans), accent: NAC_TEAL },
    { label: REVIEW_METRIC.reviewInteractions, value: String(net.reviews), accent: NAC_TEAL },
    { label: REVIEW_METRIC.googleRedirects, value: String(net.google), accent: NAC_GOLD },
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
      } ${net.staff} staff · ${net.scans} card taps in period.`
    : "Insufficient card-handoff events for network narrative.";

  drawCallout(doc, margin, movementY + 8, contentW, {
    accent: NAC_GOLD,
    title: "Intelligence brief",
    body: clip(brief, 220),
    hint: "One page per branch follows · full roster included",
  });

  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);
  doc.text("Confidential · Operational use only", margin, pageH - 32);
}

function drawBranchHeader(doc, margin, contentW, report, rangeLabel, googleMovementRow) {
  fillPage(doc);
  doc.setFillColor(...NAC_GOLD);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 3, "F");

  doc.setFontSize(8);
  doc.setTextColor(...NAC_GOLD);
  doc.text(BRAND, margin, 32);

  doc.setFontSize(18);
  doc.setTextColor(...NAC_WHITE);
  doc.text(report.branchLabel, margin, 52);

  doc.setFontSize(9);
  doc.setTextColor(...DIM);
  doc.text(
    `${rangeLabel} · ${report.staffRows.length} staff · ${report.summary.branchConversion}% tap→Google`,
    margin,
    68,
  );

  if (googleMovementRow) {
    doc.setFontSize(8);
    doc.setTextColor(180, 200, 195);
    doc.text(clip(formatGoogleMovementLine(googleMovementRow), 100), margin, 82);
    return 96;
  }

  return 82;
}

function drawSummaryKpiGrid(doc, margin, contentW, y, summary, kpis) {
  const cardW = (contentW - 24) / 4;
  const cardH = 48;
  const row1 = [
    { label: REVIEW_METRIC.cardTaps, value: String(kpis?.qr_scans ?? 0), accent: NAC_TEAL },
    { label: REVIEW_METRIC.reviewInteractions, value: String(kpis?.reviews_generated ?? 0), accent: NAC_TEAL },
    { label: REVIEW_METRIC.googleRedirects, value: String(kpis?.google_redirects ?? 0), accent: NAC_GOLD },
    { label: "Recoverable est.", value: String(summary.estimatedRecoverableReviews), accent: NAC_GOLD },
  ];
  row1.forEach((c, i) => {
    drawKpiCard(doc, margin + i * (cardW + 8), y, cardW, cardH, c.label, c.value, c.accent);
  });

  const y2 = y + cardH + 10;
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
    const iy = y2 + row * 52;
    doc.setFillColor(...CARD_BG);
    doc.setDrawColor(...item.accent);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, iy, insightW, 46, 4, 4, "FD");
    doc.setFontSize(7);
    doc.setTextColor(...DIM);
    doc.text(item.title, x + 8, iy + 12);
    doc.setFontSize(9);
    doc.setTextColor(...NAC_WHITE);
    doc.text(clip(item.name, 22), x + 8, iy + 24);
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.text(clip(item.val, 28), x + 8, iy + 36);
  });

  return y2 + 112;
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
  autoTable(doc, {
    startY,
    head: [STAFF_AUDIT_TABLE_HEAD],
    body: staffTableBody(staffRows),
    styles: {
      fontSize: 7,
      cellPadding: { top: 5, right: 4, bottom: 5, left: 4 },
      minCellHeight: 14,
      lineHeight: 1.35,
      textColor: [225, 225, 225],
      lineColor: [42, 46, 52],
      lineWidth: 0.15,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [24, 28, 34],
      textColor: NAC_GOLD,
      fontStyle: "bold",
      fontSize: 6,
      cellPadding: 4,
      overflow: "linebreak",
    },
    alternateRowStyles: { fillColor: [14, 16, 20] },
    margin: { left: margin, right: margin },
    tableWidth: contentW,
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const row = staffRows[data.row.index];
      if (!row) return;
      data.cell.styles.fillColor = toneFill(row.tone);
      if (data.column.index === 9) {
        data.cell.styles.overflow = "hidden";
        data.cell.styles.cellWidth = 118;
      }
      if (data.column.index === 10) {
        data.cell.styles.overflow = "hidden";
        data.cell.styles.minCellWidth = 36;
      }
      if (row.tone === "gold") {
        data.cell.styles.textColor = NAC_GOLD;
        data.cell.styles.fontStyle = "bold";
      } else if (row.tone === "critical") {
        data.cell.styles.textColor = [245, 190, 190];
      } else if (row.tone === "amber") {
        data.cell.styles.textColor = AMBER;
      }
    },
    columnStyles: {
      0: { cellWidth: 58 },
      1: { cellWidth: 32 },
      2: { cellWidth: 26, halign: "right" },
      3: { cellWidth: 26, halign: "right" },
      4: { cellWidth: 28, halign: "right" },
      5: { cellWidth: 34, halign: "right" },
      6: { cellWidth: 36, halign: "right" },
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
  selectedRange,
  googleMovement = [],
}) {
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

  drawCoverPage(doc, margin, contentW, pageH, { rangeLabel, generated, reports, googleMovement });

  reports.forEach((report, branchIdx) => {
    doc.addPage();
    let y = drawBranchHeader(
      doc,
      margin,
      contentW,
      report,
      rangeLabel,
      movementByBranch[report.branchId],
    );
    y = drawSummaryKpiGrid(doc, margin, contentW, y, report.summary, report.kpis);

    doc.setFontSize(8);
    doc.setTextColor(...NAC_TEAL);
    doc.text("Full staff roster", margin, y);
    y += 10;
    y = drawStaffAuditTableLegend(doc, margin, y);

    if (report.staffRows.length === 0) {
      doc.setFontSize(9);
      doc.setTextColor(160, 160, 160);
      doc.text("No staff-tagged events in this period.", margin, y);
    } else {
      drawStaffAuditTable(doc, margin, contentW, y, report.staffRows);
    }

    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text(
      `${BRAND} · ${report.branchLabel} · ${branchDisplayName(report.branchId)}`,
      margin,
      pageH - 24,
    );
    if (branchIdx === reports.length - 1) {
      doc.text("Confidential operational intelligence", margin + contentW - 140, pageH - 24);
    }
  });

  const safeRange = (selectedRange || "report").replace(/\s+/g, "-");
  doc.save(`nac-hospitality-branch-operational-review-${safeRange}.pdf`);
}
