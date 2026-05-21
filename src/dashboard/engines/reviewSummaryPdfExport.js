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
  drawContentPanel,
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
  COLOR_RISK,
} from "./pdfVisualTheme";
import { branchDisplayName } from "../utils/rangeState";
import { filterProductionStaffList } from "../utils/isProductionStaff";
import {
  REVIEW_FUNNEL_SUBTITLE_PDF,
  REVIEW_METRIC_PDF,
  STAFF_SUMMARY_TABLE_HEAD,
  BRANCH_BENCHMARK_TABLE_HEAD,
} from "../config/reviewMetricLabels";

const BRAND = "NAC HOSPITALITY OS";
const CONV_COL = 5;
const GOOGLE_COL = 4;

function clip(str, max) {
  const s = sanitizeExportText(str);
  if (!s) return "-";
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}...`;
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

  let topOpportunity = "-";
  if (hiVisLow?.name) {
    topOpportunity = `${hiVisLow.name}: high card exposure, ${hiVisLow.conversion_pct}% Google follow-through`;
  } else if (conv < 22 && scans > 10) {
    topOpportunity = `Lift tap/scan-to-Google above ${conv}% with stronger verbal close`;
  } else if (strongest) {
    topOpportunity = `Scale ${branchDisplayName(strongest.branch_id)} card handoff playbook network-wide`;
  }

  const recommendation =
    missed > 0
      ? `Close ~${missed} missed Google redirects - coach post-review verbal CTA.`
      : conv >= 28
        ? "Protect top handoff performers; coach weakest follow-through only."
        : "Drill NFC/QR card presentation and Google redirect at bill close.";

  return {
    topOpportunity: clip(topOpportunity, 90),
    strongestBranch: strongest
      ? `${branchDisplayName(strongest.branch_id)} | ${strongest.google_redirects} redirects`
      : "-",
    weakestFunnel: weakest
      ? `${branchDisplayName(weakest.branch_id)} | ${weakest.conversion_pct}% conversion`
      : "-",
    missedGoogle: missed,
    recommendation: clip(recommendation, 100),
    branchLabel: branch,
  };
}

function drawMiniBarPanel(doc, x, y, w, title, items, valueKey, color) {
  drawContentPanel(doc, x, y, w, 120);
  setExportFont(doc, 600, 8);
  paintExportText(doc, title, x + 10, y + 14, { tier: "gold", shadow: true });

  let cy = y + 28;
  const max = Math.max(...items.map((i) => Number(i[valueKey]) || 0), 1);
  items.slice(0, 6).forEach((item) => {
    const label = clip(item.name || item.branch_id, 14);
    const val = Number(item[valueKey]) || 0;
    setExportFont(doc, 500, 7);
    paintExportText(doc, label, x + 10, cy, { tier: "muted", shadow: true });
    drawHBar(doc, x + 72, cy - 5, w - 100, 7, (val / max) * 100, color);
    setExportFont(doc, 600, 7);
    paintExportText(doc, String(val), x + w - 28, cy, { tier: "primary", shadow: true });
    cy += 15;
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

  setExportFont(doc, 600, 9);
  paintExportText(doc, BRAND, margin, 40, { tier: "gold", shadow: true });

  setExportFont(doc, "bold", 22);
  paintExportText(doc, "Review Intelligence", margin, 68, { tier: "primary", shadow: true });

  setExportFont(doc, 600, 11);
  paintExportText(doc, branch, margin, 88, { tier: "secondary", shadow: true });

  setExportFont(doc, 500, 8);
  paintExportText(doc, `Period: ${rangeLabel}`, margin, 102, { tier: "muted", shadow: true });
  paintExportText(doc, REVIEW_FUNNEL_SUBTITLE_PDF, margin, 114, { tier: "muted", shadow: true });
  paintExportText(doc, `Report generated ${generated}`, margin, 126, { tier: "muted", shadow: true });

  const cardW = (contentW - 24) / 4;
  const cardY = 138;
  const metrics = [
    { label: REVIEW_METRIC_PDF.cardTaps, value: review?.qr_scans ?? 0, accent: NAC_TEAL },
    { label: REVIEW_METRIC_PDF.reviewInteractions, value: review?.reviews_generated ?? 0, accent: NAC_TEAL },
    { label: REVIEW_METRIC_PDF.googleRedirects, value: review?.google_clicks ?? 0, accent: NAC_GOLD },
    { label: REVIEW_METRIC_PDF.tapToGooglePct, value: `${review?.conversion_pct ?? 0}%`, accent: NAC_GOLD },
  ];
  metrics.forEach((m, i) => {
    drawKpiCard(doc, margin + i * (cardW + 8), cardY, cardW, 52, m.label, m.value, m.accent);
  });

  let y = cardY + 72;
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
    const ny = y + row * 46;
    const nw = i === 2 ? contentW : halfW;
    drawContentPanel(doc, x, ny, nw, 40);
    doc.setDrawColor(...n.accent);
    doc.roundedRect(x, ny, nw, 40, 3, 3, "S");
    setExportFont(doc, 600, 7);
    paintExportText(doc, n.t, x + 8, ny + 12, { tier: "muted", shadow: true });
    setExportFont(doc, 500, 8);
    paintExportText(doc, n.v, x + 8, ny + 26, { tier: "primary", shadow: true, maxWidth: nw - 16 });
  });
  y += 100;

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
    y += 132;
  }

  if (productionStaff.length > 0) {
    setExportFont(doc, 600, 10);
    paintExportText(doc, "Staff summary", margin, y, { tier: "gold", shadow: true });
    y += 6;
    drawContentPanel(doc, margin - 4, y, contentW + 8, Math.min(320, 36 + productionStaff.length * 18));

    const staffTable = sanitizeTableForPdf(
      [STAFF_SUMMARY_TABLE_HEAD],
      productionStaff.slice(0, 14).map((s) => [
        clip(s.name, 18),
        clip(s.role, 8),
        s.opens,
        s.generated,
        s.google,
        `${s.conversion_pct}%`,
      ]),
    );

    autoTable(doc, {
      ...buildExportTableStyles({ styles: { fontSize: 8 } }),
      startY: y + 4,
      head: staffTable.head,
      body: staffTable.body,
      margin: { left: margin, right: margin },
      tableWidth: contentW,
      didParseCell: (data) => {
        if (data.section !== "body") return;
        const row = productionStaff[data.row.index];
        if (!row) return;
        applyExportTableRowStriping(data, data.row.index);
        if (data.column.index === GOOGLE_COL) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = NAC_GOLD;
        }
        applyConvPctHighlight(data, parsePctValue(row.conversion_pct), [CONV_COL]);
      },
      columnStyles: {
        4: { halign: "right", fontStyle: "bold" },
        5: { halign: "right", fontStyle: "bold" },
      },
    });

    if (comparison.length > 0) {
      const y2 = doc.lastAutoTable.finalY + 18;
      setExportFont(doc, 600, 10);
      paintExportText(doc, "Branch benchmark", margin, y2, { tier: "gold", shadow: true });
      drawContentPanel(doc, margin - 4, y2 + 6, contentW + 8, 28 + comparison.length * 18);

      const branchTable = sanitizeTableForPdf(
        [BRANCH_BENCHMARK_TABLE_HEAD],
        comparison.map((b) => [
          branchDisplayName(b.branch_id),
          b.qr_scans,
          b.reviews_generated,
          b.google_redirects,
          `${b.conversion_pct}%`,
        ]),
      );

      autoTable(doc, {
        ...buildExportTableStyles({ styles: { fontSize: 8 } }),
        startY: y2 + 10,
        head: branchTable.head,
        body: branchTable.body,
        margin: { left: margin, right: margin },
        tableWidth: contentW,
        didParseCell: (data) => {
          if (data.section !== "body") return;
          const row = comparison[data.row.index];
          if (!row) return;
          applyExportTableRowStriping(data, data.row.index);
          if (data.column.index === 3) {
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.textColor = NAC_GOLD;
          }
          applyConvPctHighlight(data, parsePctValue(row.conversion_pct), [4]);
        },
        columnStyles: {
          3: { halign: "right", fontStyle: "bold" },
          4: { halign: "right", fontStyle: "bold" },
        },
      });
    }
  }

  const safeBranch = (branch || "network").replace(/\s+/g, "-").toLowerCase();
  const safeRange = (ctx.selectedRange || "report").replace(/\s+/g, "-");
  doc.save(`nac-review-intelligence-${safeBranch}-${safeRange}.pdf`);
}
