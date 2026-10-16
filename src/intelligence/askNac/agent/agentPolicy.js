/**
 * Pure policy for Ask NAC's bounded agent.
 * Numbers come from tool evidence. Conversation context is an anchor, not a fact.
 */

const BRANCH_IDS = ["khobar", "riyadh", "jeddah"];
const TOOLS = ["delivery_summary", "cash_up_summary", "weekday_series", "coverage_status"];
const MONTHS = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

export const AGENT_LIMITS = Object.freeze({
  maxModelRounds: 3,
  maxToolCalls: 4,
  maxTokens: 700,
  contextMaxChars: 6000,
  retentionDays: 30,
  maxWeekdaySteps: 16,
});

export function isGreetingOnly(question) {
  const q = String(question || "")
    .trim()
    .toLowerCase()
    .replace(/[!.,?]+/g, "")
    .replace(/\s+/g, " ");
  return /^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you)$/.test(q);
}

export function buildGreetingAnswer() {
  return {
    answerType: "conversation",
    title: "Hello",
    directAnswer: "Hello. I can look up sales, deliveries, covers, and logbook notes from the published Cash Up for the branches you are allowed to see. What would you like to know?",
    keyMetrics: [],
    insights: [],
    recommendations: [],
    confidence: "high",
    intent: "conversation",
    warnings: [],
    missingData: [],
    isAiGenerated: false,
  };
}

export function questionWantsDeliveryCountAndTotal(question) {
  const q = String(question || "").toLowerCase();
  const aboutDelivery = /\bdeliver(y|ies)\b/.test(q);
  const wantsCount = /\b(how many|number of|count|orders?|deliveries)\b/.test(q);
  const wantsMoney = /\b(how much|total|revenue|sales|sar)\b/.test(q);
  return aboutDelivery && wantsCount && wantsMoney;
}

export function deliveryAverageOrderValue(orders, sales) {
  const count = Number(orders);
  const amount = Number(sales);
  if (!Number.isFinite(count) || !Number.isFinite(amount) || count <= 0) return null;
  return Math.round((amount / count) * 100) / 100;
}

function formatSar(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 100) / 100;
  const [whole, frac] = rounded.toFixed(2).split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === "00" ? `SAR ${withCommas}` : `SAR ${withCommas}.${frac}`;
}

function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return String(Math.round(n));
}

export function composeDeliveryCountAndRevenue({
  branchLabel = "The branch",
  periodLabel = "the period",
  orders = null,
  sales = null,
  coverageStart = null,
  coverageEnd = null,
  platforms = null,
} = {}) {
  if (orders == null && sales == null) {
    return {
      text: `Delivery orders and delivery revenue are not available for ${branchLabel} over ${periodLabel}.`,
      metrics: [],
      evidenceNumbers: [],
      complete: false,
    };
  }
  const aov = deliveryAverageOrderValue(orders, sales);
  const orderText = orders == null ? "Delivery order count is not available." : `${formatCount(orders)} delivery orders`;
  const salesText = sales == null ? "Delivery revenue is not available." : `${formatSar(sales)} delivery revenue`;
  const aovText = aov == null ? "" : ` Average delivery order value is ${formatSar(aov)}.`;
  const coverage = coverageStart && coverageEnd
    ? ` Published Cash Up covers ${coverageStart} through ${coverageEnd}.`
    : "";
  const platformText = formatPlatformLines(platforms);
  const text = `${branchLabel}, ${periodLabel}: ${orderText}. ${salesText}.${aovText}${coverage}${platformText}`.replace(/\s+/g, " ").trim();
  const evidenceNumbers = [orders, sales, aov]
    .filter((value) => value != null && Number.isFinite(Number(value)))
    .map((value) => Number(value));
  for (const key of ["jahez", "chefz", "keeta", "hunger"]) {
    const row = platforms?.[key];
    if (!row) continue;
    if (row.orders != null) evidenceNumbers.push(Number(row.orders));
    if (row.sales != null) evidenceNumbers.push(Number(row.sales));
  }
  return {
    text,
    metrics: [
      orders != null ? { label: "Delivery orders", value: Number(orders), unit: "orders", source: "cash_up" } : null,
      sales != null ? { label: "Delivery revenue", value: Number(sales), unit: "SAR", source: "cash_up" } : null,
      aov != null ? { label: "Average delivery order value", value: aov, unit: "SAR", source: "cash_up" } : null,
    ].filter(Boolean),
    evidenceNumbers,
    complete: orders != null && sales != null,
  };
}

