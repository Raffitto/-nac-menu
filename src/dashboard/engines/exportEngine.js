import * as XLSX from "xlsx";
import {
  exportReviewSummaryPdf,
  buildExecutiveBrief,
} from "./reviewSummaryPdfExport";
import { exportCSV } from "../utils/formatters";
import { exportCell, clampMetric } from "../utils/intelligenceSanity";
import { buildExportCommentary } from "../utils/itemBehaviorEngine";
import { businessDayExportNote } from "../utils/businessDay";
import { branchDisplayName } from "../utils/rangeState";
import { exportVisibilityPDF } from "./visibilityPdfExport";

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

export function exportExecutivePDF(opts) {
  exportVisibilityPDF(opts);
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

function fallbackRow(msg = "Not enough data for this section yet.") {
  return [[msg]];
}

/** Context-aware Review Intelligence export (branch + range from current view) */
export function exportReviewIntelligenceReport({
  branch,
  selectedRange,
  rangeLabel,
  review,
  unified,
  comparison: comparisonIn,
  branchComparison,
  staffStats = [],
  employees = [],
  diagnostics,
  format = "xlsx",
}) {
  const comparison = comparisonIn ?? branchComparison ?? [];

  if (format === "pdf") {
    exportReviewSummaryPdf({
      branch,
      selectedRange,
      rangeLabel,
      review,
      unified,
      staffStats,
      employees,
      comparison,
      branchComparison: comparison,
    });
    return;
  }

  const title = `NAC HOSPITALITY OS · Review Intelligence — ${branch} — ${rangeLabel}`;
  const generated = new Date().toLocaleString();
  const showComparison = comparison.length > 0;
  const branchKey = (branch || "").toLowerCase().replace(/\s+/g, "");
  const branchRow = comparison.find(
    (b) => branchDisplayName(b.branch_id).toLowerCase() === branchKey || b.branch_id === branchKey,
  );

  const wb = XLSX.utils.book_new();
  const summary = [
    [title],
    ["Generated", generated],
    ["Branch", branch],
    ["Period", rangeLabel],
    [],
    ["Metric", "Value"],
    ["QR scans", review?.qr_scans ?? 0],
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
      Branch: branchDisplayName(b.branch_id),
      "QR scans": b.qr_scans,
      "Reviews generated": b.reviews_generated,
      "Google redirects": b.google_redirects,
      "Conversion %": b.conversion_pct,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Branch benchmark");
  }

  if (branchRow) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        [`${branch} focus`],
        ["QR scans", branchRow.qr_scans],
        ["Reviews generated", branchRow.reviews_generated],
        ["Google redirects", branchRow.google_redirects],
        ["Conversion %", branchRow.conversion_pct],
      ]),
      "Branch focus",
    );
  }

  const brief = buildExecutiveBrief(review, staffStats, comparison, branch);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Executive brief"],
      ["Top opportunity", brief.topOpportunity],
      ["Strongest branch", brief.strongestBranch],
      ["Weakest funnel", brief.weakestFunnel],
      ["Est. missed Google reviews", brief.missedGoogle],
      ["Recommendation", brief.recommendation],
    ]),
    "Executive brief",
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

export {
  exportVisualIntelligencePDF,
  exportExecutiveVisualPDF,
} from "./executiveVisualPdfExport";

export {
  exportVisualIntelligenceXLSX,
  exportExecutiveVisualXLSX,
} from "./executiveVisualXlsxExport";

export { exportDetailedBranchOperationalReview } from "./detailedBranchReviewExport";
export {
  buildAllBranchOperationalReports,
  buildBranchOperationalReport,
} from "./branchOperationalReviewEngine";
