/**
 * Boardroom executive PDF — summary briefing page + polished ranked sections.
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  fillPage,
  drawContentPanel,
  paintExportText,
  setExportFont,
  buildExportTableStyles,
  applyExportTableRowStriping,
  NAC_GOLD,
} from "./pdfVisualTheme";
import { sanitizeTableForPdf } from "../utils/exportExecutiveVisual";

const BRAND = "NAC HOSPITALITY OS";
const TOP3_FILL = [58, 48, 28];
const TOP3_BORDER = [215, 188, 138];

function clip(str, max = 36) {
  const s = String(str || "").trim();
  if (!s) return "—";
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function drawExecutiveHeaderBar(doc, pageW) {
  doc.setFillColor(...NAC_GOLD);
  doc.rect(0, 0, pageW, 5, "F");
  doc.setFillColor(12, 13, 15);
  doc.rect(0, 5, pageW, 52, "F");
  setExportFont(doc, 600, 8);
  paintExportText(doc, BRAND, 44, 28, { tier: "gold", shadow: false });
}

function drawSummaryMetricCard(doc, x, y, w, h, { label, value, sub }) {
  doc.setFillColor(16, 18, 22);
  doc.setDrawColor(...TOP3_BORDER);
  doc.setLineWidth(0.4);
  doc.roundedRect(x, y, w, h, 5, 5, "FD");
  setExportFont(doc, 500, 7);
  paintExportText(doc, label, x + 10, y + 14, { tier: "muted", shadow: false });
  setExportFont(doc, 600, 10);
  paintExportText(doc, value || "—", x + 10, y + 28, { tier: "primary", shadow: false });
  if (sub) {
    setExportFont(doc, 500, 7);
    paintExportText(doc, sub, x + 10, y + 42, { tier: "secondary", shadow: false });
  }
}

function drawExecutiveSummaryPage(doc, pkg, margin, contentW) {
  const pageW = doc.internal.pageSize.getWidth();
  fillPage(doc);
  drawExecutiveHeaderBar(doc, pageW);

  const s = pkg.summary || {};
  let y = 72;

  setExportFont(doc, "bold", 22);
  paintExportText(doc, "Executive Operational Briefing", margin, y, { tier: "primary", shadow: true });
  y += 28;

  setExportFont(doc, 500, 9);
  paintExportText(doc, `Period: ${s.period || pkg.meta.periodLabel}`, margin, y, { tier: "muted" });
  y += 12;
  paintExportText(doc, `Branch: ${s.branch}`, margin, y, { tier: "muted" });
  y += 12;
  paintExportText(doc, `Generated: ${s.generated_at || pkg.meta.generatedAtLabel}`, margin, y, { tier: "muted" });
  y += 14;

  const cardW = (contentW - 12) / 2;
  const cardH = 54;
  drawSummaryMetricCard(doc, margin, y, cardW, cardH, {
    label: "Operational trust score",
    value: s.operational_trust_score != null ? `${s.operational_trust_score} / 100` : "—",
    sub: s.operational_trust_tier,
  });
  drawSummaryMetricCard(doc, margin + cardW + 12, y, cardW, cardH, {
    label: "Data confidence",
    value: s.data_confidence,
    sub: pkg.periodAlignment?.reportPartial ? "Partial period coverage" : "Aligned imports",
  });
  y += cardH + 18;

  if (s.period_coverage_note) {
    drawContentPanel(doc, margin, y, contentW, 32);
    setExportFont(doc, 500, 7.5);
    doc.splitTextToSize(s.period_coverage_note, contentW - 16).slice(0, 2).forEach((ln, i) => {
      paintExportText(doc, ln, margin + 8, y + 12 + i * 10, { tier: "risk", shadow: false });
    });
    y += 40;
  }

  const halfW = (contentW - 10) / 2;
  const briefCards = [
    {
      label: "Top seller",
      value: s.top_seller?.item,
      sub: s.top_seller ? `${s.top_seller.qty} units · ${s.top_seller.sales} · ${s.top_seller.contribution_pct} of qty` : null,
    },
    {
      label: "Weakest seller",
      value: s.weakest_seller?.item,
      sub: s.weakest_seller?.note,
    },
    {
      label: "Top waiter",
      value: s.top_waiter?.name,
      sub: s.top_waiter ? `${s.top_waiter.sales} · ${s.top_waiter.contribution_pct} of team net` : null,
    },
    {
      label: "Top upseller",
      value: s.top_upseller?.name,
      sub: s.top_upseller
        ? `${s.top_upseller.qty} upsell units · ${s.top_upseller.sales} · ${s.top_upseller.contribution_pct}`
        : "Select upsell items in export dialog",
    },
    {
      label: "Top Google converter",
      value: s.top_google_converter?.name,
      sub: s.top_google_converter
        ? `${s.top_google_converter.redirects} redirects · ${s.top_google_converter.conversion_pct} · ${s.top_google_converter.contribution_pct} share`
        : null,
    },
    {
      label: "Operational concern",
      value: s.operational_concern?.title,
      sub: s.operational_concern?.body,
    },
  ];

  briefCards.forEach((card, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = margin + col * (halfW + 10);
    const cy = y + row * (cardH + 10);
    if (cy + cardH > doc.internal.pageSize.getHeight() - 80 && i > 0) return;
    drawSummaryMetricCard(doc, cx, cy, halfW, cardH, card);
  });

  y += Math.ceil(briefCards.length / 2) * (cardH + 10) + 8;

  drawContentPanel(doc, margin, y, contentW, 48);
  setExportFont(doc, 600, 8);
  paintExportText(doc, "Recommended action", margin + 10, y + 14, { tier: "gold", shadow: false });
  setExportFont(doc, 500, 8);
  doc.splitTextToSize(s.recommended_action || "—", contentW - 20).slice(0, 3).forEach((ln, i) => {
    paintExportText(doc, ln, margin + 10, y + 28 + i * 10, { tier: "secondary", shadow: false });
  });
}

function drawSectionDivider(doc, margin, y, contentW, title) {
  doc.setDrawColor(...TOP3_BORDER);
  doc.setLineWidth(0.5);
  doc.line(margin, y, margin + contentW, y);
  return y + 10;
}

function drawRankedTable(doc, { margin, contentW, startY, head, body, foot, topThreeCount = 3 }) {
  const tableRows = [...body];
  if (foot?.length) tableRows.push(foot);

  const table = sanitizeTableForPdf(head, tableRows);
  const bodyRowCount = body.length;

  autoTable(doc, {
    ...buildExportTableStyles({
      styles: { fontSize: 7.5, cellPadding: { top: 7, right: 6, bottom: 7, left: 6 }, minCellHeight: 18 },
      footStyles: {
        fillColor: [28, 30, 36],
        textColor: NAC_GOLD,
        fontStyle: "bold",
        fontSize: 7.5,
      },
    }),
    startY,
    head: table.head,
    body: table.body.slice(0, bodyRowCount),
    foot: foot?.length ? [table.body[bodyRowCount]] : undefined,
    margin: { left: margin, right: margin },
    tableWidth: contentW,
    didParseCell: (data) => {
      if (data.section === "head") return;
      if (data.section === "foot") {
        data.cell.styles.fillColor = [28, 30, 36];
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = NAC_GOLD;
        return;
      }
      if (data.section !== "body") return;
      const isTop = data.row.index < topThreeCount;
      applyExportTableRowStriping(data, data.row.index);
      if (isTop) {
        data.cell.styles.fillColor = TOP3_FILL;
        data.cell.styles.lineWidth = { top: 0.6, right: 0.3, bottom: 0.6, left: 0.3 };
        data.cell.styles.lineColor = TOP3_BORDER;
        if (data.column.index === 0) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = NAC_GOLD;
          const raw = String(data.cell.raw ?? "");
          if (!raw.includes("TOP")) {
            data.cell.text = [`♛ ${raw}`];
          }
        }
        if (data.column.index === 1) {
          data.cell.styles.fontStyle = "bold";
        }
      }
    },
  });
  return doc.lastAutoTable.finalY + 20;
}

function buildFooterRow(section) {
  const f = section.footer;
  if (!f) return null;
  if (section.id === "khobarGoogle") {
    return [
      "TOTAL",
      "All waiters",
      String(f.google_redirects ?? f.display_redirects),
      "100%",
      String(f.qr_scans ?? f.display_scans),
      f.display_efficiency || `${f.redirect_efficiency_pct}%`,
    ];
  }
  if (section.id === "waiterUpsell") {
    return ["TOTAL", "—", f.display_quantity, "—", f.display_net_sales, ""];
  }
  if (section.id === "waiterSales") {
    return ["TOTAL", "All waiters", f.display_net_sales, "100%", f.display_quantity, ""];
  }
  if (section.id === "bottomItems") {
    return ["—", "—", f.display_quantity, "—", f.display_net_sales];
  }
  return ["TOTAL", "—", f.display_quantity, f.display_contribution || "100%", f.display_net_sales];
}

function sectionTableConfig(section) {
  switch (section.id) {
    case "topItems":
      return {
        head: [["#", "Item", "Net Qty", "Share %", "Net Sales"]],
        body: (section.rows || []).map((r) => [
          r.rank,
          clip(r.item_name),
          r.display_quantity,
          r.display_contribution,
          r.display_net_sales,
        ]),
      };
    case "bottomItems":
      return {
        head: [["#", "Item", "Net Qty", "Operational label", "Net Sales"]],
        body: (section.rows || []).map((r) => [
          r.rank,
          clip(r.item_name),
          r.display_quantity,
          clip(r.action_label, 22),
          r.display_net_sales,
        ]),
      };
    case "waiterSales":
      return {
        head: [["#", "Waiter", "Net Sales", "Share %", "Units", "Role"]],
        body: (section.rows || []).map((r) => [
          r.rank,
          clip(r.waiter, 22),
          r.display_net_sales,
          r.display_contribution,
          r.display_quantity,
          clip(r.role, 10),
        ]),
      };
    case "waiterUpsell":
      return {
        head: [["#", "Waiter", "Upsell Qty", "Share %", "Upsell Net", "Role"]],
        body: (section.rows || []).map((r) => [
          r.rank,
          clip(r.waiter, 22),
          r.display_quantity,
          r.display_contribution,
          r.display_net_sales,
          clip(r.role, 10),
        ]),
      };
    case "khobarGoogle":
      return {
        head: [["#", "Waiter", "Google", "Share %", "QR Scans", "To Google %", "No redirect"]],
        body: (section.rows || []).map((r) => [
          r.rank,
          clip(r.waiter, 20),
          r.google_redirects,
          r.display_contribution,
          r.qr_scans,
          r.display_conversion,
          r.scans_without_redirect,
        ]),
        insights: section.insights,
      };
    default:
      return { head: [["—"]], body: [] };
  }
}

function drawSection(doc, { margin, contentW, y, index, section }) {
  const pageH = doc.internal.pageSize.getHeight();
  if (y > pageH - 120) {
    doc.addPage();
    fillPage(doc);
    y = margin + 16;
  }

  y = drawSectionDivider(doc, margin, y, contentW, section.title);
  setExportFont(doc, 600, 12);
  paintExportText(doc, `${index}. ${section.title}`, margin, y, { tier: "gold", shadow: true });
  y += 16;
  if (section.subtitle) {
    setExportFont(doc, 500, 7.5);
    const lines = doc.splitTextToSize(section.subtitle, contentW);
    lines.slice(0, 2).forEach((ln, i) => {
      paintExportText(doc, ln, margin, y + i * 10, { tier: "muted", shadow: false });
    });
    y += lines.length * 10 + 6;
  }

  const { head, body, insights } = sectionTableConfig(section);
  if (section.note && !body.length) {
    drawContentPanel(doc, margin, y, contentW, 30);
    setExportFont(doc, 500, 8);
    paintExportText(doc, section.note, margin + 8, y + 14, { tier: "muted", shadow: false });
    return y + 44;
  }
  if (section.note) {
    drawContentPanel(doc, margin, y, contentW, 26);
    setExportFont(doc, 500, 7);
    paintExportText(doc, section.note, margin + 8, y + 12, { tier: "muted", shadow: false });
    y += 34;
  }

  const foot = buildFooterRow(section);
  y = drawRankedTable(doc, {
    margin,
    contentW,
    startY: y,
    head,
    body,
    foot: foot ? [foot] : null,
  });

  if (insights && section.id === "khobarGoogle") {
    drawContentPanel(doc, margin, y - 8, contentW, 52);
    setExportFont(doc, 500, 7);
    const lines = [
      `Redirect efficiency: ${insights.redirect_efficiency_pct}%`,
      `Scans without redirect: ${insights.scans_without_redirect}`,
      insights.top_review_closer
        ? `Top review closer: ${insights.top_review_closer.waiter} (${insights.top_review_closer.google_redirects} redirects)`
        : null,
    ].filter(Boolean);
    lines.forEach((ln, i) => {
      paintExportText(doc, ln, margin + 8, y + 6 + i * 10, { tier: "secondary", shadow: false });
    });
    y += 56;
  }

  return y;
}

/**
 * @param {object} pkg — buildExecutiveUnifiedExportPackage output
 */