function formatPlatformLines(platforms) {
  if (!platforms || typeof platforms !== "object") return "";
  const order = ["jahez", "chefz", "keeta", "hunger"];
  const parts = [];
  for (const key of order) {
    const row = platforms[key];
    if (!row) continue;
    const orders = row.orders ?? row.orderCount;
    const sales = row.sales ?? row.revenue;
    if (orders == null && sales == null) continue;
    const label = key[0].toUpperCase() + key.slice(1);
    parts.push(`${label} ${orders ?? "n/a"} orders, ${sales == null ? "revenue n/a" : formatSar(sales)}`);
  }
  return parts.length ? ` By platform: ${parts.join("; ")}.` : "";
}

export function addCalendarDays(isoDate, days) {
  const [year, month, day] = String(isoDate).split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function isSameWeekdayBackQuestion(question) {
  const q = String(question || "").toLowerCase();
  return /week before/.test(q) && /(until|through|up to|start of|beginning of)/.test(q);
}

export function untilDateFromQuestion(question, anchorDate) {
  const q = String(question || "").toLowerCase();
  const year = String(anchorDate || "").slice(0, 4);
  if (!/^\d{4}$/.test(year)) return null;
  const match = q.match(/\b(?:start|beginning) of ([a-z]+)/);
  if (!match) return null;
  const month = MONTHS[match[1]];
  return month ? `${year}-${month}-01` : null;
}

export function sameWeekdaySeries(anchorDate, untilDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(anchorDate || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(untilDate || ""))) {
    return [];
  }
  if (untilDate > anchorDate) return [];
  const dates = [];
  let cursor = anchorDate;
  while (cursor >= untilDate && dates.length < AGENT_LIMITS.maxWeekdaySteps) {
    dates.push(cursor);
    cursor = addCalendarDays(cursor, -7);
  }
  return dates;
}

export function resolveAnchorDate(context) {
  const period = context?.activeState?.period || context?.activeState?.vaultPeriod || null;
  if (period?.startDate && period?.endDate && period.startDate === period.endDate) return period.endDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(context?.anchorDate || ""))) return context.anchorDate;
  return null;
}

export function branchIdFromText(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("khobar")) return "khobar";
  if (text.includes("riyadh")) return "riyadh";
  if (text.includes("jeddah") || text.includes("jedda")) return "jeddah";
  return null;
}

export function authorizeToolCall({ tool, args = {}, allowedBranchIds = [], allBranches = false } = {}) {
  if (!TOOLS.includes(tool)) return { ok: false, error: "tool_not_allowed" };
  const branch = args.branch ? branchIdFromText(args.branch) || String(args.branch).toLowerCase() : null;
  if (branch && !BRANCH_IDS.includes(branch)) return { ok: false, error: "unknown_branch" };
  if (branch && !allBranches && !(allowedBranchIds || []).map((id) => String(id).toLowerCase()).includes(branch)) {
    return { ok: false, error: "branch_denied" };
  }
  const dates = [args.startDate, args.endDate, args.anchorDate, args.untilDate, ...(args.dates || [])].filter(Boolean);
  if (dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(String(date)))) {
    return { ok: false, error: "invalid_date" };
  }
  return { ok: true, args: { ...args, branch } };
}

function numbersInText(text) {
  const found = [];
  const source = String(text || "").replace(/\b20\d{2}-\d{2}-\d{2}\b/g, " ");
  const matches = source.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\d+/g) || [];
  for (const match of matches) {
    const value = Number(match.replace(/,/g, ""));
    if (Number.isFinite(value)) found.push(value);
  }
  return found;
}

