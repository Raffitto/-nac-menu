/**
 * Server-side cash-up range aggregation via get_vault_cash_up_range_aggregate RPC (Edge).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export function mapRpcAggregationRow(row: Record<string, unknown> = {}) {
  const dailyBreakdown = Array.isArray(row.dailyBreakdown) ? row.dailyBreakdown : [];

  return {
    totalSales: row.totalSales != null ? Number(row.totalSales) : null,
    totalGuests: row.totalGuests != null ? Number(row.totalGuests) : null,
    totalOrders: row.totalOrders != null ? Number(row.totalOrders) : null,
    averageSpend: row.averageSpend != null ? Number(row.averageSpend) : null,
    totalDeliverySales: row.totalDeliverySales != null ? Number(row.totalDeliverySales) : null,
    totalDeliveryOrders: row.totalDeliveryOrders != null ? Number(row.totalDeliveryOrders) : null,
    dayCount: Number(row.dayCount) || 0,
    dailyBreakdown,
    salesCoverageStart: (row.salesCoverageStart as string) || null,
    salesCoverageEnd: (row.salesCoverageEnd as string) || null,
    deliveryOrderCoverageStart: (row.deliveryOrderCoverageStart as string) || null,
    deliveryPlatformBreakdown: row.deliveryPlatformBreakdown || {},
    topPlatformBySales: (row.topPlatformBySales as string) || null,
    topPlatformByOrders: (row.topPlatformByOrders as string) || null,
  };
}

export async function fetchCashUpRangeAggregationViaRpc(
  supabase: SupabaseClient,
  { branch, startDate, endDate, includeDailyBreakdown = false }: {
    branch?: string | null;
    startDate?: string;
    endDate?: string;
    includeDailyBreakdown?: boolean;
  } = {},
) {
  const { data, error } = await supabase.rpc("get_vault_cash_up_range_aggregate", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_branch_id: branch || null,
    p_include_daily_breakdown: Boolean(includeDailyBreakdown),
  });

  if (error) throw new Error(error.message);
  return mapRpcAggregationRow((data as Record<string, unknown>) || {});
}

export function shouldUseCashUpRangeRpc({
  startDate,
  endDate,
  periodType,
  includeDailyBreakdown,
}: {
  startDate?: string;
  endDate?: string;
  periodType?: string;
  includeDailyBreakdown?: boolean;
}) {
  if (includeDailyBreakdown) return false;
  if (!startDate || !endDate) return false;
  return periodType === "year_to_date" || includeDailyBreakdown === false;
}
