/**
 * Server-side cash-up range aggregation via get_vault_cash_up_range_aggregate RPC (Edge).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const BRANCH_LABELS: Record<string, string> = { khobar: "Khobar", riyadh: "Riyadh", jeddah: "Jeddah" };
const BRANCH_ORDER = ["khobar", "riyadh", "jeddah"];

function includedBranches(value: unknown) {
  const raw = Array.isArray(value) ? value : [];
  const ids: string[] = [];
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

function labelIncludedBranches(ids: string[]) {
  const labels = ids.map((id) => BRANCH_LABELS[id]).filter(Boolean);
  if (labels.length === 0) return null;
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

export function mapRpcAggregationRow(row: Record<string, unknown> = {}) {
  const dailyBreakdown = Array.isArray(row.dailyBreakdown) ? row.dailyBreakdown : [];
  const branchesIncluded = includedBranches(row.branchesIncluded);

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
    availableDates: Array.isArray(row.availableDates) ? (row.availableDates as string[]).map(String) : [],
    deliveryOrderCoverageStart: (row.deliveryOrderCoverageStart as string) || null,
    deliveryPlatformBreakdown: row.deliveryPlatformBreakdown || {},
    topPlatformBySales: (row.topPlatformBySales as string) || null,
    topPlatformByOrders: (row.topPlatformByOrders as string) || null,
    branchesIncluded,
    branchCoverageLabel: labelIncludedBranches(branchesIncluded),
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
  void includeDailyBreakdown;
  void periodType;
  // Prefer the server aggregate for any closed range. Fact-scan limits can truncate
  // a full month (~20+ facts/day) and make the first day look like the period total.
  if (!startDate || !endDate) return false;
  return true;
}
