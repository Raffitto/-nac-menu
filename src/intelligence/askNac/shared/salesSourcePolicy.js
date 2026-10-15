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
  FOODICS_COMPARISON: "foodics_comparison",
  MIXED_TODAY_YESTERDAY: "mixed_today_yesterday",
  MIXED_OPEN_VS_COMPLETED: "mixed_open_vs_completed",
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
  if (/\b(order counts?|number of orders|how many orders)\b/.test(q)) return true;
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

function isMixedTodayYesterdayComparison(q) {
  if (isOperationalMetric(q) || isSplitSalesQuestion(q) || !isFinancialSales(q)) return false;
  if (/\bfoodics\b/.test(q)) return false;
  if (!/\btoday\b/.test(q) || !/\byesterday\b/.test(q)) return false;
  return /\b(vs|versus|compared|compare|comparison|against)\b/.test(q);
}

export function isComparisonSalesSource(source) {
  return source === SALES_SOURCE.MIXED_TODAY_YESTERDAY
    || source === SALES_SOURCE.MIXED_OPEN_VS_COMPLETED
    || source === SALES_SOURCE.FOODICS_COMPARISON;
}

function comparisonSide(token, label, source) {
  return { token, label, source };
}

/**
 * Period tokens only. Dates stay in parseVaultPeriodFromQuestion.
 * Explicit Foodics is decided before the mixed today/yesterday path.
 */
export function resolveSalesComparison(question) {
  const q = normalizeSalesQuestion(question);
  const compare = /\b(vs|versus|compared|compare|comparison|against)\b/.test(q);
  if (!compare || isOperationalMetric(q) || isSplitSalesQuestion(q)) return null;
  const explicitFoodics = /\bfoodics\b/.test(q) && isFinancialSales(q);
  if (explicitFoodics && /\btoday\b/.test(q) && /\byesterday\b/.test(q)) {
    return {
      kind: SALES_SOURCE.FOODICS_COMPARISON,
      current: comparisonSide("today", "Today", SALES_SOURCE.FOODICS_LIVE),
      previous: comparisonSide("yesterday", "Yesterday", SALES_SOURCE.FOODICS_LIVE),
    };
  }
  if (explicitFoodics && /\bthis week\b/.test(q) && /\blast week\b/.test(q)) {
    return {
      kind: SALES_SOURCE.FOODICS_COMPARISON,
      current: comparisonSide("this week", "This week", SALES_SOURCE.FOODICS_LIVE),
      previous: comparisonSide("last week", "Last week", SALES_SOURCE.FOODICS_LIVE),
    };
  }
  if (explicitFoodics && /\b(this month|month to date|mtd)\b/.test(q) && /\b(last month|previous month)\b/.test(q)) {
    return {
      kind: SALES_SOURCE.FOODICS_COMPARISON,
      current: comparisonSide("this month", "This month", SALES_SOURCE.FOODICS_LIVE),
      previous: comparisonSide("last month", "Last month", SALES_SOURCE.FOODICS_LIVE),
    };
  }
  if (/\bthis week\b/.test(q) && /\blast week\b/.test(q)) {
    return {
      kind: SALES_SOURCE.MIXED_OPEN_VS_COMPLETED,
      current: comparisonSide("this week", "This week", SALES_SOURCE.FOODICS_LIVE),
      previous: comparisonSide("last week", "Last week", SALES_SOURCE.CASH_UP),
    };
  }
  if (/\b(this month|month to date|mtd)\b/.test(q) && /\b(last month|previous month)\b/.test(q)) {
    return {
      kind: SALES_SOURCE.MIXED_OPEN_VS_COMPLETED,
      current: comparisonSide("this month", "This month", SALES_SOURCE.FOODICS_LIVE),
      previous: comparisonSide("last month", "Last month", SALES_SOURCE.CASH_UP),
    };
  }
  if (isMixedTodayYesterdayComparison(q)) {
    return {
      kind: SALES_SOURCE.MIXED_TODAY_YESTERDAY,
      current: comparisonSide("today", "Today", SALES_SOURCE.FOODICS_LIVE),
      previous: comparisonSide("yesterday", "Yesterday", SALES_SOURCE.CASH_UP),
    };
  }
  return null;
}

const BRANCH_LABEL = { khobar: "Khobar", riyadh: "Riyadh", jeddah: "Jeddah" };

function branchLabel(id) {
  return BRANCH_LABEL[id] || id || "the branch";
}

function sourcePhrase(source) {
  return source === SALES_SOURCE.CASH_UP ? "official Cash Up" : "Foodics operational/live";
}

