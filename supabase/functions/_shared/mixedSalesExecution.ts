/**
 * Execute a today-vs-yesterday sales comparison as two queries.
 * Today is Foodics. Yesterday is Cash Up. The figures are never added.
 */

import { parseVaultPeriodFromQuestion } from "./vaultPeriodParser.ts";
import { getFoodicsSalesSummary } from "./askNacFoodicsTools.ts";
import { runVaultQueryTool } from "./askNacVaultTools.ts";
import { SALES_SOURCE, mixedSalesSides } from "./salesSourcePolicy.js";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type VaultPeriod = {
  startDate?: string;
  endDate?: string;
  label?: string;
  periodType?: string;
  isSingleDay?: boolean;
};

export function lockMixedSalesRoute<T extends { salesSource?: string; vaultPeriod?: unknown; vaultCompare?: unknown; foodicsPeriod?: unknown; queryFocus?: unknown; performanceOverview?: unknown }>(
  route: T,
  referenceDate = new Date(),
): T {
  if (route?.salesSource !== SALES_SOURCE.MIXED_TODAY_YESTERDAY) return route;
  const today = parseVaultPeriodFromQuestion("today", referenceDate);
  const yesterday = parseVaultPeriodFromQuestion("yesterday", referenceDate);
  return {
    ...route,
    vaultPeriod: yesterday,
    vaultCompare: null,
    foodicsPeriod: today,
    queryFocus: null,
    performanceOverview: false,
  };
}

export async function executeMixedTodayYesterdaySales(
  supabase: SupabaseClient,
  context: Record<string, unknown> = {},
) {
  const referenceDate = context.referenceDate instanceof Date && !Number.isNaN(context.referenceDate.getTime())
    ? context.referenceDate
    : new Date();
  const sides = mixedSalesSides();
  const today = parseVaultPeriodFromQuestion("today", referenceDate) as VaultPeriod;
  const yesterday = parseVaultPeriodFromQuestion("yesterday", referenceDate) as VaultPeriod;

  const [foodicsToday, cashUpYesterday] = await Promise.all([
    getFoodicsSalesSummary(supabase, {
      ...context,
      question: "sales today",
      foodicsPeriod: today,
    }),
    runVaultQueryTool(supabase, "vault_cash_up_summary", {
      ...context,
      question: "sales yesterday",
      vaultPeriod: yesterday,
      vaultCompare: null,
      suppressVaultCompare: true,
      mixedSalesSide: "yesterday",
      salesSource: sides.yesterday,
      queryFocus: null,
      performanceOverview: false,
      referenceDate,
    }),
  ]);

  const cashUpRecord = (cashUpYesterday || {}) as Record<string, unknown>;
  return {
    mixedSalesComparison: true,
    salesSides: sides,
    todayPeriod: today,
    yesterdayPeriod: yesterday,
    foodicsToday,
    cashUpYesterday,
    facts: cashUpRecord.facts || [],
    aggregation: null,
  };
}
