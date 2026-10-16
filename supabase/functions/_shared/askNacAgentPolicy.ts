/**
 * Edge copy of src/intelligence/askNac/agent/agentPolicy.js.
 * Keep the two in step. The Jest file is the behavior spec.
 */

export const AGENT_LIMITS = Object.freeze({
  maxModelRounds: 3,
  maxToolCalls: 4,
  maxTokens: 700,
  contextMaxChars: 6000,
  retentionDays: 30,
  maxWeekdaySteps: 16,
});

const BRANCH_IDS = ["khobar", "riyadh", "jeddah"];
const TOOLS = [
  "delivery_summary",
  "cash_up_summary",
  "weekday_series",
  "coverage_status",
  "branch_compare",
  "period_compare",
  "logbook_summary",
  "menu_performance",
  "google_reviews",
  "knowledge_search",
  "operational_day",
  "uploaded_product_sales",
];
const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

export function isGreetingOnly(question: string) {
  const q = String(question || "").trim().toLowerCase().replace(/[!.,?]+/g, "").replace(/\s+/g, " ");
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

export function questionWantsDeliveryBreakdown(question: string) {
  const q = String(question || "").toLowerCase();
  return /\bdeliver/.test(q) && /\bplatform/.test(q);
}

export function questionWantsDeliveryCountAndTotal(question: string) {
  const q = String(question || "").toLowerCase();
  const aboutDelivery = /\bdeliver(y|ies)\b/.test(q);
  const wantsCount = /\b(how many|number of|count|orders?|deliveries)\b/.test(q);
  const wantsMoney = /\b(how much|total|revenue|sales|sar)\b/.test(q);
  return aboutDelivery && wantsCount && wantsMoney;
}

export function deliveryAverageOrderValue(orders: unknown, sales: unknown) {
  const count = Number(orders);
  const amount = Number(sales);
  if (!Number.isFinite(count) || !Number.isFinite(amount) || count <= 0) return null;
  return Math.round((amount / count) * 100) / 100;
}

function formatSar(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 100) / 100;
  const [whole, frac] = rounded.toFixed(2).split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === "00" ? `SAR ${withCommas}` : `SAR ${withCommas}.${frac}`;
}

function formatCount(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return String(Math.round(n));
}

export function composeDeliveryCountAndRevenue(input: {
  branchLabel?: string;
  periodLabel?: string;
  orders?: number | null;
  sales?: number | null;
  coverageStart?: string | null;
  coverageEnd?: string | null;
  platforms?: Record<string, { orders?: number | null; sales?: number | null }> | null;
} = {}) {
  const branchLabel = input.branchLabel || "The branch";
  const periodLabel = input.periodLabel || "the period";
  const orders = input.orders ?? null;
  const sales = input.sales ?? null;
  if (orders == null && sales == null) {
    return {
      text: `Delivery orders and delivery revenue are not available for ${branchLabel} over ${periodLabel}.`,
      metrics: [] as Array<Record<string, unknown>>,
      evidenceNumbers: [] as number[],
      complete: false,
    };
  }
  const aov = deliveryAverageOrderValue(orders, sales);
  const orderText = orders == null ? "Delivery order count is not available." : `${formatCount(orders)} delivery orders`;
  const salesText = sales == null ? "Delivery revenue is not available." : `${formatSar(sales)} delivery revenue`;
  const aovText = aov == null ? "" : ` Average delivery order value is ${formatSar(aov)}.`;
  const coverage = input.coverageStart && input.coverageEnd
    ? ` Published Cash Up covers ${input.coverageStart} through ${input.coverageEnd}.`
    : "";
  const platformText = formatPlatformLines(input.platforms || null, orders, sales);
  const text = `${branchLabel}, ${periodLabel}: ${orderText}. ${salesText}.${aovText}${coverage}${platformText}`.replace(/\s+/g, " ").trim();
  const evidenceNumbers = [orders, sales, aov].filter((value) => value != null && Number.isFinite(Number(value))).map((value) => Number(value));
  const shownPlatforms = platformRowsForDisplay(input.platforms || null, orders, sales) || {};
  for (const key of ["jahez", "chefz", "keeta", "hunger"]) {
    const row = shownPlatforms[key];
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
    ].filter(Boolean) as Array<Record<string, unknown>>,
    evidenceNumbers,
    complete: orders != null && sales != null,
  };
}