export function exportExecutiveUnifiedPdf(pkg) {
  if (!pkg) {
    if (typeof window !== "undefined") window.alert("No export data available.");
    return;
  }

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const margin = 44;
  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - margin * 2;

  drawExecutiveSummaryPage(doc, pkg, margin, contentW);

  const sectionOrder = [
    pkg.sections?.topItems || pkg.topItems,
    pkg.sections?.bottomItems || pkg.bottomItems,
    pkg.sections?.waiterSales || pkg.waiterSales,
    pkg.sections?.waiterUpsell || pkg.waiterUpsell,
    pkg.sections?.khobarGoogle || pkg.khobarGoogle,
  ].filter(Boolean);

  doc.addPage();
  fillPage(doc);
  drawExecutiveHeaderBar(doc, pageW);
  let y = margin + 20;

  setExportFont(doc, "bold", 16);
  paintExportText(doc, "Operational Detail", margin, y, { tier: "primary", shadow: true });
  y += 22;
  setExportFont(doc, 500, 8);
  paintExportText(doc, pkg.meta.dataSourceNote, margin, y, { tier: "muted", shadow: false });
  y += 20;

  sectionOrder.forEach((section, i) => {
    y = drawSection(doc, { margin, contentW, y, index: i + 1, section });
  });

  const filename = `${pkg.meta.filenameBase || "NAC-Executive-Report"}.pdf`;
  doc.save(filename);
}
