/**
 * Execute a sales comparison as separate source queries.
 * Authorization runs before Foodics or Cash Up is touched.
 * Open periods use Foodics. Completed periods use Cash Up, unless the
 * question explicitly asks for Foodics on both sides. Sources are never added.
 */

import { parseVaultPeriodFromQuestion } from "./vaultPeriodParser.ts";
import { getFoodicsSalesSummary } from "./askNacFoodicsTools.ts";
import { runVaultQueryTool } from "./askNacVaultTools.ts";
import { authorizeSalesBranches } from "./salesBranchAuthorization.ts";
import { canonicalCashUpSales, SALES_SOURCE, isComparisonSalesSource, resolveSalesComparison } from "./salesSourcePolicy.js";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type VaultPeriod = {
  startDate?: string;
  endDate?: string;
  label?: string;
  periodType?: string;
  isSingleDay?: boolean;
};

const TODAY_YESTERDAY = {
  kind: SALES_SOURCE.MIXED_TODAY_YESTERDAY,
  current: { token: "today", label: "Today", source: SALES_SOURCE.FOODICS_LIVE },
  previous: { token: "yesterday", label: "Yesterday", source: SALES_SOURCE.CASH_UP },
};

function finiteSales(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cashUpValue(result: Record<string, unknown> | null, onlyBranch?: unknown) {
  if (!result || result.authorizationDenied) return null;
  return canonicalCashUpSales((result.facts as Record<string, unknown>[]) || [], onlyBranch);
}

function foodicsValue(result: Record<string, unknown> | null) {
  if (!result || result.authorizationDenied || result.missingBatch || result.missingPeriod) return null;
  const totals = result.totals as { netSales?: unknown } | undefined;
  return finiteSales(totals?.netSales);
}

function periodDate(period: VaultPeriod | null) {
  if (!period?.startDate) return "the period";
  if (!period.endDate || period.endDate === period.startDate) return period.startDate;
  return `${period.startDate} to ${period.endDate}`;
}

export function lockMixedSalesRoute<T extends { salesSource?: string; question?: string; vaultPeriod?: unknown; vaultCompare?: unknown; foodicsPeriod?: unknown; queryFocus?: unknown; performanceOverview?: unknown }>(
  route: T,
  referenceDate = new Date(),
  question?: string,
): T {
  if (!isComparisonSalesSource(route?.salesSource)) return route;
  const plan = resolveSalesComparison(question || route?.question || "") || TODAY_YESTERDAY;
  const current = parseVaultPeriodFromQuestion(plan.current.token, referenceDate) as VaultPeriod;
  const previous = parseVaultPeriodFromQuestion(plan.previous.token, referenceDate) as VaultPeriod;
  const cashUpPeriod = plan.previous.source === SALES_SOURCE.CASH_UP
    ? previous
    : (plan.current.source === SALES_SOURCE.CASH_UP ? current : null);
  const foodicsPeriod = plan.current.source === SALES_SOURCE.CASH_UP ? previous : current;
  return {
    ...route,
    vaultPeriod: cashUpPeriod,
    vaultCompare: null,
    foodicsPeriod,
    queryFocus: null,
    performanceOverview: false,
  };
}

async function fetchSide(
  supabase: SupabaseClient,
  side: { token: string; source: string },
  period: VaultPeriod,
  context: Record<string, unknown>,
  referenceDate: Date,
) {
  if (side.source === SALES_SOURCE.CASH_UP) {
    const result = await runVaultQueryTool(supabase, "vault_cash_up_summary", {
      ...context,
      question: `sales ${side.token}`,
      vaultPeriod: period,
      vaultCompare: null,
      suppressVaultCompare: true,
      mixedSalesSide: "locked",
      salesSource: SALES_SOURCE.CASH_UP,
      queryFocus: null,
      performanceOverview: false,
      referenceDate,
    }) as Record<string, unknown>;
    return { value: cashUpValue(result, context.branch || context.branchMention), raw: result };
  }
  const result = await getFoodicsSalesSummary(supabase, {
    ...context,
    question: `foodics sales ${side.token}`,
    foodicsPeriod: period,
  }) as Record<string, unknown>;
  return { value: foodicsValue(result), raw: result };
}

export async function executeMixedTodayYesterdaySales(
  supabase: SupabaseClient,
  context: Record<string, unknown> = {},
) {
  const referenceDate = context.referenceDate instanceof Date && !Number.isNaN(context.referenceDate.getTime())
    ? context.referenceDate
    : new Date();
  const plan = resolveSalesComparison(String(context.question || "")) || TODAY_YESTERDAY;
  const profile = context.profile as { allBranches?: boolean | null; branchScope?: string | null; allowedBranchIds?: string[] | null; authenticated?: boolean | null } | null | undefined;
  const filters = context.filters as { branch?: unknown } | undefined;
  const decision = authorizeSalesBranches(profile, {
    mentionedBranch: context.branchMention,
    filterBranch: filters?.branch || context.branch,
  });

  if (!decision.ok) {
    return {
      authorizationDenied: true,
      deniedBranch: decision.deniedBranch,
      allowedBranches: decision.allowedBranches,
      facts: [],
      aggregation: null,
      comparison: null,
    };
  }

  const branches = decision.branches.length ? decision.branches : [null];
  const currentPeriod = parseVaultPeriodFromQuestion(plan.current.token, referenceDate) as VaultPeriod;
  const previousPeriod = parseVaultPeriodFromQuestion(plan.previous.token, referenceDate) as VaultPeriod;
  const currentRows: Array<{ branch: string | null; value: number | null }> = [];
  const previousRows: Array<{ branch: string | null; value: number | null }> = [];
  const cashUpFacts: Record<string, unknown>[] = [];
  let firstCurrent: Record<string, unknown> | null = null;
  let firstPrevious: Record<string, unknown> | null = null;

  for (const branch of branches) {
    const scoped = branch
      ? {
        ...context,
        branchMention: branch,
        branch,
        filters: { ...(filters || {}), branch },
      }
      : context;
    const current = await fetchSide(supabase, plan.current, currentPeriod, scoped, referenceDate);
    const previous = await fetchSide(supabase, plan.previous, previousPeriod, scoped, referenceDate);
    if (!firstCurrent) firstCurrent = current.raw;
    if (!firstPrevious) firstPrevious = previous.raw;
    if (plan.previous.source === SALES_SOURCE.CASH_UP) cashUpFacts.push(...((previous.raw?.facts as Record<string, unknown>[]) || []));
    if (plan.current.source === SALES_SOURCE.CASH_UP) cashUpFacts.push(...((current.raw?.facts as Record<string, unknown>[]) || []));
    currentRows.push({ branch, value: current.value });
    previousRows.push({ branch, value: previous.value });
  }

  return {
    mixedSalesComparison: true,
    comparison: {
      companyWide: decision.companyWide,
      authorizedBranches: branches.filter(Boolean),
      sides: [
        { label: plan.current.label, date: periodDate(currentPeriod), source: plan.current.source, branches: currentRows },
        { label: plan.previous.label, date: periodDate(previousPeriod), source: plan.previous.source, branches: previousRows },
      ],
    },
    todayPeriod: currentPeriod,
    yesterdayPeriod: previousPeriod,
    foodicsToday: plan.current.source === SALES_SOURCE.CASH_UP ? null : firstCurrent,
    cashUpYesterday: plan.previous.source === SALES_SOURCE.CASH_UP
      ? { ...(firstPrevious || {}), facts: cashUpFacts, canonicalTotal: canonicalCashUpSales(cashUpFacts) }
      : null,
    facts: cashUpFacts.length ? cashUpFacts : ((firstPrevious?.facts as unknown[]) || []),
    aggregation: null,
  };
}
