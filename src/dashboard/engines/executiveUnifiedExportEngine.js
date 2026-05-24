/**
 * Unified executive export — aggregates Foodics imports + Khobar review scans.
 * Applies report truth validation before rendering.
 */

import { validateImportBatchIntegrity, isModifierOrAddonRow } from "../../platform/engines/reportTruthEngine";
import { buildWaiterImportValidation } from "../utils/waiterImportValidation";
import { buildWaiterSalesIntelligence } from "./waiterSalesEngine";
import { aggregateStaffReviewStats } from "../utils/staffReviewStats";
import { filterProductionStaffList } from "../utils/isProductionStaff";
import { normalizeBranchId } from "../utils/branchIdentity";
import { formatSarMoney } from "../utils/sarMoneyFormat";
import { FOODICS_CLASS } from "../utils/foodicsClassifier";

const PROMO_CLASSES = new Set([FOODICS_CLASS.PROMO_CAMPAIGN, "promo_campaign", "promo"]);
const IGNORED_STATUS = new Set(["ignored", "ignored_selection", "ignored_free_modifier"]);

function itemDisplayName(row) {
  return (row.matched_menu_item_name || row.raw_item_name || row.item_name || "Unknown").trim();
}

function itemKey(name) {
  return String(name || "").trim().toLowerCase();
}

/** Roll up product import lines by display name. */
export function aggregateProductItemsByName(rows = []) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const name = itemDisplayName(row);
    const key = itemKey(name);
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, {
        item_name: name,
        quantity: 0,
        net_sales: 0,
        matched_menu_item_name: row.matched_menu_item_name || null,
        foodics_class: row.foodics_class || row.semantic_class || null,
        import_status: row.import_status || null,
        track_as_modifier: row.track_as_modifier,
      });
    }
    const agg = map.get(key);
    agg.quantity += Number(row.quantity_sold) || 0;
    agg.net_sales += Number(row.net_sales) || 0;
  });
  return [...map.values()];
}

/** Bottom-10 eligibility — real menu / side / add-on / modifier only. */
export function includeInBottomItemsList(row) {
  const qty = Number(row.quantity) || 0;
  if (qty <= 0) return false;

  const cls = String(row.foodics_class || "").toLowerCase();
  if (PROMO_CLASSES.has(cls)) return false;
  if (IGNORED_STATUS.has(row.import_status) && !row.matched_menu_item_name) return false;
  if (cls === FOODICS_CLASS.OPERATIONAL || cls === "operational") return false;

  const mapped = Boolean(row.matched_menu_item_name);
  if (mapped) return true;
  if (isModifierOrAddonRow(row)) return true;
  if ([FOODICS_CLASS.MENU_ITEM, FOODICS_CLASS.DRINK, FOODICS_CLASS.ADDON, "menu_item", "drink", "addon"].includes(cls)) {
    return true;
  }
  if (row.import_status === "matched" || row.import_status === "paid_modifier") return true;
  return false;
}

function rankWithTop3(rows, sortFn, valueKey) {
  const sorted = [...rows].sort(sortFn);
  return sorted.map((row, index) => ({
    ...row,
    rank: index + 1,
    is_top_three: index < 3,
    display_net_sales: formatSarMoney(row[valueKey] ?? row.net_sales),
    display_quantity: Number(row.quantity ?? row.qty ?? 0).toLocaleString("en-US"),
  }));
}

/**
 * @param {object} input
 */
