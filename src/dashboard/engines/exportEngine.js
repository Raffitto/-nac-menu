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
  exportMeta,
}) {
  const wb = XLSX.utils.book_new();
  const generated = new Date().toLocaleString();
  const funnels = intelligence?.funnels || [];
  const bizNote = intelligence?.businessDay?.note || businessDayExportNote();
  const reportTitle = exportMeta?.title || "NAC Menu OS — Operational Intelligence";

  const summaryRows = [
    [reportTitle],
    ["Generated", generated],
    ["Period", exportMeta?.period || bizNote],
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
  exportMeta,
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  let y = margin;
  const funnels = intelligence?.funnels || [];
  const bizNote = intelligence?.businessDay?.note || businessDayExportNote();
  const reportTitle = exportMeta?.title || "NAC Visibility Intelligence";
  const grades = categoryGrades || intelligence?.categoryGrades || [];
  const search = searchIntel || intelligence?.search?.advanced;
  const cann = cannibalization || intelligence?.cannibalization;

  doc.setFontSize(18);
  doc.setTextColor(40, 90, 85);
  doc.text("NAC Menu OS", margin, y);
  y += 22;
  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  doc.text(reportTitle, margin, y);
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

const EXPORT_GOLD = [215, 188, 138];
const EXPORT_TEAL = [78, 205, 196];

function fallbackRow(msg = "Not enough data for this section yet.") {
  return [[msg]];
}

function buildReviewCommentary(review, staffStats) {
  const lines = [];
  const conv = review?.conversion_pct ?? 0;
  const gen = review?.reviews_generated ?? 0;
  if (gen > 5 && conv < 20) {
    lines.push("Review generation is healthy but Google click-through needs a stronger post-copy CTA.");
  } else if (gen > 0) {
    lines.push("Review funnel metrics are within expected range for the selected period.");
  }
  const top = staffStats?.[0];
  if (top?.name && top.generated >= 3) {
    lines.push(`${top.name} leads staff volume with ${top.generated} reviews and ${top.conversion_pct}% Google conversion.`);
  }
  if (!lines.length) lines.push("Collect more tagged review sessions to unlock executive commentary.");
  return lines;
}

function drawBarChart(doc, startX, startY, items, { labelKey, valueKey, barColor, maxBarW = 120 }) {
  const max = Math.max(...items.map((i) => Number(i[valueKey]) || 0), 1);
  let y = startY;
  items.slice(0, 8).forEach((item) => {
    const label = String(item[labelKey] || "").slice(0, 18);
    const val = Number(item[valueKey]) || 0;
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    doc.text(label, startX, y);
    const barW = (val / max) * maxBarW;
    doc.setFillColor(...barColor);
    doc.rect(startX + 72, y - 3.5, Math.max(barW, val > 0 ? 2 : 0), 5, "F");
    doc.text(String(val), startX + 72 + maxBarW + 6, y);
    y += 11;
  });
  return y + 4;
}

/** Context-aware Review Intelligence export (branch + range from current view) */
export function exportReviewIntelligenceReport({
  branch,
  selectedRange,
  rangeLabel,
  review,
  unified,
  comparison = [],
  staffStats = [],
  employees = [],
  diagnostics,
  format = "xlsx",
}) {
  const title = `Review Intelligence — ${branch} — ${rangeLabel}`;
  const generated = new Date().toLocaleString();
  const commentary = buildReviewCommentary(review, staffStats);
  const showComparison = comparison.length > 0;
  const branchRow = comparison.find((b) => b.branch_id === branch.toLowerCase());

  if (format === "pdf") {
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const margin = 48;
    let y = margin;

    doc.setFontSize(18);
    doc.setTextColor(30, 30, 30);
    doc.text(title, margin, y);
    y += 22;
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated ${generated} · NAC business day logic (Asia/Riyadh)`, margin, y);
    y += 24;

    doc.setFontSize(11);
    doc.setTextColor(40, 40, 40);
    doc.text("Key metrics", margin, y);
    y += 14;
    autoTable(doc, {
      startY: y,
      head: [["Metric", "Value"]],
      body: [
        ["Reviews generated", String(review?.reviews_generated ?? 0)],
        ["Google clicks", String(review?.google_clicks ?? 0)],
        ["Review conversion %", `${review?.conversion_pct ?? 0}%`],
        ["Menu sessions", String(unified?.sessions ?? 0)],
      ],
      styles: { fontSize: 9 },
      headStyles: { fillColor: EXPORT_GOLD },
      margin: { left: margin, right: margin },
    });
    y = doc.lastAutoTable.finalY + 18;

    if (staffStats.length) {
      doc.text("Staff performance", margin, y);
      y += 12;
      autoTable(doc, {
        startY: y,
        head: [["Staff", "Role", "Scans", "Generated", "Copy", "Google", "Conv %"]],
        body: staffStats.map((s) => [
          s.name,
          s.role || "—",
          s.opens,
          s.generated,
          s.copy,
          s.google,
          `${s.conversion_pct}%`,
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: EXPORT_TEAL },
        margin: { left: margin, right: margin },
      });
      y = doc.lastAutoTable.finalY + 16;

      if (y > 620) {
        doc.addPage();
        y = margin;
      }
      doc.setFontSize(10);
      doc.text("Scans by staff", margin, y);
      y = drawBarChart(doc, margin, y + 10, staffStats, {
        labelKey: "name",
        valueKey: "opens",
        barColor: EXPORT_TEAL,
      });
      doc.text("Google clicks by staff", margin, y);
      y = drawBarChart(doc, margin, y + 10, staffStats, {
        labelKey: "name",
        valueKey: "google",
        barColor: EXPORT_GOLD,
      });
    } else {
      doc.setFontSize(9);
      doc.text("Not enough staff-tagged data for charts yet.", margin, y);
      y += 20;
    }

    if (showComparison) {
      if (y > 640) {
        doc.addPage();
        y = margin;
      }
      doc.setFontSize(10);
      doc.text("Cross-branch benchmark", margin, y);
      y += 10;
      autoTable(doc, {
        startY: y,
        head: [["Branch", "Sessions", "Visual %", "Reviews", "Sales"]],
        body: comparison.map((b) => [
          b.branch_id,
          b.sessions,
          `${b.visual_conversion_pct}%`,
          b.reviews,
          b.sales ? Number(b.sales).toLocaleString() : "—",
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [120, 120, 120] },
        margin: { left: margin, right: margin },
      });
      y = doc.lastAutoTable.finalY + 14;
    }

    doc.setFontSize(10);
    doc.text("Executive commentary", margin, y);
    y += 12;
    commentary.forEach((line) => {
      doc.setFontSize(9);
      doc.splitTextToSize(`• ${line}`, 500).forEach((ln) => {
        if (y > 750) {
          doc.addPage();
          y = margin;
        }
        doc.text(ln, margin, y);
        y += 11;
      });
    });

    const safeBranch = branch.replace(/\s+/g, "-").toLowerCase();
    doc.save(`nac-review-intelligence-${safeBranch}-${selectedRange}.pdf`);
    return;
  }

  const wb = XLSX.utils.book_new();
  const summary = [
    [title],
    ["Generated", generated],
    ["Branch", branch],
    ["Period", rangeLabel],
    [],
    ["Metric", "Value"],
    ["Reviews generated", review?.reviews_generated ?? 0],
    ["Google clicks", review?.google_clicks ?? 0],
    ["Review conversion %", review?.conversion_pct ?? 0],
    ["Menu sessions", unified?.sessions ?? 0],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");

  if (staffStats.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        staffStats.map((s) => ({
          Staff: s.name,
          Role: s.role,
          Branch: branch,
          "Page opens": s.opens,
          "Reviews generated": s.generated,
          "Copy events": s.copy,
          "Google clicks": s.google,
          "Conversion %": s.conversion_pct,
        }))
      ),
      "Staff"
    );
  } else {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fallbackRow()), "Staff");
  }

  if (employees.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        employees.map((e) => ({
          Employee: e.name,
          Classification: e.classification?.label,
          "Reviews generated": e.metrics?.reviews_generated,
          "Google %": e.metrics?.review_conversion_pct,
          Confidence: e.metrics?.confidence,
        }))
      ),
      "Classifications"
    );
  }

  if (showComparison) {
    const rows = comparison.map((b) => ({
      Branch: b.branch_id,
      "This branch": b.branch_id === branch.toLowerCase() ? "Yes" : "",
      Sessions: b.sessions,
      "Visual conv %": b.visual_conversion_pct,
      Reviews: b.reviews,
      Sales: b.sales,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Branch benchmark");
  }

  if (branchRow) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        [`${branch} focus`],
        ["Sessions", branchRow.sessions],
        ["Reviews", branchRow.reviews],
        ["Visual conversion %", branchRow.visual_conversion_pct],
      ]),
      branch
    );
  }

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["Commentary"], ...commentary.map((c) => [c])]),
    "Commentary"
  );

  if (diagnostics?.issues?.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        diagnostics.issues.map((i) => ({
          Code: i.code,
          Message: i.message,
          Severity: i.severity,
        }))
      ),
      "Data quality"
    );
  } else {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fallbackRow()), "Data quality");
  }

  const safeBranch = branch.replace(/\s+/g, "-").toLowerCase();
  XLSX.writeFile(wb, `nac-review-intelligence-${safeBranch}-${selectedRange}.xlsx`);
}

/** @deprecated use exportReviewIntelligenceReport */
export function exportUnifiedIntelligenceXLSX(ctx) {
  exportReviewIntelligenceReport({ ...ctx, format: "xlsx" });
}

/** Visual Intelligence OS — executive PDF (dark luxury styling via teal/gold accents) */
export function exportVisualIntelligencePDF({
  attachment,
  timeShift,
  heat,
  menuEngineering,
  waiters,
  insights,
  kpis,
  exportMeta,
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  let y = margin;
  const title = exportMeta?.title || "NAC Visual Intelligence";

  doc.setFillColor(12, 12, 14);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight(), "F");
  doc.setTextColor(215, 188, 138);
  doc.setFontSize(20);
  doc.text("NAC Hospitality OS", margin, y);
  y += 24;
  doc.setTextColor(249, 249, 247);
  doc.setFontSize(12);
  doc.text(title, margin, y);
  y += 14;
  doc.setFontSize(9);
  doc.setTextColor(160, 160, 160);
  doc.text(`Generated ${new Date().toLocaleString()} · ${businessDayExportNote()}`, margin, y);
  y += 22;

  doc.setTextColor(78, 205, 196);
  doc.setFontSize(11);
  doc.text("Executive Summary", margin, y);
  y += 14;
  doc.setTextColor(220, 220, 220);
  doc.setFontSize(9);
  (insights || []).slice(0, 5).forEach((ins) => {
    doc.splitTextToSize(`• ${ins.title}: ${ins.body}`, 500).forEach((ln) => {
      if (y > 720) {
        doc.addPage();
        doc.setFillColor(12, 12, 14);
        doc.rect(0, 0, doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight(), "F");
        y = margin;
      }
      doc.text(ln, margin, y);
      y += 11;
    });
  });
  y += 8;

  autoTable(doc, {
    startY: y,
    head: [["KPI", "Value"]],
    body: [
      ["Modifier revenue", `${Math.round(attachment?.totals?.modifierRevenue || 0).toLocaleString()} SAR`],
      ["Parent orders", String(attachment?.totals?.parentOrders || 0)],
      ["Missed upsell signals", String(attachment?.missedUpsells?.length || 0)],
      ["Sessions", String(kpis?.sessions || "—")],
    ],
    styles: { fontSize: 9, textColor: [240, 240, 240], fillColor: [20, 20, 22] },
    headStyles: { fillColor: [45, 95, 90], textColor: [255, 255, 255] },
    margin: { left: margin, right: margin },
  });

  let ty = doc.lastAutoTable.finalY + 18;
  if ((attachment?.missedUpsells || []).length) {
    doc.setTextColor(245, 166, 35);
    doc.setFontSize(10);
    doc.text("Missed Upsells", margin, ty);
    ty += 10;
    autoTable(doc, {
      startY: ty,
      head: [["Pair", "Attach %", "Expected", "Est. gap SAR"]],
      body: attachment.missedUpsells.slice(0, 8).map((m) => [
        m.label,
        `${m.attachmentRate}%`,
        `${m.expectedPct}%`,
        String(m.estimatedLostRevenue),
      ]),
      styles: { fontSize: 8, textColor: [230, 230, 230], fillColor: [24, 24, 26] },
      headStyles: { fillColor: [120, 60, 40], textColor: [255, 255, 255] },
      margin: { left: margin, right: margin },
    });
  }

  if ((attachment?.topAttachments || []).length) {
    let ay = doc.lastAutoTable.finalY + 18;
    if (ay > 680) {
      doc.addPage();
      ay = margin;
    }
    doc.setTextColor(78, 205, 196);
    doc.text("Top Attachments", margin, ay);
    ay += 10;
    autoTable(doc, {
      startY: ay,
      head: [["Pair", "Rate", "Revenue"]],
      body: attachment.topAttachments.map((p) => [
        p.label,
        `${p.attachmentRate}%`,
        `${Math.round(p.attachmentRevenue).toLocaleString()} SAR`,
      ]),
      styles: { fontSize: 8, textColor: [230, 230, 230], fillColor: [24, 24, 26] },
      headStyles: { fillColor: EXPORT_TEAL },
      margin: { left: margin, right: margin },
    });
  }

  if ((menuEngineering || []).length) {
    let my = doc.lastAutoTable.finalY + 18;
    if (my > 680) {
      doc.addPage();
      my = margin;
    }
    doc.setTextColor(215, 188, 138);
    doc.text("Menu Engineering", margin, my);
    autoTable(doc, {
      startY: my + 10,
      head: [["Item", "Quadrant", "Views", "Orders"]],
      body: menuEngineering.slice(0, 12).map((m) => [
        exportCell(m.item_name),
        m.quadrant,
        String(m.views),
        String(m.orders),
      ]),
      styles: { fontSize: 8, textColor: [230, 230, 230], fillColor: [24, 24, 26] },
      headStyles: { fillColor: EXPORT_GOLD, textColor: [30, 30, 30] },
      margin: { left: margin, right: margin },
    });
  }

  if (timeShift?.peakDaypart) {
    let py = doc.lastAutoTable.finalY + 14;
    doc.setFontSize(9);
    doc.setTextColor(180, 180, 180);
    doc.text(`Peak daypart: ${timeShift.peakDaypart.label}`, margin, py);
  }

  if ((heat?.hotNow || []).length) {
    let hy = doc.lastAutoTable.finalY + 20;
    if (hy > 700) {
      doc.addPage();
      hy = margin;
    }
    doc.setTextColor(78, 205, 196);
    doc.text("Heat Index — Hot Now", margin, hy);
    hy = drawBarChart(
      doc,
      margin,
      hy + 10,
      heat.hotNow.map((h) => ({ item_name: h.item_name, heatIndex: h.heatIndex })),
      { labelKey: "item_name", valueKey: "heatIndex", barColor: EXPORT_TEAL },
    );
  }

  if (waiters?.topUpseller) {
    let wy = doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 16 : margin + 400;
    if (wy > 700) {
      doc.addPage();
      wy = margin;
    }
    doc.setTextColor(215, 188, 138);
    doc.text(`Top upseller: ${waiters.topUpseller.waiter} — ${waiters.topUpseller.net_sales.toLocaleString()} SAR`, margin, wy);
  }

  doc.save("nac-visual-intelligence.pdf");
}

/** Visual Intelligence OS — boardroom XLSX */
export function exportVisualIntelligenceXLSX({
  attachment,
  timeShift,
  heat,
  menuEngineering,
  waiters,
  insights,
  kpis,
  exportMeta,
}) {
  const wb = XLSX.utils.book_new();
  const generated = new Date().toLocaleString();
  const title = exportMeta?.title || "NAC Visual Intelligence";

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      [title],
      ["Generated", generated],
      ["Period", exportMeta?.period || businessDayExportNote()],
      [],
      ["KPI", "Value"],
      ["Modifier revenue", attachment?.totals?.modifierRevenue || 0],
      ["Parent orders", attachment?.totals?.parentOrders || 0],
      ["Missed upsells", attachment?.missedUpsells?.length || 0],
      ["Sessions", kpis?.sessions || "—"],
    ]),
    "Executive Summary",
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["AI Operational Insights"],
      ...(insights || []).map((i) => [i.title, i.body, i.confidence, i.type]),
    ]),
    "AI Insights",
  );

  if (attachment?.pairs?.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        attachment.pairs.map((p) => ({
          Pair: p.label,
          "Parent orders": p.parentOrders,
          "Attached orders": p.attachedOrders,
          "Attachment %": p.attachmentRate,
          Expected: p.expectedPct,
          "Est. gap SAR": p.estimatedLostRevenue,
          Status: p.underperforming ? "Underperforming" : "OK",
        })),
      ),
      "Attachment",
    );
  }

  if (attachment?.missedUpsells?.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        attachment.missedUpsells.map((m) => ({
          Pair: m.label,
          "Opportunity score": m.opportunityScore,
          "Attachment %": m.attachmentRate,
          Expected: m.expectedPct,
          "Est. gap SAR": m.estimatedLostRevenue,
        })),
      ),
      "Missed Upsells",
    );
  }

  if (menuEngineering?.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        menuEngineering.map((m) => ({
          Item: m.item_name,
          Quadrant: m.quadrant,
          Popularity: m.popularity,
          Profitability: m.profitability,
          Views: m.views,
          Orders: m.orders,
          Suggestion: m.suggestion,
        })),
      ),
      "Menu Engineering",
    );
  }

  if (heat?.items?.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        heat.items.slice(0, 50).map((h) => ({
          Item: h.item_name,
          "Heat index": h.heatIndex,
          Band: h.band,
          Tag: h.tag || "",
          Views: h.views,
          Orders: h.orders,
          "Conversion %": h.conversion_pct,
        })),
      ),
      "Heat Score",
    );
  }

  if (waiters?.waiters?.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        waiters.waiters.map((w) => ({
          Waiter: w.waiter,
          Revenue: w.net_sales,
          "Avg check": w.avgCheck,
          "Modifier attach %": w.modifierAttachPct,
          "Dessert attach %": w.dessertAttachPct,
          "Beverage attach %": w.beverageAttachPct,
        })),
      ),
      "Staff",
    );
  }

  if (timeShift?.dayparts?.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        timeShift.dayparts.map((d) => ({
          Daypart: d.label,
          "Menu events": d.menuEvents,
          "Sales qty": d.salesQty,
          Revenue: d.revenue,
        })),
      ),
      "Time & Shift",
    );
  }

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    "nac-visual-intelligence.xlsx",
  );
}
