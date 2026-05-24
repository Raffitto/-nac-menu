/**
 * Unified executive export — re-exports v2 package builder + XLSX sheets.
 */

export { aggregateProductItemsByName, includeInBottomItemsList } from "./executiveExport/productRollup";
export { buildExecutiveUnifiedExportPackage } from "./executiveExport/buildPackage";

/** Tabular rows for XLSX reuse */
export function executiveUnifiedExportSheets(pkg) {
  if (!pkg) return [];

  const summarySheet = {
    name: "Executive Summary",
    headers: ["Metric", "Value"],
    rows: pkg.summary
      ? [
          ["Period", pkg.summary.period],
          ["Branch", pkg.summary.branch],
          ["Trust score", pkg.summary.operational_trust_score],
          ["Data confidence", pkg.summary.data_confidence],
          ["Top seller", pkg.summary.top_seller?.item],
          ["Top waiter", pkg.summary.top_waiter?.name],
          ["Operational concern", pkg.summary.operational_concern?.title],
          ["Recommended action", pkg.summary.recommended_action],
        ]
      : [],
    note: pkg.periodAlignment?.coverageNote,
  };

  const sectionToSheet = (section, headers, rowMap) => ({
    name: section.title?.slice(0, 28) || section.id,
    headers,
    rows: (section.rows || []).map(rowMap),
    note: section.note,
  });

  return [
    summarySheet,
    sectionToSheet(
      pkg.sections?.topItems || pkg.topItems,
      ["Rank", "Item", "Net Qty", "Share %", "Net Sales"],
      (r) => [r.rank, r.item_name, r.display_quantity, r.display_contribution, r.display_net_sales],
    ),
    sectionToSheet(
      pkg.sections?.bottomItems || pkg.bottomItems,
      ["Rank", "Item", "Net Qty", "Action", "Net Sales"],
      (r) => [r.rank, r.item_name, r.display_quantity, r.action_label, r.display_net_sales],
    ),
    sectionToSheet(
      pkg.sections?.waiterSales || pkg.waiterSales,
      ["Rank", "Waiter", "Net Sales", "Share %", "Units"],
      (r) => [r.rank, r.waiter, r.display_net_sales, r.display_contribution, r.display_quantity],
    ),
    sectionToSheet(
      pkg.sections?.waiterUpsell || pkg.waiterUpsell,
      ["Rank", "Waiter", "Upsell Qty", "Share %", "Upsell Net"],
      (r) => [r.rank, r.waiter, r.display_quantity, r.display_contribution, r.display_net_sales],
    ),
    sectionToSheet(
      pkg.sections?.khobarGoogle || pkg.khobarGoogle,
      ["Rank", "Waiter", "Google", "Share %", "QR Scans", "To Google %"],
      (r) => [
        r.rank,
        r.waiter,
        r.google_redirects,
        r.display_contribution,
        r.qr_scans,
        r.display_conversion,
      ],
    ),
  ];
}
