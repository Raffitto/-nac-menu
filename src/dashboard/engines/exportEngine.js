import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { exportCSV } from "../utils/formatters";
import { exportCell, clampMetric } from "../utils/intelligenceSanity";
import { buildExportCommentary } from "../utils/itemBehaviorEngine";
import { businessDayExportNote } from "../utils/businessDay";

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

/** Premium multi-sheet XLSX — boardroom structure */
export function exportExecutiveXLSX({
  briefing,
  intelligence,
  menuEngineering,
  forecasts,
  kpis,
  categoryGrades,
  searchIntel,
  cannibalization,
}) {
  const wb = XLSX.utils.book_new();
  const generated = new Date().toLocaleString();
  const funnels = intelligence?.funnels || [];
  const bizNote = intelligence?.businessDay?.note || businessDayExportNote();

  const summaryRows = [
    ["NAC Menu OS — Operational Intelligence"],
    ["Generated", generated],
    ["Business day", bizNote],
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

  if (categoryGrades?.length || intelligence?.categoryGrades?.length) {
    const grades = categoryGrades || intelligence.categoryGrades;
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        grades.map((g) => ({
          Category: g.name,
          Grade: g.grade,
          Score: g.score,
          Reason: g.reason,
          "Strongest item": g.strongest_item,
          "Weakest item": g.weakest_item,
          Action: g.action,
          Confidence: g.confidence,
        })),
      ),
      "Category Grades",
    );
  }

  const search = searchIntel || intelligence?.search?.advanced;
  if (search) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { Metric: "Search friction score", Value: search.searchFrictionScore },
        { Metric: "Unmet demand score", Value: search.unmetDemandScore },
        ...search.topFailed.slice(0, 8).map((s) => ({ Type: "Failed", Query: s.query, Count: s.count })),
        ...search.topSuccessful.slice(0, 5).map((s) => ({ Type: "Success", Query: s.query, Count: s.count })),
      ]),
      "Search Intelligence",
    );
  }

  if (forecasts?.narratives?.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Forecast signals"],
        ...forecasts.narratives.map((n) => [n.message, n.confidence || ""]),
      ]),
      "Forecast",
    );
  }

  const cann = cannibalization || intelligence?.cannibalization;
  if (cann?.groups?.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        cann.groups.map((g) => ({
          Group: g.competing_group,
          Dominant: g.dominant_item,
          Weaker: g.weaker_item,
          Recommendation: g.recommendation,
          Confidence: g.confidence,
        })),
      ),
      "Cannibalization",
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

  if (funnels.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        funnels.map((f) => ({
          Item: f.item_name,
          Impressions: f.impressions ?? f.item_impressions,
          Opens: f.item_modal_opens ?? f.item_opens,
          Orders: f.orders,
          "Behavior Type": f.behavior_type,
          "Attention Score": f.attention_score,
          Note: buildExportCommentary(f),
        })),
      ),
      "Raw Data",
    );
  }

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    "nac-visibility-intelligence.xlsx",
  );
}

