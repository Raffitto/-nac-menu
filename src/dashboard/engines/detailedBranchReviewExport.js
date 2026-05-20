/**
 * Detailed Branch Operational Review — boardroom PDF export (one page per branch).
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  fillPage,
  NAC_GOLD,
  NAC_TEAL,
  CARD_BG,
} from "./pdfVisualTheme";

const BRAND = "NAC HOSPITALITY OS";
const AMBER = [230, 168, 65];
const ROW_GOLD = [42, 58, 52];
const ROW_TEAL = [32, 48, 52];
const ROW_AMBER = [58, 46, 28];
const ROW_RISK = [58, 32, 32];

function toneFill(tone) {
  if (tone === "gold") return ROW_GOLD;
  if (tone === "teal") return ROW_TEAL;
  if (tone === "amber") return ROW_AMBER;
  if (tone === "critical") return ROW_RISK;
  return CARD_BG;
}

function drawBrandHeader(doc, margin, contentW, title, meta) {
  fillPage(doc);
  doc.setFillColor(...NAC_GOLD);
  doc.rect(0, 0, contentW + margin * 2, 4, "F");

  doc.setFontSize(20);
  doc.setTextColor(...NAC_GOLD);
  doc.text(BRAND, margin, 40);

  doc.setFontSize(14);
  doc.setTextColor(249, 249, 247);
  doc.text(title, margin, 62);

  doc.setFontSize(8);
  doc.setTextColor(160, 160, 160);
  meta.forEach((line, i) => {
    doc.text(line, margin, 78 + i * 11);
  });

  return 96;
}

function drawExecutiveSummary(doc, margin, contentW, y, summary, kpis) {
  const boxH = 88;
  doc.setFillColor(...CARD_BG);
  doc.setDrawColor(...NAC_TEAL);
  doc.setLineWidth(0.4);
  doc.roundedRect(margin, y, contentW, boxH, 5, 5, "FD");

  doc.setFontSize(9);
  doc.setTextColor(...NAC_GOLD);
  doc.text("Branch executive summary", margin + 12, y + 16);

  const cols = [
    ["Strongest performer", summary.strongestPerformer],
    ["Weakest conversion", summary.weakestConversion],
    ["Best visibility", summary.bestVisibility],
    ["Hidden opportunity", summary.hiddenOpportunity],
    ["Est. recoverable Google reviews", String(summary.estimatedRecoverableReviews)],
    ["Branch QR→Google conv.", `${summary.branchConversion}%`],
    ["Staff in roster", String(summary.staffCount)],
    ["Reviews generated", String(kpis?.reviews_generated ?? 0)],
  ];

  const colW = contentW / 2 - 8;
  cols.forEach((row, i) => {
    const col = i % 2;
    const rowIdx = Math.floor(i / 2);
    const x = margin + 12 + col * colW;
    const ly = y + 28 + rowIdx * 14;
    doc.setFontSize(7);
    doc.setTextColor(130, 130, 130);
    doc.text(row[0], x, ly);
    doc.setFontSize(7.5);
    doc.setTextColor(220, 220, 220);
    doc.splitTextToSize(String(row[1]), colW - 4).slice(0, 1).forEach((ln) => {
      doc.text(ln, x, ly + 9);
    });
  });

  return y + boxH + 14;
}

function staffTableBody(staffRows) {
  return staffRows.map((s) => [
    s.name,
    s.role,
    String(s.scans),
    String(s.generated),
    String(s.google),
    `${s.reviewConv}%`,
    `${s.visibilityEfficiency}%`,
    s.archetype,
    s.classification.label,
    s.coaching,
    s.shiftBehavior,
  ]);
}

function drawStaffAuditTable(doc, margin, contentW, startY, staffRows) {
  autoTable(doc, {
    startY,
    head: [
      [
        "Staff",
        "Role",
        "QR scans",
        "Reviews",
        "Google",
        "Conv %",
        "Vis eff %",
        "Archetype",
        "Classification",
        "Coaching",
        "Shift",
      ],
    ],
    body: staffTableBody(staffRows),
    styles: {
      fontSize: 6.5,
      cellPadding: 3,
      textColor: [230, 230, 230],
      lineColor: [45, 48, 55],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [28, 32, 38],
      textColor: NAC_GOLD,
      fontStyle: "bold",
      fontSize: 6.5,
    },
    alternateRowStyles: { fillColor: [18, 20, 24] },
    margin: { left: margin, right: margin },
    tableWidth: contentW,
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const row = staffRows[data.row.index];
      if (!row) return;
      data.cell.styles.fillColor = toneFill(row.tone);
      if (row.tone === "gold") {
        data.cell.styles.textColor = NAC_GOLD;
        data.cell.styles.fontStyle = "bold";
      } else if (row.tone === "critical") {
        data.cell.styles.textColor = [245, 180, 180];
      } else if (row.tone === "amber") {
        data.cell.styles.textColor = AMBER;
      }
    },
    columnStyles: {
      0: { cellWidth: 62 },
      8: { cellWidth: 72 },
      9: { cellWidth: contentW * 0.28 },
      10: { cellWidth: 52 },
    },
  });
}

/**
 * @param {{ reports: object[], rangeLabel: string, selectedRange: string }} opts
 */
export function exportDetailedBranchOperationalReview({
  reports = [],
  rangeLabel,
  selectedRange,
}) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const margin = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - margin * 2;
  const generated = new Date().toLocaleString("en-GB", { timeZone: "Asia/Riyadh" });

  drawBrandHeader(doc, margin, contentW, "Detailed Branch Operational Review", [
    `Period: ${rangeLabel}`,
    `Generated ${generated} · Asia/Riyadh business day logic`,
    "Operational audit · coaching report · executive review system",
  ]);

  reports.forEach((report, branchIdx) => {
    doc.addPage();
    let y = drawBrandHeader(
      doc,
      margin,
      contentW,
      `${report.branchLabel} — Staff operational audit`,
      [
        `Period: ${rangeLabel}`,
        `QR scans ${report.kpis?.qr_scans ?? 0} · Reviews ${report.kpis?.reviews_generated ?? 0} · Google ${report.kpis?.google_redirects ?? 0}`,
        `Branch conversion ${report.kpis?.conversion_pct ?? 0}% · Full roster (${report.staffRows.length} staff)`,
      ],
    );

    y = drawExecutiveSummary(doc, margin, contentW, y, report.summary, report.kpis);

    doc.setFontSize(8);
    doc.setTextColor(...NAC_TEAL);
    doc.text("Complete staff roster — classifications drive coaching priority", margin, y);
    y += 10;

    if (report.staffRows.length === 0) {
      doc.setFontSize(9);
      doc.setTextColor(180, 180, 180);
      doc.text(
        "No staff-tagged review events in this period. Ensure QR flows capture employee_name.",
        margin,
        y + 12,
      );
    } else {
      drawStaffAuditTable(doc, margin, contentW, y, report.staffRows);
    }

    if (branchIdx === reports.length - 1) {
      const footY = doc.internal.pageSize.getHeight() - 28;
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text(
        `${BRAND} · Confidential operational intelligence · Not for guest distribution`,
        margin,
        footY,
      );
    }
  });

  const safeRange = (selectedRange || "report").replace(/\s+/g, "-");
  doc.save(`nac-hospitality-branch-operational-review-${safeRange}.pdf`);
}
