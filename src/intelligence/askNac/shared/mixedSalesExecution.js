/**
 * Execute a today-vs-yesterday sales comparison as two queries.
 * Today is Foodics. Yesterday is Cash Up. The figures are never added.
 */

import { parseVaultPeriodFromQuestion } from "../vault/vaultPeriodParser";
import { getFoodicsSalesSummary } from "../foodics/foodicsQueryTools";
import { runVaultQueryTool } from "../vault/vaultQueryTools";
import { SALES_SOURCE, mixedSalesSides } from "./salesSourcePolicy";

export function lockMixedSalesRoute(route, referenceDate = new Date()) {
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

export async function executeMixedTodayYesterdaySales(supabase, context = {}) {
  const referenceDate = context.referenceDate instanceof Date && !Number.isNaN(context.referenceDate.getTime())
    ? context.referenceDate
    : new Date();
  const sides = mixedSalesSides();
  const today = parseVaultPeriodFromQuestion("today", referenceDate);
  const yesterday = parseVaultPeriodFromQuestion("yesterday", referenceDate);

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

  return {
    mixedSalesComparison: true,
    salesSides: sides,
    todayPeriod: today,
    yesterdayPeriod: yesterday,
    foodicsToday,
    cashUpYesterday,
    facts: cashUpYesterday?.facts || [],
    aggregation: null,
  };
}
