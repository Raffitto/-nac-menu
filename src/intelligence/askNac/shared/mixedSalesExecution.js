/**
 * Execute a sales comparison as separate source queries.
 * Authorization runs before Foodics or Cash Up is touched.
 * Open periods use Foodics. Completed periods use Cash Up, unless the
 * question explicitly asks for Foodics on both sides. Sources are never added.
 */

import { parseVaultPeriodFromQuestion } from "../vault/vaultPeriodParser";
import { getFoodicsSalesSummary } from "../foodics/foodicsQueryTools";
import { runVaultQueryTool } from "../vault/vaultQueryTools";
import { authorizeSalesBranches } from "./salesBranchAuthorization";
import { SALES_SOURCE, isComparisonSalesSource, resolveSalesComparison } from "./salesSourcePolicy";

const TODAY_YESTERDAY = {
  kind: SALES_SOURCE.MIXED_TODAY_YESTERDAY,
  current: { token: "today", label: "Today", source: SALES_SOURCE.FOODICS_LIVE },
  previous: { token: "yesterday", label: "Yesterday", source: SALES_SOURCE.CASH_UP },
};

function finiteSales(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cashUpValue(result) {
  if (!result || result.authorizationDenied) return null;
  const facts = result.facts || [];
  const row = facts.find((fact) => fact.metricKey === "net_sales" || fact.metric_key === "net_sales");
  if (!row) return null;
  return finiteSales(row.metricValue ?? row.metric_value);
}

function foodicsValue(result) {
  if (!result || result.authorizationDenied || result.missingBatch || result.missingPeriod) return null;
  return finiteSales(result.totals?.netSales);
}

function periodDate(period) {
  if (!period?.startDate) return "the period";
  if (!period.endDate || period.endDate === period.startDate) return period.startDate;
  return `${period.startDate} to ${period.endDate}`;
}

export function lockMixedSalesRoute(route, referenceDate = new Date(), question) {
  if (!isComparisonSalesSource(route?.salesSource)) return route;
  const plan = resolveSalesComparison(question || route?.question || "") || TODAY_YESTERDAY;
  const current = parseVaultPeriodFromQuestion(plan.current.token, referenceDate);
  const previous = parseVaultPeriodFromQuestion(plan.previous.token, referenceDate);
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

async function fetchSide(supabase, side, period, context, referenceDate) {
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
    });
    return { value: cashUpValue(result), raw: result };
  }
  const result = await getFoodicsSalesSummary(supabase, {
    ...context,
    question: `foodics sales ${side.token}`,
    foodicsPeriod: period,
  });
  return { value: foodicsValue(result), raw: result };
}

export async function executeMixedTodayYesterdaySales(supabase, context = {}) {
  const referenceDate = context.referenceDate instanceof Date && !Number.isNaN(context.referenceDate.getTime())
    ? context.referenceDate
    : new Date();
  const plan = resolveSalesComparison(context.question || "") || TODAY_YESTERDAY;
  const decision = authorizeSalesBranches(context.profile, {
    mentionedBranch: context.branchMention,
    filterBranch: context.filters?.branch || context.branch,
  });

  if (context.profile && !decision.ok) {
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
  const currentPeriod = parseVaultPeriodFromQuestion(plan.current.token, referenceDate);
  const previousPeriod = parseVaultPeriodFromQuestion(plan.previous.token, referenceDate);
  const currentRows = [];
  const previousRows = [];
  let firstCurrent = null;
  let firstPrevious = null;

  for (const branch of branches) {
    const scoped = branch
      ? {
        ...context,
        branchMention: branch,
        branch,
        filters: { ...(context.filters || {}), branch },
      }
      : context;
    const current = await fetchSide(supabase, plan.current, currentPeriod, scoped, referenceDate);
    const previous = await fetchSide(supabase, plan.previous, previousPeriod, scoped, referenceDate);
    if (!firstCurrent) firstCurrent = current.raw;
    if (!firstPrevious) firstPrevious = previous.raw;
    currentRows.push({ branch, value: current.value });
    previousRows.push({ branch, value: previous.value });
  }

  const comparison = {
    companyWide: decision.companyWide,
    authorizedBranches: branches.filter(Boolean),
    sides: [
      {
        label: plan.current.label,
        date: periodDate(currentPeriod),
        source: plan.current.source,
        branches: currentRows,
      },
      {
        label: plan.previous.label,
        date: periodDate(previousPeriod),
        source: plan.previous.source,
        branches: previousRows,
      },
    ],
  };

  return {
    mixedSalesComparison: true,
    comparison,
    todayPeriod: currentPeriod,
    yesterdayPeriod: previousPeriod,
    foodicsToday: plan.current.source === SALES_SOURCE.CASH_UP ? null : firstCurrent,
    cashUpYesterday: plan.previous.source === SALES_SOURCE.CASH_UP ? firstPrevious : null,
    facts: firstPrevious?.facts || [],
    aggregation: null,
  };
}
