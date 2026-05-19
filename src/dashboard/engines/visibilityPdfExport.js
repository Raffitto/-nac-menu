import jsPDF from "jspdf";
import { businessDayExportNote } from "../utils/businessDay";
import { exportCell } from "../utils/intelligenceSanity";
import { buildExportCommentary } from "../utils/itemBehaviorEngine";
import {
  fillPage,
  newPage,
  drawPageTitle,
  drawKpiCard,
  drawHBar,
  drawInsightCard,
  NAC_TEAL,
  NAC_GOLD,
  NAC_WHITE,
  CARD_BG,
} from "./pdfVisualTheme";

const ROWS_PER_PAGE = 8;

function heatBarColor(pct) {
  if (pct >= 70) return [78, 205, 196];
  if (pct >= 40) return NAC_GOLD;
  if (pct >= 15) return [245, 166, 35];
  return [90, 90, 95];
}

function drawProductCard(doc, margin, y, w, item, maxOrders) {
  const orders = Number(item.orders) || 0;
  const impr = Number(item.impressions ?? item.item_impressions) || 0;
  const conv = item.impression_conversion_pct ?? item.menu_conversion_pct ?? item.conversion_rate ?? 0;
  const heat = item.heatIndex ?? item.attention_score ?? 0;
  const pct = maxOrders > 0 ? (orders / maxOrders) * 100 : 0;
  const h = 72;

  doc.setFillColor(...CARD_BG);
  doc.setDrawColor(...NAC_TEAL);
  doc.setLineWidth(0.35);
  doc.roundedRect(margin, y, w, h, 5, 5, "FD");

  doc.setFontSize(10);
  doc.setTextColor(...NAC_WHITE);
  const name = String(item.item_name || "—").slice(0, 42);
  doc.text(name, margin + 12, y + 18);

  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text(
    `${impr.toLocaleString()} impr · ${orders} orders · ${conv != null ? `${Number(conv).toFixed(1)}%` : "—"} conv`,
    margin + 12,
    y + 32,
  );

  doc.setFontSize(7);
  doc.setTextColor(...NAC_GOLD);
  doc.text(`Heat ${heat} · ${item.behavior_type || "—"}`, margin + 12, y + 44);

  drawHBar(doc, margin + 12, y + 52, w - 24, 8, pct, heatBarColor(Number(heat) || pct));

  return y + h + 10;
}

/**
 * Premium visibility PDF — cards, bars, branded headers (not raw tables).
 */