export function exportExecutivePDF({
  briefing,
  intelligence,
  menuEngineering,
  kpis,
  forecasts,
  categoryGrades,
  searchIntel,
  cannibalization,
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  let y = margin;
  const funnels = intelligence?.funnels || [];
  const bizNote = intelligence?.businessDay?.note || businessDayExportNote();
  const grades = categoryGrades || intelligence?.categoryGrades || [];
  const search = searchIntel || intelligence?.search?.advanced;
  const cann = cannibalization || intelligence?.cannibalization;

  doc.setFontSize(18);
  doc.setTextColor(40, 90, 85);
  doc.text("NAC Menu OS", margin, y);
  y += 22;
  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  doc.text("Operational Intelligence — Visibility vs Sales", margin, y);
  y += 14;
  doc.setFontSize(9);
  doc.text(`Generated ${new Date().toLocaleString()}`, margin, y);
  y += 12;
  doc.text(bizNote, margin, y);
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

  let tableStart = doc.lastAutoTable.finalY + 20;
  if (funnels.length) {
    doc.setFontSize(10);
    doc.text("Visibility vs Sales", margin, tableStart);
    tableStart += 12;
    autoTable(doc, {
      startY: tableStart,
      head: [["Item", "Impr.", "Orders", "Behavior", "Attention"]],
      body: funnels.slice(0, 12).map((f) => [
        exportCell(f.item_name),
        exportCell(f.impressions ?? f.item_impressions),
        exportCell(f.orders),
        exportCell(f.behavior_type),
        exportCell(f.attention_score),
      ]),
      styles: { fontSize: 7, cellPadding: 3 },
      headStyles: { fillColor: [45, 95, 90] },
      margin: { left: margin, right: margin },
    });
    const cmt = funnels[0] ? buildExportCommentary(funnels[0]) : "";
    if (cmt) {
      let cy = doc.lastAutoTable.finalY + 10;
      doc.setFontSize(8);
      doc.setTextColor(90, 90, 90);
      doc.splitTextToSize(cmt, 500).forEach((ln) => {
        doc.text(ln, margin, cy);
        cy += 10;
      });
    }
  }

  if (grades.length) {
    let gy = doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 24 : y + 200;
    if (gy > 700) { doc.addPage(); gy = margin; }
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    doc.text("Category Grades", margin, gy);
    autoTable(doc, {
      startY: gy + 10,
      head: [["Category", "Grade", "Action"]],
      body: grades.slice(0, 8).map((g) => [g.name, g.grade, g.action]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [215, 188, 138] },
      margin: { left: margin, right: margin },
    });
  }

  if (search?.insights?.length) {
    let sy = doc.lastAutoTable.finalY + 16;
    if (sy > 720) { doc.addPage(); sy = margin; }
    doc.text("Search Friction", margin, sy);
    sy += 12;
    search.insights.slice(0, 3).forEach((i) => {
      doc.setFontSize(8);
      doc.splitTextToSize(`• ${i.message}`, 500).forEach((ln) => {
        doc.text(ln, margin, sy);
        sy += 10;
      });
    });
  }

  if (forecasts?.narratives?.length) {
    let fy = (doc.lastAutoTable?.finalY || y) + 16;
    if (fy > 720) { doc.addPage(); fy = margin; }
    doc.setFontSize(10);
    doc.text("Forecast Signals", margin, fy);
    fy += 12;
    forecasts.narratives.slice(0, 4).forEach((n) => {
      doc.setFontSize(8);
      doc.splitTextToSize(`• ${n.message} (${n.confidence || "signal"})`, 500).forEach((ln) => {
        doc.text(ln, margin, fy);
        fy += 10;
      });
    });
  }

  if (cann?.risks?.length) {
    let cy = doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 16 : margin + 400;
    if (cy > 720) { doc.addPage(); cy = margin; }
    doc.setFontSize(10);
    doc.text("Cannibalization Risks", margin, cy);
    cy += 12;
    cann.risks.slice(0, 3).forEach((r) => {
      doc.setFontSize(8);
      doc.splitTextToSize(`• ${r.title}: ${r.detail}`, 500).forEach((ln) => {
        doc.text(ln, margin, cy);
        cy += 10;
      });
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

/** Unified review + branch + employee export */
export function exportUnifiedIntelligenceXLSX({
  review,
  unified,
  comparison = [],
  employees = [],
  diagnostics,
}) {
  const wb = XLSX.utils.book_new();
  const generated = new Date().toLocaleString();

  const summary = [
    ["NAC Unified Restaurant Intelligence"],
    ["Generated", generated],
    ["Business day", unified?.business_day_key || ""],
    [],
    ["Review KPIs", "Value"],
    ["Reviews generated", review?.reviews_generated ?? 0],
    ["Google clicks", review?.google_clicks ?? 0],
    ["Review conversion %", review?.conversion_pct ?? 0],
    ["Menu sessions", unified?.sessions ?? 0],
    ["Impressions", unified?.impressions ?? 0],
    ["Sales (Foodics)", unified?.sales ?? 0],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");

  if (employees.length) {
    const empSheet = employees.map((e) => ({
      Employee: e.name,
      Role: e.role,
      Classification: e.classification?.label,
      Reviews: e.metrics.reviews_generated,
      "Google %": e.metrics.review_conversion_pct,
      Confidence: e.metrics.confidence,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(empSheet), "Employees");
  }

  if (comparison.length) {
    const branchSheet = comparison.map((b) => ({
      Branch: b.branch_id,
      Sessions: b.sessions,
      "Visual conv %": b.visual_conversion_pct,
      Reviews: b.reviews,
      Sales: b.sales,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(branchSheet), "Branches");
  }

  const commentary = [
    ["Executive commentary"],
    [
      review?.conversion_pct < 20 && review?.reviews_generated > 5
        ? "Review generation is healthy but Google click-through needs stronger post-copy CTAs."
        : "Review funnel metrics within expected range for current sample.",
    ],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(commentary), "Commentary");

  if (diagnostics?.issues?.length) {
    const dq = diagnostics.issues.map((i) => ({ Code: i.code, Message: i.message, Severity: i.severity }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dq), "Diagnostics");
  }

  XLSX.writeFile(wb, "nac-unified-intelligence.xlsx");
}
