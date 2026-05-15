import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { exportCSV } from "../utils/formatters";
import { exportCell, clampMetric } from "../utils/intelligenceSanity";
import { buildExportCommentary } from "../utils/itemBehaviorEngine";

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatConvExport(f) {
  if (f.trust_label && f.offline_driven) return f.trust_label;
  const pct = clampMetric(f.conversion_pct ?? f.impression_conversion_pct ?? f.menu_conversion_pct, 0, 100);
  return pct > 0 ? `${pct}%` : "—";
}

/** Premium multi-sheet XLSX — Visibility vs Sales */
export function exportExecutiveXLSX({ briefing, intelligence, menuEngineering, forecasts, kpis }) {
  const wb = XLSX.utils.book_new();
  const generated = new Date().toLocaleString();
  const funnels = intelligence?.funnels || [];

  const summaryRows = [
    ["NAC Menu OS — Guest Attention vs Orders"],
    ["Generated", generated],
    [],
    ["Management Brief"],
    ["What is working", exportCell((briefing?.strongest || []).join("; "))],
    ["Needs attention", exportCell((briefing?.weakest || []).join("; "))],
    ["Do today", exportCell((briefing?.todayActions || []).join("; "))],
    ["Monitor next", exportCell(briefing?.monitor?.join?.("; ") || briefing?.focus)],
    [],
    ["KPIs", "Value"],
    ["Sessions", exportCell(kpis?.sessions)],
    ["Impressions", exportCell(kpis?.impressions)],
    ["Deep interest (opens)", exportCell(kpis?.modal_opens)],
    ["QR Scans", exportCell(kpis?.qr)],
    ["Bounce %", kpis?.bounce_pct != null ? `${kpis.bounce_pct}%` : "—"],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Summary");

  const commentaryRows = [["AI Commentary", ""]];
  (forecasts?.narratives || []).slice(0, 3).forEach((n) => {
    commentaryRows.push([exportCell(n.message)]);
  });
  funnels.slice(0, 5).forEach((f) => {
    const note = buildExportCommentary(f);
    if (note) commentaryRows.push([f.item_name, note]);
  });
  if (commentaryRows.length === 1) {
    commentaryRows.push(["Visibility and sales patterns will sharpen as more guest sessions are collected."]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(commentaryRows), "AI Commentary");

  if (funnels.length) {
    const visibilitySheet = funnels.map((f) => ({
      Item: exportCell(f.item_name),
      Impressions: exportCell(f.impressions ?? f.item_impressions),
      "Deep Interest": exportCell(f.item_modal_opens ?? f.item_opens),
      "Open Rate %": f.modal_open_rate != null ? `${f.modal_open_rate}%` : "—",
      Orders: exportCell(f.orders),
      "Impression Conv %": formatConvExport(f),
      "Visual Efficiency": f.visual_efficiency_score ?? "—",
      "Behavior Type": exportCell(f.behavior_type),
      Confidence: exportCell(f.signal_strength || f.confidence_combined),
      "Attention Score": exportCell(f.attention_score),
      "Revenue/Impression": exportCell(f.revenue_per_view),
      Note: buildExportCommentary(f),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(visibilitySheet), "Visibility vs Sales");
  } else {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["No visibility data", "Collect guest impressions or import Foodics sales."]]),
      "Visibility vs Sales",
    );
  }

  if (menuEngineering?.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        menuEngineering.map((m) => ({
          Item: exportCell(m.item_name),
          Quadrant: exportCell(m.quadrant),
          Impressions: exportCell(m.views),
          Orders: exportCell(m.orders),
          Suggestion: exportCell(m.suggestion),
        })),
      ),
      "Menu Engineering",
    );
  }

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    "nac-visibility-intelligence.xlsx",
  );
}

export function exportExecutivePDF({ briefing, intelligence, menuEngineering, kpis }) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  let y = margin;
  const funnels = intelligence?.funnels || [];

  doc.setFontSize(18);
  doc.setTextColor(40, 90, 85);
  doc.text("NAC Menu OS", margin, y);
  y += 22;
  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  doc.text("Guest Attention vs Orders", margin, y);
  y += 14;
  doc.setFontSize(9);
  doc.text(`Generated ${new Date().toLocaleString()}`, margin, y);
  y += 22;

  doc.setFontSize(10);
  doc.text("Executive Summary", margin, y);
  y += 14;
  const actions = briefing?.todayActions?.length ? briefing.todayActions : ["Continue monitoring — no urgent actions flagged."];
  actions.slice(0, 4).forEach((line) => {
    doc.splitTextToSize(`• ${line}`, 500).forEach((ln) => {
      doc.text(ln, margin, y);
      y += 13;
    });
  });
  const note = funnels[0] ? buildExportCommentary(funnels[0]) : null;
  if (note) {
    y += 6;
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.splitTextToSize(`Note: ${note}`, 500).forEach((ln) => {
      doc.text(ln, margin, y);
      y += 12;
    });
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(10);
  }
  y += 8;

  autoTable(doc, {
    startY: y,
    head: [["Metric", "Value"]],
    body: [
      ["Sessions", String(exportCell(kpis?.sessions))],
      ["Impressions", String(exportCell(kpis?.impressions))],
      ["Deep interest", String(exportCell(kpis?.modal_opens))],
      ["Bounce %", kpis?.bounce_pct != null ? `${kpis.bounce_pct}%` : "—"],
    ],
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [45, 95, 90] },
    margin: { left: margin, right: margin },
  });

  const tableStart = doc.lastAutoTable.finalY + 24;
  if (funnels.length) {
    autoTable(doc, {
      startY: tableStart > 680 ? margin : tableStart,
      head: [["Item", "Impr.", "Orders", "Behavior", "Visual Eff."]],
      body: funnels.slice(0, 14).map((f) => [
        exportCell(f.item_name),
        exportCell(f.impressions ?? f.item_impressions),
        exportCell(f.orders),
        exportCell(f.behavior_type),
        f.visual_efficiency_score != null ? String(f.visual_efficiency_score) : "—",
      ]),
      styles: { fontSize: 7, cellPadding: 3 },
      headStyles: { fillColor: [45, 95, 90] },
      margin: { left: margin, right: margin },
    });
  }

  doc.save("nac-visibility-intelligence.pdf");
}

export function exportIntelligenceCSV(intelligence) {
  const headers = [
    "Item",
    "Impressions",
    "Deep interest",
    "Open rate",
    "Orders",
    "Impression conversion",
    "Visual efficiency",
    "Behavior type",
    "Confidence",
    "AI note",
  ];
  const rows = (intelligence?.funnels || []).map((f) => [
    f.item_name,
    f.impressions ?? f.item_impressions ?? "",
    f.item_modal_opens ?? f.item_opens ?? "",
    f.modal_open_rate != null ? `${f.modal_open_rate}%` : "",
    f.orders,
    formatConvExport(f),
    f.visual_efficiency_score ?? "",
    f.behavior_type ?? "",
    f.signal_strength ?? "",
    buildExportCommentary(f),
  ]);
  if (!rows.length) {
    exportCSV("nac-visibility-export.csv", ["Note"], [["Visibility data not available yet."]]);
    return;
  }
  exportCSV("nac-visibility-export.csv", headers, rows);
}
