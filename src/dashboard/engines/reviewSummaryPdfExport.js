/**
 * Review Intelligence summary PDF — boardroom layout (dark, dense).
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  fillPage,
  drawKpiCard,
  drawCallout,
  drawHBar,
  NAC_GOLD,
  NAC_TEAL,
  CARD_BG,
  NAC_WHITE,
  COLOR_RISK,
} from "./pdfVisualTheme";
import { branchDisplayName } from "../utils/rangeState";
import { filterProductionStaffList } from "../utils/isProductionStaff";
import {
  REVIEW_FUNNEL_SUBTITLE,
  REVIEW_METRIC,
  STAFF_SUMMARY_TABLE_HEAD,
  BRANCH_BENCHMARK_TABLE_HEAD,
} from "../config/reviewMetricLabels";

const BRAND = "NAC HOSPITALITY OS";
const DIM = [130, 130, 130];

function clip(str, max) {
  const s = String(str || "").trim();
  if (s.length <= max) return s || "—";
  return `${s.slice(0, max - 1)}…`;
}

export function buildExecutiveBrief(review, staffStats, comparison, branch) {
  const staff = filterProductionStaffList(staffStats);
  const scans = review?.qr_scans ?? 0;
  const google = review?.google_clicks ?? 0;
  const conv = review?.conversion_pct ?? 0;
  const missed = Math.max(0, Math.round(scans * (Math.max(22, conv) / 100)) - google);

  const branches = (comparison || []).filter((b) => b.qr_scans > 0);
  const strongest = [...branches].sort((a, b) => b.google_redirects - a.google_redirects)[0];
  const weakest = [...branches].sort((a, b) => a.conversion_pct - b.conversion_pct)[0];

  const hiVisLow = [...staff]
    .filter((s) => s.opens >= 6 && s.conversion_pct < 18)
    .sort((a, b) => b.opens - a.opens)[0];

  let topOpportunity = "—";
  if (hiVisLow?.name) {
    topOpportunity = `${hiVisLow.name}: high card exposure, ${hiVisLow.conversion_pct}% Google follow-through`;
  } else if (conv < 22 && scans > 10) {
    topOpportunity = `Lift tap/scan-to-Google above ${conv}% with stronger verbal close`;
  } else if (strongest) {
    topOpportunity = `Scale ${branchDisplayName(strongest.branch_id)} card handoff playbook network-wide`;
  }

  const recommendation =
    missed > 0
      ? `Close ~${missed} missed Google redirects — coach post-review verbal CTA.`
      : conv >= 28
        ? "Protect top handoff performers; coach weakest follow-through only."
        : "Drill NFC/QR card presentation and Google redirect at bill close.";

  return {
    topOpportunity: clip(topOpportunity, 90),
    strongestBranch: strongest
      ? `${branchDisplayName(strongest.branch_id)} · ${strongest.google_redirects} redirects`
      : "—",
    weakestFunnel: weakest
      ? `${branchDisplayName(weakest.branch_id)} · ${weakest.conversion_pct}% conversion`
      : "—",
    missedGoogle: missed,
    recommendation: clip(recommendation, 100),
    branchLabel: branch,
  };
}

function drawMiniBarPanel(doc, x, y, w, title, items, valueKey, color) {
  doc.setFillColor(...CARD_BG);
  doc.setDrawColor(50, 54, 60);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, 118, 4, 4, "FD");

  doc.setFontSize(8);
  doc.setTextColor(...NAC_GOLD);
  doc.text(title, x + 10, y + 14);

  let cy = y + 26;
  const max = Math.max(...items.map((i) => Number(i[valueKey]) || 0), 1);
  items.slice(0, 6).forEach((item) => {
    const label = clip(item.name || item.branch_id, 14);
    const val = Number(item[valueKey]) || 0;
    doc.setFontSize(7);
    doc.setTextColor(...DIM);
    doc.text(label, x + 10, cy);
    drawHBar(doc, x + 72, cy - 5, w - 100, 6, (val / max) * 100, color);
    doc.setFontSize(7);
    doc.setTextColor(200, 200, 200);
    doc.text(String(val), x + w - 28, cy);
    cy += 14;
  });
}

/**
 * @param {object} ctx — exportReviewIntelligenceReport context
 */