export function verifyAnswerAgainstEvidence(answer, evidenceNumbers = []) {
  const allowed = new Set((evidenceNumbers || []).map((value) => Number(value)));
  const years = new Set([2024, 2025, 2026, 2027, 2028]);
  const invented = numbersInText(answer).filter((value) => {
    if (years.has(value)) return false;
    if (value >= 1 && value <= 31 && allowed.has(value)) return false;
    return !allowed.has(value);
  });
  return {
    ok: invented.length === 0,
    invented,
  };
}

export function boundConversationContext(context = {}) {
  const anchorDate = resolveAnchorDate(context);
  const bounded = {
    lastQuestion: clip(context.lastQuestion, 300),
    lastResolvedQuestion: clip(context.lastResolvedQuestion, 300),
    lastIntent: context.lastIntent || null,
    lastBranch: context.lastBranch || null,
    lastPeriod: typeof context.lastPeriod === "string" ? clip(context.lastPeriod, 120) : null,
    lastMetric: context.lastMetric || null,
    anchorDate,
    anchorBranch: branchIdFromText(context.anchorBranch || context.lastBranch) || context.anchorBranch || null,
    anchorMetric: context.anchorMetric || context.lastMetric || null,
    activeState: {
      period: context.activeState?.period || null,
      vaultPeriod: context.activeState?.vaultPeriod || null,
      branch: context.activeState?.branch || null,
      metric: context.activeState?.metric || null,
    },
  };
  const encoded = JSON.stringify(bounded);
  if (encoded.length <= AGENT_LIMITS.contextMaxChars) return bounded;
  return {
    lastQuestion: bounded.lastQuestion,
    anchorDate: bounded.anchorDate,
    anchorBranch: bounded.anchorBranch,
    anchorMetric: bounded.anchorMetric,
  };
}

function clip(value, max) {
  if (!value) return null;
  const text = String(value);
  return text.length > max ? text.slice(0, max) : text;
}

export function contextIsNotFinancialEvidence(context) {
  return boundConversationContext(context).lastAnswerSummary == null
    && boundConversationContext(context).lastDataset == null;
}

export function buildWeekdayComparisonText({
  branchLabel,
  metricLabel,
  dates,
  rowsByDate,
}) {
  const lines = [];
  const evidenceNumbers = [];
  const missing = [];
  for (const date of dates) {
    const row = rowsByDate[date];
    if (!row || (row.orders == null && row.sales == null && row.value == null)) {
      missing.push(date);
      lines.push(`${date}: not published.`);
      continue;
    }
    if (row.orders != null || row.sales != null) {
      if (row.orders != null) evidenceNumbers.push(Number(row.orders));
      if (row.sales != null) evidenceNumbers.push(Number(row.sales));
      lines.push(`${date}: ${row.orders == null ? "orders n/a" : `${formatCount(row.orders)} orders`}, ${row.sales == null ? "revenue n/a" : formatSar(row.sales)}.`);
    } else {
      evidenceNumbers.push(Number(row.value));
      lines.push(`${date}: ${formatSar(row.value) || formatCount(row.value)}.`);
    }
  }
  const complete = missing.length === 0 && dates.length > 0;
  const text = [
    `${branchLabel} ${metricLabel} on the same weekday, from ${dates[0]} back to ${dates[dates.length - 1]}. Source: published Cash Up. Each date was read again; the previous answer was not reused as a figure.`,
    ...lines,
    missing.length ? `Missing published Cash Up: ${missing.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
  return { text, evidenceNumbers, missing, complete };
}

export const AGENT_TOOL_CATALOG = [
  {
    name: "delivery_summary",
    description: "Delivery orders, delivery revenue, and average order value for one branch and date range. Uses the unscoped daily total, not the sum of platform rows plus the total.",
  },
  {
    name: "cash_up_summary",
    description: "Net sales, guests, and orders for one branch and date range from published Cash Up.",
  },
  {
    name: "weekday_series",
    description: "Same weekday stepped back seven days from an anchor date until a until-date, inclusive.",
  },
  {
    name: "coverage_status",
    description: "Which dates in a range have published Cash Up. Does not invent the missing days.",
  },
];