export function platformRowsForDisplay(
  platforms: Record<string, { orders?: number | null; sales?: number | null; orderCount?: number | null; revenue?: number | null }> | null,
  combinedOrders: number | null = null,
  combinedSales: number | null = null,
) {
  if (!platforms) return null;
  const named: Record<string, { orders: number | null; sales: number | null }> = {};
  for (const key of ["jahez", "chefz", "keeta", "hunger"]) {
    const row = platforms[key];
    if (!row) continue;
    const orders = row.orders ?? row.orderCount ?? null;
    const sales = row.sales ?? row.revenue ?? null;
    if (orders == null && sales == null) continue;
    named[key] = { orders, sales };
  }
  const keys = Object.keys(named);
  if (keys.length === 1 && combinedOrders != null && combinedSales != null) {
    const only = named[keys[0]];
    if (Number(only.orders) === Number(combinedOrders) && Number(only.sales) === Number(combinedSales)) return null;
  }
  return keys.length ? named : null;
}

function formatPlatformLines(
  platforms: Record<string, { orders?: number | null; sales?: number | null }> | null,
  combinedOrders: number | null = null,
  combinedSales: number | null = null,
) {
  const named = platformRowsForDisplay(platforms, combinedOrders, combinedSales);
  if (!named) return "";
  const parts = [];
  for (const key of ["jahez", "chefz", "keeta", "hunger"]) {
    const row = named[key];
    if (!row) continue;
    const label = key[0].toUpperCase() + key.slice(1);
    parts.push(`${label} ${row.orders ?? "n/a"} orders, ${row.sales == null ? "revenue n/a" : formatSar(row.sales)}`);
  }
  return parts.length ? ` By platform: ${parts.join("; ")}.` : "";
}

