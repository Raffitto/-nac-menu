import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { exportCSV } from "../utils/formatters";
import { exportCell, clampMetric } from "../utils/intelligenceSanity";

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
  const pct = clampMetric(f.conversion_pct ?? f.menu_conversion_pct, 0, 100);
  return pct > 0 ? `${pct}%` : "—";
}

/** Premium multi-sheet XLSX executive export */
export function exportExecutiveXLSX({ briefing, intelligence, menuEngineering, forecasts, kpis }) {
  const wb = XLSX.utils.book_new();
  const generated = new Date().toLocaleString();

  const summaryRows = [
    ["NAC Menu OS — Executive Intelligence Report"],
    ["Generated", generated],
    [],
    ["Executive Summary"],
    ...(briefing?.todayActions?.length
      ? briefing.todayActions.map((a) => ["Action", a])
      : [["Action", "No urgent actions flagged — monitoring recommended."]]),
    ["Strongest", exportCell((briefing?.strongest || []).join(", "))],
    ["Risks", exportCell((briefing?.risks || []).join(", "))],
    ["Focus", exportCell(briefing?.focus)],
    [],
    ["KPIs", "Value"],
    ["Sessions", exportCell(kpis?.sessions)],
    ["QR Scans", exportCell(kpis?.qr)],
    ["Bounce %", kpis?.bounce_pct != null ? `${kpis.bounce_pct}%` : "—"],
    ["Menu Events", exportCell(kpis?.events)],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Summary");

  const commentary = [
    ["AI Commentary"],
    [exportCell(forecasts?.narratives?.[0]?.message, "Trend data will populate as more sessions are collected.")],
    [exportCell(briefing?.changed, "—")],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(commentary), "Commentary");

  if (intelligence?.funnels?.length) {
    const funnelSheet = intelligence.funnels.map((f) => ({
      Item: exportCell(f.item_name),
      Views: exportCell(f.item_opens),
      Orders: exportCell(f.orders),
      "Menu Conv %": formatConvExport(f),
      "Offline %": f.offline_ratio_pct != null ? `${f.offline_ratio_pct}%` : "—",
      "Revenue/View": exportCell(f.revenue_per_view),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(funnelSheet), "Item Funnel");
  } else {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["No funnel data", "Import Foodics sales or collect more menu sessions."]]),
      "Item Funnel",
    );
  }

  if (menuEngineering?.length) {
    const meSheet = menuEngineering.map((m) => ({
      Item: exportCell(m.item_name),
      Quadrant: exportCell(m.quadrant),
      Views: exportCell(m.views),
      Orders: exportCell(m.orders),
      Suggestion: exportCell(m.suggestion),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meSheet), "Menu Engineering");
  }

  if (intelligence?.categoryHealth?.length) {
    const catSheet = intelligence.categoryHealth.map((c) => ({
      Category: exportCell(c.category_name),
      Opens: exportCell(c.opens),
      Engagement: c.engagement_pct != null ? `${c.engagement_pct}%` : "—",
      Grade: exportCell(c.grade),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(catSheet), "Categories");
  }

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    "nac-executive-intelligence.xlsx",
  );
}

/** PDF with summary + tables */
export function exportExecutivePDF({ briefing, intelligence, menuEngineering, kpis }) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  let y = margin;

  doc.setFontSize(18);
  doc.setTextColor(40, 90, 85);
  doc.text("NAC Menu OS", margin, y);
  y += 22;
  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  doc.text("Restaurant Intelligence Report", margin, y);
  y += 14;
  doc.setFontSize(9);
  doc.text(`Generated ${new Date().toLocaleString()}`, margin, y);
  y += 24;

  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text("Executive Summary", margin, y);
  y += 16;
  const actions = briefing?.todayActions?.length ? briefing.todayActions : ["No urgent actions — continue monitoring."];
  actions.slice(0, 4).forEach((line) => {
    const lines = doc.splitTextToSize(`• ${line}`, 500);
    lines.forEach((ln) => {
      doc.text(ln, margin, y);
      y += 13;
    });
  });
  y += 8;

  autoTable(doc, {
    startY: y,
    head: [["Metric", "Value"]],
    body: [
      ["Sessions", String(exportCell(kpis?.sessions))],
      ["QR Scans", String(exportCell(kpis?.qr))],
      ["Bounce %", kpis?.bounce_pct != null ? `${kpis.bounce_pct}%` : "—"],
      ["Menu Events", String(exportCell(kpis?.events))],
    ],
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [45, 95, 90] },
    margin: { left: margin, right: margin },
  });

  if (menuEngineering?.length) {
    const tableY = doc.lastAutoTable.finalY + 24;
    if (tableY > 700) {
      doc.addPage();
    }
    autoTable(doc, {
      startY: tableY > 700 ? margin : tableY,
      head: [["Item", "Quadrant", "Views", "Orders"]],
      body: menuEngineering.slice(0, 18).map((m) => [
        exportCell(m.item_name),
        exportCell(m.quadrant),
        exportCell(m.views),
        exportCell(m.orders),
      ]),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [45, 95, 90] },
      margin: { left: margin, right: margin },
    });
  } else if (intelligence?.funnels?.length) {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 24,
      head: [["Item", "Views", "Orders", "Menu Conv"]],
      body: intelligence.funnels.slice(0, 12).map((f) => [
        exportCell(f.item_name),
        exportCell(f.item_opens),
        exportCell(f.orders),
        formatConvExport(f),
      ]),
      styles: { fontSize: 8 },
      margin: { left: margin, right: margin },
    });
  }

  doc.save("nac-executive-intelligence.pdf");
}

export function exportIntelligenceCSV(intelligence) {
  const headers = ["Item", "Views", "Orders", "Menu conversion", "Offline ratio", "Revenue per view"];
  const rows = (intelligence?.funnels || []).map((f) => [
    f.item_name,
    f.item_opens,
    f.orders,
    formatConvExport(f),
    f.offline_ratio_pct != null ? `${f.offline_ratio_pct}%` : "",
    f.revenue_per_view ?? "",
  ]);
  if (!rows.length) {
    exportCSV("nac-intelligence-export.csv", ["Note"], [["No funnel data available"]]);
    return;
  }
  exportCSV("nac-intelligence-export.csv", headers, rows);
}