export function exportVisibilityPDF({
  briefing,
  intelligence,
  menuEngineering,
  kpis,
  forecasts,
  categoryGrades,
  searchIntel,
  cannibalization,
  exportMeta,
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const margin = 44;
  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - margin * 2;
  const funnels = intelligence?.funnels || [];
  const bizNote = intelligence?.businessDay?.note || businessDayExportNote();
  const reportTitle = exportMeta?.title || "NAC Visibility Intelligence";
  const grades = categoryGrades || intelligence?.categoryGrades || [];
  const search = searchIntel || intelligence?.search?.advanced;
  const cann = cannibalization || intelligence?.cannibalization;

  fillPage(doc);
  doc.setTextColor(...NAC_GOLD);
  doc.setFontSize(24);
  doc.text("NAC Menu OS", margin, 52);
  doc.setFontSize(13);
  doc.setTextColor(...NAC_WHITE);
  doc.text(reportTitle, margin, 76);
  doc.setFontSize(9);
  doc.setTextColor(130, 130, 130);
  doc.text(`Generated ${new Date().toLocaleString()}`, margin, 92);
  doc.text(bizNote, margin, 106);

  let y = 128;
  const kpiW = (contentW - 16) / 4;
  [
    ["Sessions", String(exportCell(kpis?.sessions))],
    ["Impressions", String(exportCell(kpis?.impressions))],
    ["Deep interest", String(exportCell(kpis?.modal_opens))],
    ["Bounce %", kpis?.bounce_pct != null ? `${kpis.bounce_pct}%` : "—"],
  ].forEach(([label, val], i) => {
    drawKpiCard(doc, margin + i * (kpiW + 5), y, kpiW, 50, label, val, i % 2 ? NAC_GOLD : NAC_TEAL);
  });
  y += 62;

  doc.setTextColor(...NAC_TEAL);
  doc.setFontSize(11);
  doc.text("Executive summary", margin, y);
  y += 16;
  const actions = briefing?.todayActions?.length
    ? briefing.todayActions
    : ["Continue monitoring — no urgent actions flagged."];
  actions.slice(0, 4).forEach((line) => {
    doc.setFontSize(9);
    doc.setTextColor(200, 200, 200);
    doc.splitTextToSize(`• ${line}`, contentW).forEach((ln) => {
      if (y > 720) y = newPage(doc, margin);
      doc.text(ln, margin, y);
      y += 12;
    });
  });
  y += 10;

  const ranked = [...funnels].sort((a, b) => (Number(b.orders) || 0) - (Number(a.orders) || 0));
  const maxOrders = Math.max(...ranked.map((f) => Number(f.orders) || 0), 1);

  if (ranked.length) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(
      doc,
      margin,
      "Visibility vs sales",
      `Top ${Math.min(ROWS_PER_PAGE, ranked.length)} items by orders · card view`,
    );

    ranked.slice(0, ROWS_PER_PAGE).forEach((item) => {
      if (y > 620) {
        doc.addPage();
        fillPage(doc);
        y = margin + 20;
      }
      y = drawProductCard(doc, margin, y, contentW, item, maxOrders);
      const cmt = buildExportCommentary(item);
      if (cmt && y < 700) {
        doc.setFontSize(7);
        doc.setTextColor(120, 120, 120);
        doc.splitTextToSize(cmt, contentW - 24).slice(0, 1).forEach((ln) => {
          doc.text(ln, margin + 12, y - 4);
        });
      }
    });

    if (ranked.length > ROWS_PER_PAGE) {
      doc.addPage();
      fillPage(doc);
      y = drawPageTitle(doc, margin, "Visibility vs sales (continued)", "Additional items");
      ranked.slice(ROWS_PER_PAGE, ROWS_PER_PAGE * 2).forEach((item) => {
        if (y > 620) {
          doc.addPage();
          fillPage(doc);
          y = margin + 20;
        }
        y = drawProductCard(doc, margin, y, contentW, item, maxOrders);
      });
    }
  }

  if (grades.length) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "Category grades", "Performance by menu category");
    grades.slice(0, 6).forEach((g) => {
      if (y > 700) y = newPage(doc, margin);
      y = drawInsightCard(doc, margin, y, {
        severity: g.grade === "A" ? "low" : g.grade === "D" ? "high" : "medium",
        category: `Grade ${g.grade}`,
        title: g.name,
        body: g.action || "Review category mix and pricing.",
      });
    });
  }

  if (search?.insights?.length) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "Search friction", "Guest findability signals");
    search.insights.slice(0, 4).forEach((i) => {
      if (y > 700) y = newPage(doc, margin);
      y = drawInsightCard(doc, margin, y, {
        severity: "medium",
        category: "Search",
        title: "Search insight",
        body: i.message,
      });
    });
  }

  if (forecasts?.narratives?.length) {
    if (y > 640) {
      doc.addPage();
      fillPage(doc);
      y = margin + 20;
    } else if (!search?.insights?.length) {
      doc.addPage();
      fillPage(doc);
      y = drawPageTitle(doc, margin, "Forecast signals", "");
    }
    doc.setTextColor(...NAC_GOLD);
    doc.setFontSize(10);
    doc.text("Forecast signals", margin, y);
    y += 14;
    forecasts.narratives.slice(0, 4).forEach((n) => {
      if (y > 700) y = newPage(doc, margin);
      y = drawInsightCard(doc, margin, y, {
        severity: "low",
        category: "Forecast",
        title: n.message?.slice(0, 60) || "Signal",
        body: `${n.message || ""} (${n.confidence || "signal"})`,
      });
    });
  }

  if (cann?.risks?.length) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "Cannibalization risks", "Items competing for attention");
    cann.risks.slice(0, 4).forEach((r) => {
      if (y > 700) y = newPage(doc, margin);
      y = drawInsightCard(doc, margin, y, {
        severity: "high",
        category: "Cannibalization",
        title: r.title,
        body: r.detail,
      });
    });
  }

  if (menuEngineering?.length) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "Menu engineering snapshot", "Quadrant highlights");
    const stars = menuEngineering.filter((m) => m.quadrant === "Star").slice(0, 4);
    const dogs = menuEngineering.filter((m) => m.quadrant === "Dog").slice(0, 3);
    stars.forEach((m) => {
      if (y > 700) y = newPage(doc, margin);
      y = drawInsightCard(doc, margin, y, {
        severity: "low",
        category: "Star",
        title: m.item_name,
        body: `${m.orders} orders · ${m.views} views`,
      });
    });
    dogs.forEach((m) => {
      if (y > 700) y = newPage(doc, margin);
      y = drawInsightCard(doc, margin, y, {
        severity: "high",
        category: "Dog",
        title: m.item_name,
        body: `${m.orders} orders · ${m.views} views — review placement`,
      });
    });
  }

  doc.save("nac-visibility-intelligence.pdf");
}