export function exportReviewSummaryPdf(ctx) {
  const {
    branch,
    rangeLabel,
    review,
    staffStats = [],
    comparison: comparisonIn,
    branchComparison,
  } = ctx;
  const comparison = comparisonIn ?? branchComparison ?? [];
  const productionStaff = filterProductionStaffList(staffStats);

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const margin = 44;
  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - margin * 2;
  const generated = new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Riyadh",
    timeStyle: "short",
    dateStyle: "medium",
  });
  const brief = buildExecutiveBrief(review, productionStaff, comparison, branch);

  fillPage(doc);
  doc.setFillColor(...NAC_GOLD);
  doc.rect(0, 0, pageW, 4, "F");

  doc.setFontSize(9);
  doc.setTextColor(...NAC_GOLD);
  doc.text(BRAND, margin, 40);

  doc.setFontSize(22);
  doc.setTextColor(...NAC_WHITE);
  doc.text("Review Intelligence", margin, 68);

  doc.setFontSize(11);
  doc.setTextColor(190, 190, 190);
  doc.text(`${branch} · ${rangeLabel}`, margin, 88);

  doc.setFontSize(8);
  doc.setTextColor(...DIM);
  doc.text(REVIEW_FUNNEL_SUBTITLE, margin, 102);
  doc.text(`Report generated ${generated}`, margin, 114);

  const cardW = (contentW - 24) / 4;
  const cardY = 126;
  const metrics = [
    { label: REVIEW_METRIC.cardTaps, value: review?.qr_scans ?? 0, accent: NAC_TEAL },
    { label: REVIEW_METRIC.reviewInteractions, value: review?.reviews_generated ?? 0, accent: NAC_TEAL },
    { label: REVIEW_METRIC.googleRedirects, value: review?.google_clicks ?? 0, accent: NAC_GOLD },
    { label: REVIEW_METRIC.tapToGooglePct, value: `${review?.conversion_pct ?? 0}%`, accent: NAC_GOLD },
  ];
  metrics.forEach((m, i) => {
    drawKpiCard(doc, margin + i * (cardW + 8), cardY, cardW, 50, m.label, m.value, m.accent);
  });

  let y = cardY + 68;
  y = drawCallout(doc, margin, y, contentW, {
    accent: NAC_GOLD,
    title: "Executive read",
    body: brief.recommendation,
    hint: `Est. ${brief.missedGoogle} missed Google redirects in period`,
  });

  const halfW = (contentW - 12) / 2;
  const narrative = [
    { t: "Top opportunity", v: brief.topOpportunity, accent: NAC_TEAL },
    { t: "Strongest branch", v: brief.strongestBranch, accent: NAC_GOLD },
    { t: "Weakest funnel", v: brief.weakestFunnel, accent: COLOR_RISK },
  ];
  narrative.forEach((n, i) => {
    const x = margin + (i % 2) * (halfW + 12);
    const row = Math.floor(i / 2);
    const ny = y + row * 44;
    doc.setFillColor(...CARD_BG);
    doc.setDrawColor(...n.accent);
    doc.roundedRect(x, ny, i === 2 ? contentW : halfW, 38, 3, 3, "FD");
    doc.setFontSize(7);
    doc.setTextColor(...DIM);
    doc.text(n.t, x + 8, ny + 12);
    doc.setFontSize(8);
    doc.setTextColor(...NAC_WHITE);
    doc.text(n.v, x + 8, ny + 26);
  });
  y += 96;

  if (productionStaff.length > 0 || comparison.length > 0) {
    const chartW = (contentW - 12) / 2;
    if (productionStaff.length) {
      drawMiniBarPanel(
        doc,
        margin,
        y,
        chartW,
        "Card taps by staff (QR/NFC)",
        productionStaff.map((s) => ({ name: s.name, scans: s.opens })),
        "scans",
        NAC_TEAL,
      );
    }
    if (comparison.length) {
      drawMiniBarPanel(
        doc,
        margin + chartW + 12,
        y,
        chartW,
        "Google redirects by branch",
        comparison.map((b) => ({
          branch_id: branchDisplayName(b.branch_id),
          google: b.google_redirects,
        })),
        "google",
        NAC_GOLD,
      );
    }
    y += 128;
  }

  if (productionStaff.length > 0) {
    doc.setFontSize(10);
    doc.setTextColor(...NAC_GOLD);
    doc.text("Staff summary", margin, y);
    y += 8;

    autoTable(doc, {
      startY: y,
      head: [STAFF_SUMMARY_TABLE_HEAD],
      body: productionStaff.slice(0, 14).map((s) => [
        clip(s.name, 18),
        clip(s.role, 8),
        s.opens,
        s.generated,
        s.google,
        `${s.conversion_pct}%`,
      ]),
      styles: {
        fontSize: 8,
        cellPadding: 5,
        minCellHeight: 13,
        lineHeight: 1.3,
        textColor: [220, 220, 220],
        lineColor: [45, 48, 55],
      },
      headStyles: {
        fillColor: [24, 28, 34],
        textColor: NAC_GOLD,
        fontStyle: "bold",
      },
      alternateRowStyles: { fillColor: [16, 18, 22] },
      margin: { left: margin, right: margin },
      tableWidth: contentW,
    });

    if (comparison.length > 0) {
      const y2 = doc.lastAutoTable.finalY + 16;
      doc.setFontSize(10);
      doc.setTextColor(...NAC_GOLD);
      doc.text("Branch benchmark", margin, y2);

      autoTable(doc, {
        startY: y2 + 8,
        head: [BRANCH_BENCHMARK_TABLE_HEAD],
        body: comparison.map((b) => [
          branchDisplayName(b.branch_id),
          b.qr_scans,
          b.reviews_generated,
          b.google_redirects,
          `${b.conversion_pct}%`,
        ]),
        styles: {
          fontSize: 8,
          cellPadding: 5,
          minCellHeight: 13,
          textColor: [220, 220, 220],
        },
        headStyles: {
          fillColor: [24, 28, 34],
          textColor: NAC_GOLD,
        },
        margin: { left: margin, right: margin },
        tableWidth: contentW,
      });
    }
  }

  const safeBranch = (branch || "network").replace(/\s+/g, "-").toLowerCase();
  const safeRange = (ctx.selectedRange || "report").replace(/\s+/g, "-");
  doc.save(`nac-review-intelligence-${safeBranch}-${safeRange}.pdf`);
}
