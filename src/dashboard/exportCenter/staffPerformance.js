import { canonicalStaffName } from "../config/staffRoles";
import { isEligibleStaff, managerExclusionNote, periodExclusionNotes, sortMatrixStaff, STAFF_MATRIX_ORDER } from "./staffEligibility";
import { matchTrackedUpsell, TRACKED_UPSELL_ITEMS } from "./trackedUpsellCatalog";

/** KSA VAT. Foodics "Net Sales w/ Tax" is inclusive. */
export const KSA_VAT_RATE = 0.15;

export const AVG_CHECK_FORMULA = {
  id: "net_sales_ex_vat_per_order",
  label: "Avg Check = (Net Sales w/ Tax ÷ 1.15) ÷ Orders",
  why: "Sales by Creator net sales include 15% VAT. Average check is the ex-VAT ticket average. Guests are shown but are not the denominator.",
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sourceProductName(row) {
  return String(row.raw_item_name || row.matched_menu_item_name || "").trim();
}

export function parseGuestsFromCreatorRow(row) {
  const cat = String(row.category || "");
  const m = cat.match(/guests:(\d+)/i);
  if (m) return Number(m[1]);
  if (row.guest_count != null) return num(row.guest_count);
  return null;
}

export function averageCheckFromNetSales(netSalesWithTax, orders) {
  const tickets = num(orders);
  if (tickets <= 0) return 0;
  const exVat = num(netSalesWithTax) / (1 + KSA_VAT_RATE);
  return Math.round((exVat / tickets) * 100) / 100;
}

export function buildAverageCheckRows(creatorRows = [], { from, to } = {}) {
  const byStaff = {};
  (creatorRows || []).forEach((row) => {
    const name = canonicalStaffName(row.waiter_name || row.raw_item_name);
    if (!isEligibleStaff(name, { from, to, scope: "sales_ranking" })) return;
    if (!byStaff[name]) {
      byStaff[name] = { staff: name, netSales: 0, orders: 0, guests: 0 };
    }
    byStaff[name].netSales += num(row.net_sales ?? row.gross_sales);
    byStaff[name].orders += num(row.quantity_sold);
    const guests = parseGuestsFromCreatorRow(row);
    if (guests != null) byStaff[name].guests += guests;
  });

  return Object.values(byStaff)
    .map((row) => ({
      ...row,
      avgCheck: averageCheckFromNetSales(row.netSales, row.orders),
      netSales: Math.round(row.netSales),
    }))
    .sort((a, b) => b.avgCheck - a.avgCheck || b.netSales - a.netSales)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

export function buildReviewRanking(reviewStats = [], { from, to } = {}) {
  return (reviewStats || [])
    .filter((s) => isEligibleStaff(s.name, { from, to, scope: "reviews" }))
    .map((s) => ({
      staff: canonicalStaffName(s.name),
      reviews: num(s.google ?? s.review_count),
    }))
    .sort((a, b) => b.reviews - a.reviews || a.staff.localeCompare(b.staff))
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

export function buildUpsellModel(productRows = [], { from, to, targetItems = null, roster = null } = {}) {
  void targetItems;
  const byStaff = {};
  const byItem = {};
  const mappingFailures = [];
  const allowed = roster ? new Set(roster) : null;
  TRACKED_UPSELL_ITEMS.forEach((item) => {
    byItem[item.displayName] = { item: item.displayName, id: item.id, total: 0, byStaff: {}, sales: 0 };
  });

  (productRows || []).forEach((row) => {
    const staff = canonicalStaffName(row.waiter_name);
    if (!isEligibleStaff(staff, { from, to, scope: "upsell" })) return;
    if (allowed && !allowed.has(staff)) return;
    const sourceName = sourceProductName(row);
    if (!sourceName || sourceName === "__creator__") return;
    const matched = matchTrackedUpsell(sourceName);
    if (matched.status === "ambiguous") {
      mappingFailures.push(matched);
      return;
    }
    if (matched.status !== "mapped") return;
    const item = matched.displayName;
    const qty = num(row.quantity_sold);
    const sales = num(row.gross_sales ?? row.net_sales);
    if (!byStaff[staff]) byStaff[staff] = { staff, qty: 0, sales: 0 };
    byStaff[staff].qty += qty;
    byStaff[staff].sales += sales;
    byItem[item].total += qty;
    byItem[item].sales += sales;
    byItem[item].byStaff[staff] = (byItem[item].byStaff[staff] || 0) + qty;
  });

  const totalQty = Object.values(byStaff).reduce((s, r) => s + r.qty, 0);
  const topUpsellers = Object.values(byStaff)
    .map((r) => ({
      ...r,
      sales: Math.round(r.sales),
      share: totalQty > 0 ? Math.round((r.qty / totalQty) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.qty - a.qty || b.sales - a.sales)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  const whoSoldWhat = TRACKED_UPSELL_ITEMS.map((spec) => {
    const entry = byItem[spec.displayName];
    const ranked = Object.entries(entry.byStaff)
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        const ia = STAFF_MATRIX_ORDER.indexOf(a[0]);
        const ib = STAFF_MATRIX_ORDER.indexOf(b[0]);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        return a[0].localeCompare(b[0]);
      })
      .map(([staff, qty]) => ({ staff, qty }));
    return {
      item: spec.displayName,
      first: ranked[0] || null,
      second: ranked[1] || null,
      third: ranked[2] || null,
      total: entry.total,
    };
  });

  return { topUpsellers, whoSoldWhat, byItem, mappingFailures, totalTrackedQty: totalQty };
}

export function buildStaffPerformanceReport({
  creatorRows = [],
  productRows = [],
  reviewStats = [],
  branch = "khobar",
  from,
  to,
} = {}) {
  const averageCheck = buildAverageCheckRows(creatorRows, { from, to });
  const reviews = buildReviewRanking(reviewStats, { from, to });
  const roster = averageCheck.map((r) => r.staff);
  const upsell = buildUpsellModel(productRows, { from, to, roster });
  const staffNames = sortMatrixStaff(averageCheck.map((r) => r.staff));
  const matrix = TRACKED_UPSELL_ITEMS.map((spec) => {
    const entry = upsell.byItem[spec.displayName];
    const row = { item: spec.displayName, total: 0 };
    staffNames.forEach((name) => {
      const qty = entry.byStaff[name] || 0;
      row[name] = qty;
      row.total += qty;
    });
    return row;
  });

  return {
    branch,
    from,
    to,
    averageCheck,
    reviews,
    reviewTotal: reviews.reduce((s, r) => s + r.reviews, 0),
    topUpsellers: upsell.topUpsellers.slice(0, 3),
    whoSoldWhat: upsell.whoSoldWhat,
    matrix,
    staffNames,
    mappingFailures: upsell.mappingFailures,
    eligibilityNotes: [managerExclusionNote(), ...periodExclusionNotes(from, to, "sales_ranking")],
    avgCheckFormula: AVG_CHECK_FORMULA,
  };
}