export function addCalendarDays(isoDate: string, days: number) {
  const [year, month, day] = String(isoDate).split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function isSameWeekdayBackQuestion(question: string) {
  const q = String(question || "").toLowerCase();
  const stepsBack = /week before|every (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|same weekday/.test(q);
  const hasBound = /(until|through|up to|start of|beginning of|back to)/.test(q);
  return stepsBack && hasBound;
}

export function untilDateFromQuestion(question: string, anchorDate: string) {
  const q = String(question || "").toLowerCase();
  const year = String(anchorDate || "").slice(0, 4);
  if (!/^\d{4}$/.test(year)) return null;
  const match = q.match(/\b(?:start|beginning) of ([a-z]+)/);
  if (!match) return null;
  const month = MONTHS[match[1]];
  return month ? `${year}-${month}-01` : null;
}

export function sameWeekdaySeries(anchorDate: string, untilDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(anchorDate || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(untilDate || ""))) return [];
  if (untilDate > anchorDate) return [];
  const dates: string[] = [];
  let cursor = anchorDate;
  while (cursor >= untilDate && dates.length < AGENT_LIMITS.maxWeekdaySteps) {
    dates.push(cursor);
    cursor = addCalendarDays(cursor, -7);
  }
  return dates;
}

function riyadhYear(referenceDate = new Date()) {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric" }).format(referenceDate));
}

export function explicitDays(question: string, referenceDate = new Date()) {
  const q = String(question || "").toLowerCase();
  const year = Number((q.match(/\b(20\d{2})\b/) || [])[1] || riyadhYear(referenceDate));
  const monthPattern = "january|february|march|april|may|june|july|august|september|october|november|december";
  const re = new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b|\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\b`, "g");
  const found: string[] = [];
  let match = re.exec(q);
  while (match) {
    const monthName = match[1] || match[4];
    const day = Number(match[2] || match[3]);
    const month = MONTHS[monthName];
    if (month && day >= 1 && day <= 31) {
      const iso = `${year}-${month}-${String(day).padStart(2, "0")}`;
      if (!found.includes(iso)) found.push(iso);
    }
    match = re.exec(q);
  }
  return found;
}

export function explicitSingleDay(question: string, referenceDate = new Date()) {
  const days = explicitDays(question, referenceDate);
  return days.length === 1 ? days[0] : null;
}

export function retainSingleDayAnchor(
  previous: unknown,
  question: unknown,
  period: { startDate?: string; endDate?: string } | null = null,
  referenceDate = new Date(),
) {
  const named = explicitSingleDay(String(question || ""), referenceDate);
  if (named) return named;
  if (period?.startDate && period.startDate === period.endDate) return period.startDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(previous || ""))) return String(previous);
  return null;
}

export function questionRequiresRetrievedEvidence(question: string) {
  return /\b(why|sales|lower|higher|compare|revenue|orders|deliveries)\b/i.test(String(question || ""));
}

export function describeSalesDirection(
  subjectDate: string,
  subjectSales: number | null,
  otherDate: string,
  otherSales: number | null,
) {
  if (subjectSales == null || otherSales == null) {
    return `${subjectDate} or ${otherDate} has no published net sales, so I am not saying which day was lower.`;
  }
  const subject = Number(subjectSales);
  const other = Number(otherSales);
  const gap = Math.round(Math.abs(subject - other) * 100) / 100;
  const direction = subject > other
    ? `${subjectDate} was higher, not lower, than ${otherDate}`
    : subject < other
      ? `${subjectDate} was lower than ${otherDate}`
      : `${subjectDate} matched ${otherDate}`;
  return `${subjectDate} net sales were ${formatSar(subject)}. ${otherDate} net sales were ${formatSar(other)}. ${direction} by ${formatSar(gap)}. No cause is stated because none was measured.`;
}

export function resolveAnchorDate(context: Record<string, unknown> | null | undefined) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(context?.singleDayAnchor || ""))) return String(context?.singleDayAnchor);
  const active = (context?.activeState || {}) as { period?: { startDate?: string; endDate?: string }; vaultPeriod?: { startDate?: string; endDate?: string } };
  const period = active.vaultPeriod || active.period || null;
  if (period?.startDate && period?.endDate && period.startDate === period.endDate) return period.endDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(context?.anchorDate || ""))) return String(context?.anchorDate);
  return null;
}

export function branchIdFromText(value: unknown) {
  const text = String(value || "").toLowerCase();
  if (text.includes("khobar")) return "khobar";
  if (text.includes("riyadh")) return "riyadh";
  if (text.includes("jeddah") || text.includes("jedda")) return "jeddah";
  return null;
}

export function authorizeToolCall({
  tool,
  args = {},
  allowedBranchIds = [],
  allBranches = false,
}: {
  tool?: string;
  args?: Record<string, unknown>;
  allowedBranchIds?: string[];
  allBranches?: boolean;
} = {}) {
  if (!tool || !TOOLS.includes(tool)) return { ok: false as const, error: "tool_not_allowed", args };
  const branch = args.branch ? branchIdFromText(args.branch) || String(args.branch).toLowerCase() : null;
  if (branch && !BRANCH_IDS.includes(branch)) return { ok: false as const, error: "unknown_branch", args };
  const allowed = (allowedBranchIds || []).map((id) => String(id).toLowerCase());
  if (branch && !allBranches && !allowed.includes(branch)) return { ok: false as const, error: "branch_denied", args };
  const extraDates = Array.isArray(args.dates) ? args.dates : [];
  const dates = [args.startDate, args.endDate, args.anchorDate, args.untilDate, args.compareStart, args.compareEnd, ...extraDates].filter(Boolean);
  if (dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(String(date)))) {
    return { ok: false as const, error: "invalid_date", args };
  }
  const rawBranches = Array.isArray(args.branches) ? args.branches : [];
  const branchIds: string[] = [];
  for (const item of rawBranches) {
    const id = branchIdFromText(item) || String(item).toLowerCase();
    if (!BRANCH_IDS.includes(id)) return { ok: false as const, error: "unknown_branch", args };
    if (!allBranches && !allowed.includes(id)) return { ok: false as const, error: "branch_denied", args };
    branchIds.push(id);
  }
  if (args.hours != null) {
    const hours = Number(args.hours);
    if (!Number.isFinite(hours) || hours < 1 || hours > 744) return { ok: false as const, error: "invalid_hours", args };
  }
  if (args.searchTerms != null && /[;]|--|\/\*|\*\//.test(String(args.searchTerms))) {
    return { ok: false as const, error: "invalid_search", args };
  }
  return {
    ok: true as const,
    error: null,
    args: {
      ...args,
      branch,
      branches: branchIds,
      searchTerms: args.searchTerms ? String(args.searchTerms).slice(0, 80) : args.searchTerms,
    },
  };
}

function numbersInText(text: string) {
  const found: number[] = [];
  const source = String(text || "").replace(/\b20\d{2}-\d{2}-\d{2}\b/g, " ");
  const matches = source.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\d+/g) || [];
  for (const match of matches) {
    const value = Number(match.replace(/,/g, ""));
    if (Number.isFinite(value)) found.push(value);
  }
  return found;
}

export function verifyAnswerAgainstEvidence(answer: string, evidenceNumbers: number[] = []) {
  const allowed = new Set(evidenceNumbers.map((value) => Number(value)));
  const years = new Set([2024, 2025, 2026, 2027, 2028]);
  const invented = numbersInText(answer).filter((value) => {
    if (years.has(value)) return false;
    if (value >= 1 && value <= 31 && allowed.has(value)) return false;
    return !allowed.has(value);
  });
  return { ok: invented.length === 0, invented };
}

function clip(value: unknown, max: number) {
  if (!value) return null;
  const text = String(value);
  return text.length > max ? text.slice(0, max) : text;
}

export function boundConversationContext(context: Record<string, unknown> = {}) {
  const active = (context.activeState || {}) as Record<string, unknown>;
  const period = (active.vaultPeriod || active.period || null) as { startDate?: string; endDate?: string } | null;
  const singleDayAnchor = retainSingleDayAnchor(context.singleDayAnchor, context.lastQuestion, period);
  const anchorDate = singleDayAnchor || resolveAnchorDate({ ...context, singleDayAnchor });
  const history = Array.isArray(active.branchHistory)
    ? (active.branchHistory as unknown[]).map(String).filter((item) => ["khobar", "riyadh", "jeddah"].includes(item)).slice(-4)
    : [];
  const bounded = {
    lastQuestion: clip(context.lastQuestion, 300),
    lastResolvedQuestion: clip(context.lastResolvedQuestion, 300),
    lastIntent: context.lastIntent || null,
    lastBranch: context.lastBranch || null,
    lastPeriod: typeof context.lastPeriod === "string" ? clip(context.lastPeriod, 120) : null,
    lastMetric: context.lastMetric || null,
    singleDayAnchor,
    anchorDate,
    anchorBranch: branchIdFromText(context.anchorBranch || context.lastBranch) || context.anchorBranch || null,
    anchorMetric: context.anchorMetric || context.lastMetric || null,
    activeState: {
      period: active.period || null,
      vaultPeriod: active.vaultPeriod || null,
      branch: active.branch || null,
      branchHistory: history,
      metric: active.metric || null,
    },
  };
  if (JSON.stringify(bounded).length <= AGENT_LIMITS.contextMaxChars) return bounded;
  return {
    lastQuestion: bounded.lastQuestion,
    singleDayAnchor: bounded.singleDayAnchor,
    anchorDate: bounded.anchorDate,
    anchorBranch: bounded.anchorBranch,
    anchorMetric: bounded.anchorMetric,
    activeState: { branchHistory: history },
  };
}

export function buildWeekdayComparisonText({
  branchLabel,
  metricLabel,
  dates,
  rowsByDate,
}: {
  branchLabel: string;
  metricLabel: string;
  dates: string[];
  rowsByDate: Record<string, { orders?: number | null; sales?: number | null; value?: number | null } | undefined>;
}) {
  const lines: string[] = [];
  const evidenceNumbers: number[] = [];
  const missing: string[] = [];
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
    } else if (row.value != null) {
      evidenceNumbers.push(Number(row.value));
      lines.push(`${date}: ${formatSar(row.value) || formatCount(row.value)}.`);
    }
  }
  const text = [
    `${branchLabel} ${metricLabel} on the same weekday, from ${dates[0]} back to ${dates[dates.length - 1]}. Source: published Cash Up. Each date was read again; the previous answer was not reused as a figure.`,
    ...lines,
    missing.length ? `Missing published Cash Up: ${missing.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
  return { text, evidenceNumbers, missing, complete: missing.length === 0 && dates.length > 0 };
}

export const AGENT_TOOL_CATALOG = [
  { name: "delivery_summary", description: "Delivery orders, revenue, and average order value from published Cash Up. Daily total only." },
  { name: "cash_up_summary", description: "Net sales, guests, and orders from published Cash Up for one branch and date range." },
  { name: "weekday_series", description: "Same weekday stepped back seven days from an anchor date until a until-date." },
  { name: "coverage_status", description: "Which dates in a range have published Cash Up." },
  { name: "branch_compare", description: "Cash Up totals for two authorized branches over the same dates." },
  { name: "period_compare", description: "Cash Up totals for one branch over two date ranges." },
  { name: "logbook_summary", description: "Published daily logbook summary metrics for a branch and month range." },
  { name: "menu_performance", description: "Menu QR scans and sessions from the rollup. Does not include dish rankings." },
  { name: "google_reviews", description: "Stored Google review snapshot count and rating for one authorized branch." },
  { name: "knowledge_search", description: "Keyword search of company knowledge documents. Not a SQL query." },
  { name: "operational_day", description: "Cash Up and logbook for one business date." },
  { name: "uploaded_product_sales", description: "Uploaded waiter and product sales file, if one exists. Not a live Foodics feed." },
];

export function shouldInvestigateWithAgent(question: string, intent?: string | null) {
  if (isGreetingOnly(question)) return false;
  if (questionWantsDeliveryCountAndTotal(question)) return false;
  if (isSameWeekdayBackQuestion(question)) return false;
  if (intent === "unknown") return true;
  const q = String(question || "").toLowerCase();
  if (/\bwhy\b/.test(q)) return true;
  if (/\bwhat happened\b/.test(q)) return true;
  if (/\b(promote|which dishes?)\b/.test(q)) return true;
  if (/\bcompare\b/.test(q) && /\b(branch|khobar|riyadh|jeddah)\b/.test(q)) return true;
  return false;
}

export function completenessGaps(question: string, answer: string, toolsUsed: string[] = []) {
  const q = String(question || "").toLowerCase();
  const text = String(answer || "").toLowerCase();
  const gaps: string[] = [];
  const saysMissing = /not available|not published|do not have|cannot|no uploaded|not in this/.test(text);
  if (/\bdeliver/.test(q) && /\b(how many|orders|deliveries)\b/.test(q) && !/\border/.test(text) && !saysMissing) gaps.push("orders");
  if (/\bdeliver/.test(q) && /\b(how much|revenue|total|sales)\b/.test(q) && !/\b(revenue|sar)\b/.test(text) && !saysMissing) gaps.push("revenue");
  if (/\bwhy\b/.test(q) && !/\b(because|hypothesis|logbook|review|menu|not published|do not have|cannot explain)\b/.test(text)) gaps.push("cause");
  if (/\b(promote|which dishes?)\b/.test(q) && !toolsUsed.includes("menu_performance") && !/\bmenu\b/.test(text)) gaps.push("menu");
  if (/\bwhat happened\b/.test(q) && !toolsUsed.some((tool) => ["operational_day", "logbook_summary", "cash_up_summary"].includes(tool))) gaps.push("operations");
  return gaps;
}
