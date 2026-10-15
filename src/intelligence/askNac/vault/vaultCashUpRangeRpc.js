/**
 * Server-side cash-up range aggregation via get_vault_cash_up_range_aggregate RPC.
 * Used when daily breakdown is not required (YTD / wide ranges).
 */

const BRANCH_LABELS = { khobar: "Khobar", riyadh: "Riyadh", jeddah: "Jeddah" };
const BRANCH_ORDER = ["khobar", "riyadh", "jeddah"];

function includedBranches(value) {
  const raw = Array.isArray(value) ? value : [];
  const ids = [];
  for (const item of raw) {
    const text = String(item || "").toLowerCase();
    const id = text.includes("khobar")
      ? "khobar"
      : text.includes("riyadh")
        ? "riyadh"
        : (text.includes("jeddah") || text.includes("jedda"))
          ? "jeddah"
          : "";
    if (id && !ids.includes(id)) ids.push(id);
  }
  return BRANCH_ORDER.filter((branch) => ids.includes(branch));
}

function labelIncludedBranches(ids) {
  const labels = ids.map((id) => BRANCH_LABELS[id]).filter(Boolean);
  if (labels.length === 0) return null;
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

export function mapRpcAggregationRow(row = {}) {
  const dailyBreakdown = Array.isArray(row.dailyBreakdown)
    ? row.dailyBreakdown
    : (row.dailyBreakdown ? JSON.parse(String(row.dailyBreakdown)) : []);
  const branchesIncluded = includedBranches(row.branchesIncluded);

  return {
    totalSales: row.totalSales != null ? Number(row.totalSales) : null,
    totalGuests: row.totalGuests != null ? Number(row.totalGuests) : null,
    totalOrders: row.totalOrders != null ? Number(row.totalOrders) : null,
    averageSpend: row.averageSpend != null ? Number(row.averageSpend) : null,
    totalDeliverySales: row.totalDeliverySales != null ? Number(row.totalDeliverySales) : null,
    totalDeliveryOrders: row.totalDeliveryOrders != null ? Number(row.totalDeliveryOrders) : null,
    dayCount: Number(row.dayCount) || 0,
    dailyBreakdown: dailyBreakdown || [],
    salesCoverageStart: row.salesCoverageStart || null,
    salesCoverageEnd: row.salesCoverageEnd || null,
    availableDates: Array.isArray(row.availableDates)
      ? row.availableDates.map(String)
      : [],
    deliveryOrderCoverageStart: row.deliveryOrderCoverageStart || null,
    deliveryPlatformBreakdown: row.deliveryPlatformBreakdown || {},
    topPlatformBySales: row.topPlatformBySales || null,
    topPlatformByOrders: row.topPlatformByOrders || null,
    branchesIncluded,
    branchCoverageLabel: labelIncludedBranches(branchesIncluded),
  };
}

export async function fetchCashUpRangeAggregationViaRpc(
  supabase,
  { branch, startDate, endDate, includeDailyBreakdown = false } = {},
) {
  const { data, error } = await supabase.rpc("get_vault_cash_up_range_aggregate", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_branch_id: branch || null,
    p_include_daily_breakdown: Boolean(includeDailyBreakdown),
  });

  if (error) throw new Error(error.message);
  return mapRpcAggregationRow(data || {});
}

export function shouldUseCashUpRangeRpc({ startDate, endDate, periodType, includeDailyBreakdown }) {
  void includeDailyBreakdown;
  void periodType;
  // Prefer the server aggregate for any closed range. Fact-scan limits can truncate
  // a full month (~20+ facts/day) and make the first day look like the period total.
  if (!startDate || !endDate) return false;
  return true;
}