function sideSentence(side) {
  const phrase = sourcePhrase(side.source);
  const branches = side.branches || [];
  if (branches.length <= 1) {
    const row = branches[0];
    const name = branchLabel(row?.branch);
    const text = formatSalesFigure(row?.value);
    if (text == null) {
      return side.source === SALES_SOURCE.CASH_UP
        ? `${side.label} (${side.date}) ${name} official Cash Up is unavailable. Foodics was not substituted for that side.`
        : `${side.label} (${side.date}) ${name} Foodics operational/live sales are unavailable. No figure was substituted.`;
    }
    return `${side.label} (${side.date}) ${name} ${phrase} sales: ${text} SAR. This is a ${name} figure, not a company total.`;
  }
  const parts = branches.map((row) => {
    const text = formatSalesFigure(row?.value);
    const name = branchLabel(row?.branch);
    return text == null ? `${name} unavailable` : `${name} ${text} SAR`;
  });
  const complete = branches.every((row) => formatSalesFigure(row?.value) != null);
  const coverage = complete
    ? ` Company ${phrase} total: ${formatSalesFigure(branches.reduce((sum, row) => sum + Number(row.value), 0))} SAR.`
    : ` Company ${phrase} total is not shown because branch coverage is incomplete.`;
  return `${side.label} (${side.date}) ${phrase} sales by branch: ${parts.join(". ")}.${coverage}`;
}

export function describeAuthorizedSalesComparison(comparison) {
  const sides = comparison?.sides || [];
  const mixedSources = new Set(sides.map((side) => side.source)).size > 1;
  const disclaimer = mixedSources
    ? "Operational and accounting figures may not be directly comparable. These sources are not added together."
    : "These Foodics periods are shown separately and are not added together.";
  return `${sides.map(sideSentence).join(" ")} ${disclaimer}`.trim();
}

/** Today and yesterday stay separate sources. Callers must not collapse this to one. */
export function mixedSalesSides() {
  return Object.freeze({
    comparison: SALES_SOURCE.MIXED_TODAY_YESTERDAY,
    today: SALES_SOURCE.FOODICS_LIVE,
    yesterday: SALES_SOURCE.CASH_UP,
  });
}

function cashUpFactRank(fact) {
  const key = fact.metricKey || fact.metric_key;
  const metric = key === "net_sales" ? 3 : key === "total_sales" ? 2 : key === "gross_sales" ? 1 : 0;
  const versioned = fact.fileVersionId || fact.file_version_id ? 1 : 0;
  const workbook = /^pdf-day/i.test(String(fact.sourceRowRef || fact.source_row_ref || "")) ? 0 : 1;
  const created = Date.parse(fact.createdAt || fact.created_at || "") || 0;
  return [metric, versioned, workbook, created];
}

function cashUpBranchKey(fact) {
  const raw = String(fact?.branchId || fact?.branch_id || "").toLowerCase();
  if (raw.includes("khobar")) return "khobar";
  if (raw.includes("riyadh")) return "riyadh";
  if (raw.includes("jeddah") || raw.includes("jedda")) return "jeddah";
  return raw;
}

/** One canonical sales figure per branch and business date, then the sum. Revisions are not added. */
export function canonicalCashUpSales(facts, onlyBranch) {
  const wanted = onlyBranch ? cashUpBranchKey({ branch_id: onlyBranch }) : "";
  const chosen = new Map();
  for (const fact of facts || []) {
    const rank = cashUpFactRank(fact);
    if (!rank[0]) continue;
    const value = Number(fact.metricValue ?? fact.metric_value);
    if (!Number.isFinite(value)) continue;
    const branch = cashUpBranchKey(fact);
    if (wanted && branch !== wanted) continue;
    const date = String(fact.periodEnd || fact.period_end || fact.periodStart || fact.period_start || "").slice(0, 10);
    const slot = `${branch}|${date}`;
    const prev = chosen.get(slot);
    if (!prev) {
      chosen.set(slot, { rank, value });
      continue;
    }
    for (let i = 0; i < rank.length; i += 1) {
      if (rank[i] === prev.rank[i]) continue;
      if (rank[i] > prev.rank[i]) chosen.set(slot, { rank, value });
      break;
    }
  }
  if (!chosen.size) return null;
  let sum = 0;
  for (const row of chosen.values()) sum += row.value;
  return sum;
}

export function formatSalesFigure(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString("en-US");
}

export function describeMixedSalesResult({ todayDate, yesterdayDate, todayNetSales, yesterdayNetSales }) {
  const todayText = formatSalesFigure(todayNetSales);
  const yesterdayText = formatSalesFigure(yesterdayNetSales);
  const todayLine = todayText == null
    ? `Today (${todayDate}) Foodics operational/live sales are unavailable. No figure was substituted.`
    : `Today (${todayDate}) Foodics operational/live sales: ${todayText} SAR.`;
  const yesterdayLine = yesterdayText == null
    ? `Yesterday (${yesterdayDate}) official Cash Up is unavailable. Foodics was not substituted for that side.`
    : `Yesterday (${yesterdayDate}) official Cash Up sales: ${yesterdayText} SAR.`;
  return {
    todayText,
    yesterdayText,
    directAnswer: `${todayLine} ${yesterdayLine} Operational and accounting figures may not be directly comparable. These sources are not added together.`,
  };
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
  const comparison = resolveSalesComparison(question);
  if (comparison) return comparison.kind;
  if (isOperationalMetric(q)) return SALES_SOURCE.FOODICS_OPERATIONAL;
  if (isSplitSalesQuestion(q)) return SALES_SOURCE.UNSPECIFIED;
  if (/\bfoodics\b/.test(q) && isFinancialSales(q)) return SALES_SOURCE.FOODICS_LIVE;
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
