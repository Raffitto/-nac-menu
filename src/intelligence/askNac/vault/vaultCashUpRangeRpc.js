/**
 * Server-side cash-up range aggregation via get_vault_cash_up_range_aggregate RPC.
 * Used when daily breakdown is not required (YTD / wide ranges).
 */

export function mapRpcAggregationRow(row = {}) {
  const dailyBreakdown = Array.isArray(row.dailyBreakdown)
    ? row.dailyBreakdown
    : (row.dailyBreakdown ? JSON.parse(String(row.dailyBreakdown)) : []);

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
    deliveryOrderCoverageStart: row.deliveryOrderCoverageStart || null,
    deliveryPlatformBreakdown: row.deliveryPlatformBreakdown || {},
    topPlatformBySales: row.topPlatformBySales || null,
    topPlatformByOrders: row.topPlatformByOrders || null,
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
  if (includeDailyBreakdown) return false;
  if (!startDate || !endDate) return false;
  return periodType === "year_to_date" || includeDailyBreakdown === false;
}