export function buildExecutiveUnifiedExportPackage(input = {}) {
  const {
    exportRange = null,
    branchId = "khobar",
    productItems = [],
    waiterItems = [],
    reviewEvents = [],
    upsellFocusItems = [],
    productBatch = null,
    waiterBatch = null,
  } = input;

  const productValidation = buildWaiterImportValidation(productItems);
  const waiterValidation = buildWaiterImportValidation(waiterItems);
  const productIntegrity = validateImportBatchIntegrity(productItems, productValidation.totals);
  const waiterIntegrity = validateImportBatchIntegrity(waiterItems, waiterValidation.totals);
  const integrityOk = productIntegrity.valid && waiterIntegrity.valid;

  const aggregated = aggregateProductItemsByName(productItems);
  const withQty = aggregated.filter((r) => r.quantity > 0);

  const topItems = rankWithTop3(
    withQty,
    (a, b) => b.quantity - a.quantity || b.net_sales - a.net_sales,
    "net_sales",
  ).slice(0, 10);

  const bottomCandidates = withQty.filter(includeInBottomItemsList);
  const bottomItems = rankWithTop3(
    bottomCandidates,
    (a, b) => a.quantity - b.quantity || a.net_sales - b.net_sales,
    "net_sales",
  ).slice(0, 10);

  const waiterIntel = buildWaiterSalesIntelligence(waiterItems, {
    focusItems: upsellFocusItems,
    salesMetric: "net_sales",
  });

  const waiterSalesRows = rankWithTop3(
    (waiterIntel.all || []).map((w) => ({
      waiter: w.waiter,
      net_sales: w.net_sales,
      quantity: w.quantity,
      role: w.roleLabel || w.role,
    })),
    (a, b) => b.net_sales - a.net_sales,
    "net_sales",
  );

  const upsellRows = upsellFocusItems.length
    ? rankWithTop3(
        (waiterIntel.all || []).map((w) => {
          const focusQty = (w.focusPerformance || []).reduce((sum, f) => sum + (Number(f.qty) || 0), 0);
          const focusRev = (w.focusPerformance || []).reduce((sum, f) => sum + (Number(f.revenue) || 0), 0);
          return {
            waiter: w.waiter,
            quantity: focusQty,
            net_sales: focusRev,
            role: w.roleLabel || w.role,
          };
        }),
        (a, b) => b.quantity - a.quantity || b.net_sales - a.net_sales,
        "net_sales",
      )
    : [];

  const khobarEvents = (reviewEvents || []).filter(
    (e) => normalizeBranchId(e.branch_id) === "khobar",
  );
  const khobarStaff = filterProductionStaffList(aggregateStaffReviewStats(khobarEvents));
  const khobarGoogleRows = rankWithTop3(
    khobarStaff.map((s) => ({
      waiter: s.name,
      google_redirects: s.google,
      qr_scans: s.scans,
      conversion_pct: s.conversion_pct,
    })),
    (a, b) => b.google_redirects - a.google_redirects || b.qr_scans - a.qr_scans,
    "google_redirects",
  );

  const periodLabel = exportRange?.periodLabel || "Selected period";
  const branchLabel = branchId ? branchId.charAt(0).toUpperCase() + branchId.slice(1) : "All";

  const notes = {
    topItems: !productItems.length
      ? "No product import rows for this period. Upload a Product Sales batch covering the selected dates."
      : !integrityOk
        ? productIntegrity.message || "Import totals could not be validated — figures are provisional."
        : null,
    bottomItems: !bottomCandidates.length
      ? "No qualifying menu items with sales in this period (promo and noise rows excluded)."
      : null,
    waiterSales: !waiterItems.length
      ? "No waiter product sales import for this period."
      : !waiterIntegrity.valid
        ? waiterIntegrity.message
        : null,
    waiterUpsell: !upsellFocusItems.length
      ? "Select upsell / modifier items in the export dialog to rank waiter upsell performance."
      : !waiterItems.length
        ? "Requires waiter product sales import."
        : null,
    khobarGoogle: !khobarEvents.length
      ? "No Khobar review scan events in this period."
      : null,
  };

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      periodLabel,
      branchId,
      branchLabel,
      dataSourceNote:
        "Foodics product + waiter imports · Khobar review QR / Google redirect events",
      productBatchLabel: productBatch
        ? `${productBatch.period_start} → ${productBatch.period_end}`
        : null,
      waiterBatchLabel: waiterBatch
        ? `${waiterBatch.period_start} → ${waiterBatch.period_end}`
        : null,
    },
    importIntegrity: {
      product: productIntegrity,
      waiter: waiterIntegrity,
      valid: integrityOk,
    },
    provisional: !integrityOk,
    suppressRankings: !integrityOk,
    upsellFocusItems,
    topItems: { rows: integrityOk ? topItems : [], note: notes.topItems },
    bottomItems: { rows: integrityOk ? bottomItems : [], note: notes.bottomItems },
    waiterSales: { rows: waiterIntegrity.valid ? waiterSalesRows : [], note: notes.waiterSales },
    waiterUpsell: { rows: upsellRows, note: notes.waiterUpsell },
    khobarGoogle: { rows: khobarGoogleRows, note: notes.khobarGoogle },
    totals: {
      product: productValidation.totals,
      waiter: waiterValidation.totals,
    },
  };
}

/** Tabular rows for XLSX reuse */
export function executiveUnifiedExportSheets(pkg) {
  if (!pkg) return [];
  const sheets = [];

  sheets.push({
    name: "Top 10 Items",
    headers: ["Rank", "Item", "Net Qty", "Net Sales"],
    rows: (pkg.topItems.rows || []).map((r) => [
      r.rank,
      r.item_name,
      r.display_quantity,
      r.display_net_sales,
    ]),
    note: pkg.topItems.note,
  });

  sheets.push({
    name: "Bottom 10 Items",
    headers: ["Rank", "Item", "Net Qty", "Net Sales"],
    rows: (pkg.bottomItems.rows || []).map((r) => [
      r.rank,
      r.item_name,
      r.display_quantity,
      r.display_net_sales,
    ]),
    note: pkg.bottomItems.note,
  });

  sheets.push({
    name: "Waiter Net Sales",
    headers: ["Rank", "Waiter", "Net Sales", "Units", "Role"],
    rows: (pkg.waiterSales.rows || []).map((r) => [
      r.rank,
      r.waiter,
      r.display_net_sales,
      r.display_quantity,
      r.role || "",
    ]),
    note: pkg.waiterSales.note,
  });

  sheets.push({
    name: "Waiter Upsell",
    headers: ["Rank", "Waiter", "Upsell Qty", "Upsell Net", "Role"],
    rows: (pkg.waiterUpsell.rows || []).map((r) => [
      r.rank,
      r.waiter,
      r.display_quantity,
      r.display_net_sales,
      r.role || "",
    ]),
    note: pkg.waiterUpsell.note,
  });

  sheets.push({
    name: "Khobar Google",
    headers: ["Rank", "Waiter", "Google Redirects", "QR Scans", "To Google %"],
    rows: (pkg.khobarGoogle.rows || []).map((r) => [
      r.rank,
      r.waiter,
      r.google_redirects,
      r.qr_scans,
      `${r.conversion_pct ?? 0}%`,
    ]),
    note: pkg.khobarGoogle.note,
  });

  return sheets;
}
