/**
 * Canonical sales-source policy for both Ask NAC routers.
 * src/intelligence/askNac/intentRouter.js and
 * supabase/functions/_shared/askNacOrchestrator.ts must import this file's twin.
 * The two copies are kept identical; salesSourcePolicy.test.js fails if they drift.
 */

export const SALES_SOURCE = Object.freeze({
  CASH_UP: "cash_up",
  FOODICS_LIVE: "foodics_live",
  FOODICS_OPERATIONAL: "foodics_operational",
  MIXED_TODAY_YESTERDAY: "mixed_today_yesterday",
  UNSPECIFIED: "unspecified",
});

const MONTH = "(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)";

function normalizeSalesQuestion(question) {
  return String(question || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\byesterdays\b/g, "yesterday")
    .replace(/\btodays\b/g, "today")
    .replace(/\bso far today\b/g, "today")
    .replace(/\bhow much have we sold\b/g, "sales")
    .replace(/\b(khobar|riyadh|jeddah|al khobar|alkhobar|nac)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isOperationalMetric(q) {
  if (/\bpurchase orders?\b/.test(q)) return false;
  if (/\baverage spend per guest\b/.test(q)) return false;
  const metric = /\b(items?\s+sold|product performance|waiter sales|waiter performance|orders|covers|average check|avg check|average spend|avg spend)\b/;
  if (/\bcovers\b/.test(q) && /\b(reception|reservations?|walk-?ins?|no-?shows?)\b/.test(q)) {
    return /\b(items?\s+sold|product performance|waiter sales|waiter performance|orders|average check|avg check|average spend|avg spend)\b/.test(q);
  }
  return metric.test(q);
}

function isSplitSalesQuestion(q) {
  return /\b(category|categories|top|by branch|each branch|per branch|which branch|branch sales|best sellers?|sold most)\b/.test(q);
}

function isFinancialSales(q) {
  return /\b(net sales|gross sales|sales|revenue)\b/.test(q);
}

function isCurrentDay(q) {
  return /\b(today|this week|this month|month to date|mtd)\b/.test(q);
}

function isCompletedPeriod(q) {
  return new RegExp(`\\b(yesterday|last week|last month|previous week|previous month|last \\d+ days|${MONTH})\\b`).test(q)
    || /\b20\d{2}-\d{2}-\d{2}\b/.test(q)
    || /\bon\s+\d{1,2}\b/.test(q);
}

export function selectSalesSource(question) {
  const q = normalizeSalesQuestion(question);
  if (!q) return SALES_SOURCE.UNSPECIFIED;
  if (isOperationalMetric(q)) return SALES_SOURCE.FOODICS_OPERATIONAL;
  if (isSplitSalesQuestion(q)) return SALES_SOURCE.UNSPECIFIED;
  if (/\bfoodics\b/.test(q) && isFinancialSales(q)) return SALES_SOURCE.FOODICS_LIVE;
  if (isFinancialSales(q) && /\btoday\b/.test(q) && /\byesterday\b/.test(q) && /\b(vs|versus|compared|compare)\b/.test(q)) {
    return SALES_SOURCE.MIXED_TODAY_YESTERDAY;
  }
  if (isFinancialSales(q) && isCurrentDay(q) && !/\byesterday\b/.test(q)) {
    return SALES_SOURCE.FOODICS_LIVE;
  }
  if (isFinancialSales(q) && isCompletedPeriod(q) && !/\btoday\b/.test(q)) {
    return SALES_SOURCE.CASH_UP;
  }
  return SALES_SOURCE.UNSPECIFIED;
}

export function mixedSalesComparisonLabel(cashUpAvailable) {
  const yesterday = cashUpAvailable
    ? "Yesterday is official Cash Up."
    : "Yesterday's official Cash Up is unavailable. Foodics was not substituted for that side.";
  return `Today is Foodics operational/live sales. ${yesterday} These sources are not accounting equivalents and are not added together.`;
}
