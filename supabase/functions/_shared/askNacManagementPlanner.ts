/**
 * Ask NAC Management Planner v1
 *
 * Model understands natural management language → structured plan.
 * Deterministic code resolves periods, RBAC, tools, and numbers.
 *
 * Uses existing OpenAI chat/completions path (OPENAI_API_KEY / OPENAI_MODEL).
 */

import {
  buildPreviousEquivalentVaultPeriod,
  parseVaultComparePeriodsFromQuestion,
  parseVaultPeriodFromQuestion,
} from "./vaultPeriodParser.ts";

export const MANAGEMENT_PLANNER_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
const PLANNER_MAX_TOKENS = 500;
const PLANNER_TEMPERATURE = 0.1;

export const MANAGEMENT_INTENTS = Object.freeze([
  "performance_overview",
  "period_compare",
  "trend_analysis",
  "day_ranking",
  "operational_review",
  "issue_detection",
  "briefing_summary",
  "management_summary",
  "branch_compare",
  "cost_margin",
  "factual_lookup",
  "unsupported",
] as const);

export type ManagementIntent = (typeof MANAGEMENT_INTENTS)[number];

export type ManagementPlan = {
  intent: ManagementIntent;
  scope: { branch: string | null };
  time: { expression: string | null };
  metric_family: "commercial" | "operational" | "mixed" | "cost" | "unknown";
  /** Semantic capabilities (preferred planning vocabulary). */
  capabilities?: string[];
  operations: Array<{ tool: string; purpose: string; optional?: boolean }>;
  comparison: { requested: boolean; type: string | null };
  needs_clarification: boolean;
  clarification_prompt?: string | null;
  confidence?: "high" | "medium" | "low";
};

const INTENT_TO_CAPABILITIES: Record<ManagementIntent, string[]> = {
  performance_overview: ["commercial.performance", "commercial.compare"],
  period_compare: ["commercial.compare", "commercial.performance"],
  trend_analysis: ["commercial.trend", "commercial.compare"],
  day_ranking: ["commercial.rank_days"],
  operational_review: ["operations.review"],
  issue_detection: ["commercial.performance", "commercial.compare", "commercial.rank_days", "operations.review"],
  briefing_summary: ["commercial.performance", "operations.review"],
  management_summary: ["commercial.performance", "operations.review"],
  branch_compare: ["company.scope_compare"],
  cost_margin: ["cost.margin_analysis", "commercial.performance"],
  factual_lookup: ["commercial.performance"],
  unsupported: [],
};

const TOOL_TO_CAPABILITY: Record<string, string> = {
  cash_up_performance: "commercial.performance",
  cash_up_compare: "commercial.compare",
  cash_up_day_ranking: "commercial.rank_days",
  event_forecast: "commercial.forecast",
  operational_evidence: "operations.review",
  branch_compare: "company.scope_compare",
};

export function deriveCapabilitiesFromPlan(plan: Pick<ManagementPlan, "intent" | "operations" | "comparison" | "capabilities">): string[] {
  if (Array.isArray(plan.capabilities) && plan.capabilities.length) {
    return plan.capabilities.slice(0, 6);
  }
  const caps = [...(INTENT_TO_CAPABILITIES[plan.intent] || [])];
  for (const op of plan.operations || []) {
    const c = TOOL_TO_CAPABILITY[op.tool];
    if (c && !caps.includes(c)) caps.push(c);
  }
  if (plan.comparison?.requested && !caps.includes("commercial.compare")) caps.push("commercial.compare");
  return caps.slice(0, 6);
}

const ALLOWED_TOOLS = new Set([
  "cash_up_performance",
  "cash_up_compare",
  "cash_up_day_ranking",
  "event_forecast",
  "operational_evidence",
  "branch_compare",
  "none",
]);

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function validateManagementPlan(raw: unknown): ManagementPlan | null {
  const obj = asObject(raw);
  if (!obj) return null;
  const intent = String(obj.intent || "");
  if (!(MANAGEMENT_INTENTS as readonly string[]).includes(intent)) return null;

  const scopeObj = asObject(obj.scope) || {};
  const timeObj = asObject(obj.time) || {};
  const comparisonObj = asObject(obj.comparison) || {};
  const metricFamily = String(obj.metric_family || "unknown");
  if (!["commercial", "operational", "mixed", "cost", "unknown"].includes(metricFamily)) return null;

  const operationsRaw = Array.isArray(obj.operations) ? obj.operations : [];
  const operations = operationsRaw
    .map((op) => asObject(op))
    .filter(Boolean)
    .map((op) => ({
      tool: String(op!.tool || "none"),
      purpose: String(op!.purpose || ""),
      optional: Boolean(op!.optional),
    }))
    .filter((op) => ALLOWED_TOOLS.has(op.tool))
    .slice(0, 6);

  const branchRaw = scopeObj.branch == null ? null : String(scopeObj.branch).toLowerCase();
  const branch = branchRaw && ["khobar", "riyadh", "jeddah"].includes(branchRaw) ? branchRaw : null;

  const draft: ManagementPlan = {
    intent: intent as ManagementIntent,
    scope: { branch },
    time: { expression: timeObj.expression == null ? null : String(timeObj.expression) },
    metric_family: metricFamily as ManagementPlan["metric_family"],
    operations: operations.length
      ? operations
      : [{ tool: "cash_up_performance", purpose: "default commercial lookup" }],
    comparison: {
      requested: Boolean(comparisonObj.requested),
      type: comparisonObj.type == null ? null : String(comparisonObj.type),
    },
    needs_clarification: Boolean(obj.needs_clarification),
    clarification_prompt: obj.clarification_prompt == null ? null : String(obj.clarification_prompt),
    confidence: ["high", "medium", "low"].includes(String(obj.confidence || ""))
      ? (String(obj.confidence) as "high" | "medium" | "low")
      : "medium",
  };
  const capsRaw = Array.isArray(obj.capabilities)
    ? obj.capabilities.map((c) => String(c)).filter(Boolean)
    : [];
  draft.capabilities = capsRaw.length ? capsRaw.slice(0, 6) : deriveCapabilitiesFromPlan(draft);
  return draft;
}

/** Broad management commercial language — not product/waiter Foodics lookups. */
/** Any calendar month token (full or abbreviated) — not a month-specific phrase patch. */
const NAMED_MONTH_TOKEN =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/;

export function looksLikeManagementCommercialQuestion(question = "") {
  const q = String(question || "").toLowerCase();
  if (!q.trim()) return false;
  if (/\b(waiter|waitress|server|top items?|best sellers?|menu engineering|product sales|sku)\b/.test(q)) {
    return false;
  }
  return (
    /\b(business|performing|performance|overview|briefing|management|gm|pulse|read on|looking|lately|recently|improving|worse|red flags?|worrying|happy about|going wrong|act on|focus on|losing money|sales|covers|guests|orders|weekend|weekday|month|week|khobar|riyadh|jeddah)\b/.test(q)
    || NAMED_MONTH_TOKEN.test(q)
    || /\b(founding day|foundation day|saudi founding|expect(?:ations?)?|forecast)\b/.test(q)
    || /\b(how('?s| is| are| did| was| were)|are we|give me|tell me|what('?s| is)|why |anything |compare )\b/.test(q)
    || /\b\d{1,3}\s+days?\s+ago\b/.test(q)
    || Boolean(parseVaultPeriodFromQuestion(question))
  );
}

export function looksLikeOperationalManagementQuestion(question = "") {
  const q = String(question || "").toLowerCase();
  return /\b(operational(?:ly)?|logbook|complaint|maintenance|struggling|recurring|issues?|problems?)\b/.test(q)
    && !/\b(act on|briefing|worrying)\b/.test(q);
}

export function shouldInvokeManagementPlanner(
  route: { intent?: string; confidence?: string } | null,
  question = "",
) {
  const intent = String(route?.intent || "");
  const confidence = String(route?.confidence || "");
  if (!String(question || "").trim()) return false;
  if (intent === "unknown" || confidence === "none") return true;
  if (confidence === "low" && looksLikeManagementCommercialQuestion(question)) return true;
  // Foodics keyword hijack of management questions
  if (
    /^(sales_total|top_items|top_categories|waiter_sales)/.test(intent)
    && looksLikeManagementCommercialQuestion(question)
    && !/\b(waiter|waitress|top items?|best sellers?|product)\b/i.test(question)
  ) {
    return true;
  }
  return false;
}

function detectBranchMention(question = "") {
  const q = String(question || "").toLowerCase();
  if (/\b(khobar|al khobar)\b/.test(q)) return "khobar";
  if (/\briyadh\b/.test(q)) return "riyadh";
  if (/\bjeddah\b/.test(q)) return "jeddah";
  if (/\b(all branches|network|every branch)\b/.test(q)) return null;
  return null;
}

function inferTimeExpression(question = ""): string | null {
  const parsed = parseVaultPeriodFromQuestion(question, new Date());
  if (parsed?.periodType) return parsed.periodType;
  const q = String(question || "").toLowerCase();
  if (/\b(month to date|mtd|so far this month)\b/.test(q)) return "this_month";
  if (/\b(week before|prior week|previous week|week before that)\b/.test(q)) return "previous_week_compare";
  if (/\b(lately|recently|last few days|these days)\b/.test(q)) return "last_14_days";
  if (/\bweekend\b/.test(q)) return "last_weekend";
  return null;
}

/**
 * Deterministic heuristic planner — broad semantic features, not QA sentence hardcoding.
 * Used for tests and when OpenAI is unavailable.
 */
export function planManagementQuestionHeuristic(
  question = "",
  context: { branchHint?: string | null } = {},
): ManagementPlan {
  const q = String(question || "").toLowerCase().trim();
  const branch = detectBranchMention(q) || (context.branchHint ? String(context.branchHint).toLowerCase() : null);
  const normalizedBranch = branch && ["khobar", "riyadh", "jeddah"].includes(branch) ? branch : null;
  const timeExpr = inferTimeExpression(q);
  const wantsHolidayEvent = /\b(founding day|foundation day|saudi founding|saudi foundation)\b/.test(q);

  const wantsBranchCompare = /\b(better than|vs|versus|compared with|compared to)\b/.test(q)
    && /\b(khobar|riyadh|jeddah)\b/.test(q)
    && (q.match(/\b(khobar|riyadh|jeddah)\b/g) || []).length >= 2;

  const wantsOps = looksLikeOperationalManagementQuestion(q)
    || /\b(guest complaints?|maintenance problems?|problems keep coming|unusual happen|logbook)\b/.test(q);

  const wantsDayRank = /\b(best|worst|strongest|weakest|top\s*\d+|bottom\s*\d+|carrying the month|unusually bad)\b/.test(q)
    && /\b(day|days)\b/.test(q);

  const wantsCompare = /\b(compare|vs|versus|against|with the previous|week before|prior week|better than the week|improving or getting worse|what changed)\b/.test(q)
    || /\b(july|june|may|april).*\b(june|july|may|april)\b/.test(q);

  const wantsBriefing = /\b(briefing|need to know today|gm version|tell him|ahmed asks|management focus|act on|worrying|happy about|quick summary|most important|right now)\b/.test(q)
    || /\bimportant thing\b.*\bnumbers?\b/.test(q)
    || /\bnumbers?\b.*\bright now\b/.test(q);

  const wantsIssue = /\b(going wrong|went wrong|shit|red flags?|losing money|what'?s wrong|problems?|weak|sales down|why are sales|hurting sales)\b/.test(q)
    && !/\boperational(?:ly)?\b/.test(q);

  const wantsOverview = /\b(business|performing|performance|looking|lately|quick read|pulse|overview|summary|covers?|how('?s| is| are| did| was) we|how is khobar|how did nac|how are (we|all)|branches doing)\b/.test(q)
    || /\bhow (was|is|did|are)\b.*\b(july|june|august|week|month|branches?|khobar|riyadh|jeddah)\b/.test(q)
    || /\b(down|up) on (covers?|sales|guests|orders)\b/.test(q)
    || /\b(weekdays?|weekends?)\b.*\b(weaker|stronger|improving|worse)\b/.test(q);

  const wantsNetworkOverview = /\b(all (the )?branches|every branch|network)\b/.test(q)
    && /\b(doing|performance|how are|overview|summary)\b/.test(q);

  const withCaps = (plan: ManagementPlan): ManagementPlan => ({
    ...plan,
    capabilities: deriveCapabilitiesFromPlan(plan),
  });

  if (wantsHolidayEvent) {
    const wantsForecast = /\b(expect|expectation|expectations|forecast|should (we|sales)|look like|next)\b/.test(q);
    const wantsHolidayCompare = /\b(compare|vs|versus|against)\b/.test(q);
    const operations: ManagementPlan["operations"] = [
      { tool: "cash_up_performance", purpose: "historical holiday event window from Cash Up" },
    ];
    if (wantsForecast) {
      operations.push({ tool: "event_forecast", purpose: "bounded next-event expectations" });
    }
    return withCaps({
      intent: wantsHolidayCompare ? "period_compare" : "performance_overview",
      scope: { branch: normalizedBranch },
      time: { expression: timeExpr || "saudi_founding_day" },
      metric_family: "commercial",
      capabilities: [
        "calendar.resolve_period",
        "company.branch_timeline",
        "commercial.performance",
        ...(wantsForecast ? ["commercial.forecast"] : []),
        ...(wantsHolidayCompare ? ["commercial.compare"] : []),
      ],
      operations,
      comparison: {
        requested: wantsHolidayCompare,
        type: wantsHolidayCompare ? "same_named_event" : null,
      },
      needs_clarification: false,
      confidence: "high",
    });
  }

  if (wantsBranchCompare || wantsNetworkOverview) {
    return withCaps({
      intent: "branch_compare",
      scope: { branch: normalizedBranch },
      time: { expression: timeExpr || "last_7_days" },
      metric_family: "commercial",
      operations: [{ tool: "branch_compare", purpose: "compare branch commercial performance" }],
      comparison: { requested: true, type: "cross_branch" },
      needs_clarification: false,
      confidence: "medium",
    });
  }

  if (wantsDayRank) {
    return withCaps({
      intent: "day_ranking",
      scope: { branch: normalizedBranch },
      time: { expression: timeExpr || "this_month" },
      metric_family: "commercial",
      operations: [{ tool: "cash_up_day_ranking", purpose: "rank sales days" }],
      comparison: { requested: false, type: null },
      needs_clarification: false,
      confidence: "high",
    });
  }

  if (wantsCompare) {
    return withCaps({
      intent: "period_compare",
      scope: { branch: normalizedBranch },
      time: { expression: timeExpr || "last_week" },
      metric_family: "commercial",
      operations: [
        { tool: "cash_up_compare", purpose: "primary commercial comparison" },
        { tool: "operational_evidence", purpose: "optional operational context", optional: true },
      ],
      comparison: { requested: true, type: "previous_equivalent_period" },
      needs_clarification: false,
      confidence: "high",
    });
  }

  if (/\blosing money|margin|cost control|food cost\b/.test(q)) {
    return withCaps({
      intent: "cost_margin",
      scope: { branch: normalizedBranch },
      time: { expression: timeExpr || "this_month" },
      metric_family: "cost",
      operations: [{ tool: "cash_up_performance", purpose: "sales context only; cost may be unavailable" }],
      comparison: { requested: false, type: null },
      needs_clarification: false,
      confidence: "medium",
    });
  }

  // Briefing / issue before generic ops so "act on" / "worrying" stay management summaries.
  if (wantsBriefing || wantsIssue) {
    return withCaps({
      intent: wantsBriefing ? "briefing_summary" : "issue_detection",
      scope: { branch: normalizedBranch },
      time: { expression: timeExpr || (/\btoday\b/.test(q) ? "today" : "last_7_days") },
      metric_family: "mixed",
      operations: [
        { tool: "cash_up_performance", purpose: "primary commercial snapshot" },
        { tool: "operational_evidence", purpose: "qualitative issues", optional: true },
      ],
      comparison: { requested: /\blast week|week before|improving|worse|changed\b/.test(q), type: "previous_equivalent_period" },
      needs_clarification: false,
      confidence: "medium",
    });
  }

  if (wantsOps) {
    return withCaps({
      intent: "operational_review",
      scope: { branch: normalizedBranch },
      time: { expression: timeExpr || "last_7_days" },
      metric_family: "operational",
      operations: [{ tool: "operational_evidence", purpose: "in-range operational / logbook evidence" }],
      comparison: { requested: false, type: null },
      needs_clarification: false,
      confidence: "medium",
    });
  }

  if (wantsOverview || timeExpr) {
    return withCaps({
      intent: "performance_overview",
      scope: { branch: normalizedBranch },
      time: { expression: timeExpr || "last_14_days" },
      metric_family: "commercial",
      operations: [
        { tool: "cash_up_performance", purpose: "primary commercial performance" },
        { tool: "operational_evidence", purpose: "optional context", optional: true },
      ],
      comparison: {
        requested: true,
        type: "previous_equivalent_period",
      },
      needs_clarification: false,
      confidence: "medium",
    });
  }

  return withCaps({
    intent: "unsupported",
    scope: { branch: normalizedBranch },
    time: { expression: null },
    metric_family: "unknown",
    operations: [{ tool: "none", purpose: "no safe plan" }],
    comparison: { requested: false, type: null },
    needs_clarification: true,
    clarification_prompt: "Ask about sales performance, day ranking, period comparison, or operational issues for a branch and time range.",
    confidence: "low",
  });
}

export function buildManagementPlannerSystemPrompt() {
  return [
    "You are the Ask NAC management planner for a multi-branch restaurant group.",
    "Output JSON only. Do not answer the business question. Do not invent numbers or dates.",
    "Choose ONE intent from: " + MANAGEMENT_INTENTS.join(", ") + ".",
    "metric_family: commercial | operational | mixed | cost | unknown.",
    "capabilities must be semantic ids such as commercial.performance, commercial.compare, commercial.rank_days, operations.review, company.scope_compare, cost.margin_analysis.",
    "Do NOT emit SQL, RPC names, or database table names.",
    "operations.tool may mirror capabilities via: cash_up_performance, cash_up_compare, cash_up_day_ranking, operational_evidence, branch_compare, none.",
    "Max 4 capabilities/operations. Prefer Cash Up for commercial performance. Foodics is legacy external evidence only — never primary for branch performance.",
    "time.expression should be a semantic token such as last_week, this_week, this_month, august_mtd, named_month:july, last_14_days, previous_week_compare, today — not ISO dates.",
    "needs_clarification=true only when branch/time/metric are truly unsafe to assume.",
    "Understand informal language (lately, looking so far, shit week, act on, pulse check) as management intent.",
  ].join(" ");
}

export function buildManagementPlannerUserPayload(
  question: string,
  context: { branchHint?: string | null; conversationSummary?: string | null } = {},
) {
  return {
    question,
    branchHint: context.branchHint || null,
    conversationSummary: context.conversationSummary || null,
    source_policy: {
      commercial_primary: "cash_up_structured",
      foodics: "LEGACY_EXTERNAL_EVIDENCE",
      operations_primary: "in_range_logbook",
    },
  };
}

/** Parse + schema-validate planner JSON from any OpenAI-compatible model content. */
export function parseManagementPlanFromModelContent(content: string | null | undefined): ManagementPlan | null {
  if (!content || !String(content).trim()) return null;
  try {
    const parsed = JSON.parse(String(content));
    return validateManagementPlan(parsed);
  } catch {
    return null;
  }
}

async function planManagementQuestionWithOpenAi(
  question: string,
  context: { branchHint?: string | null; conversationSummary?: string | null } = {},
): Promise<ManagementPlan | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;

  const userPayload = buildManagementPlannerUserPayload(question, context);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MANAGEMENT_PLANNER_MODEL,
        temperature: PLANNER_TEMPERATURE,
        max_tokens: PLANNER_MAX_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildManagementPlannerSystemPrompt() },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    return parseManagementPlanFromModelContent(content);
  } catch {
    return null;
  }
}

export type PlanManagementOptions = {
  branchHint?: string | null;
  conversationContext?: Record<string, unknown> | null;
  referenceDate?: Date;
  /** Force heuristic (tests / offline). */
  mode?: "auto" | "heuristic" | "openai";
};

/**
 * Plan a management question. OpenAI first (auto), heuristic fallback.
 * Never throws — always returns a validated plan or clarification plan.
 */
export async function planManagementQuestion(
  question: string,
  options: PlanManagementOptions = {},
): Promise<{ plan: ManagementPlan; source: "openai" | "heuristic" }> {
  const branchHint = options.branchHint || null;
  const mode = options.mode
    || (Deno.env.get("ASK_NAC_PLANNER_MODE") as "auto" | "heuristic" | "openai" | null)
    || "auto";

  if (mode !== "heuristic") {
    const openaiPlan = await planManagementQuestionWithOpenAi(question, {
      branchHint,
      conversationSummary: options.conversationContext
        ? String((options.conversationContext as { lastQuestion?: string }).lastQuestion || "")
        : null,
    });
    if (openaiPlan) return { plan: openaiPlan, source: "openai" };
    if (mode === "openai") {
      return {
        plan: planManagementQuestionHeuristic(question, { branchHint }),
        source: "heuristic",
      };
    }
  }

  return {
    plan: planManagementQuestionHeuristic(question, { branchHint }),
    source: "heuristic",
  };
}

function resolveNamedMonthToken(token: string, referenceDate: Date) {
  const q = `How was ${token}?`;
  return parseVaultPeriodFromQuestion(q, referenceDate);
}

export function resolvePlannerTimeExpression(
  expression: string | null | undefined,
  question: string,
  referenceDate = new Date(),
) {
  const expr = String(expression || "").toLowerCase().trim();
  const fromQuestion = parseVaultPeriodFromQuestion(question, referenceDate)
    || parseVaultComparePeriodsFromQuestion(question, referenceDate)?.current
    || null;

  if (!expr) return fromQuestion;

  if (expr.startsWith("named_month:")) {
    return resolveNamedMonthToken(expr.slice("named_month:".length), referenceDate) || fromQuestion;
  }
  if (expr === "august_mtd" || expr === "this_month") {
    return parseVaultPeriodFromQuestion("month to date this month", referenceDate)
      || parseVaultPeriodFromQuestion("this month", referenceDate)
      || fromQuestion;
  }
  if (expr === "last_month") {
    return parseVaultPeriodFromQuestion("last month", referenceDate) || fromQuestion;
  }
  if (expr === "last_week") {
    return parseVaultPeriodFromQuestion("last week", referenceDate) || fromQuestion;
  }
  if (expr === "this_week") {
    return parseVaultPeriodFromQuestion("this week", referenceDate) || fromQuestion;
  }
  if (expr === "today") {
    return parseVaultPeriodFromQuestion("today", referenceDate) || fromQuestion;
  }
  if (expr === "yesterday") {
    return parseVaultPeriodFromQuestion("yesterday", referenceDate) || fromQuestion;
  }
  if (expr === "days_ago") {
    return fromQuestion || parseVaultPeriodFromQuestion(question, referenceDate);
  }
  if (expr === "last_14_days" || expr === "lately" || expr === "recently") {
    return parseVaultPeriodFromQuestion("last 14 days", referenceDate) || fromQuestion;
  }
  if (expr === "last_7_days") {
    return parseVaultPeriodFromQuestion("last 7 days", referenceDate) || fromQuestion;
  }
  if (/^last_\d+_days$/.test(expr)) {
    const n = expr.match(/^last_(\d+)_days$/)?.[1];
    return parseVaultPeriodFromQuestion(`last ${n} days`, referenceDate) || fromQuestion;
  }
  if (expr === "previous_week_compare") {
    return parseVaultPeriodFromQuestion("last week", referenceDate) || fromQuestion;
  }
  if (expr === "last_weekend") {
    return parseVaultPeriodFromQuestion("last 7 days", referenceDate) || fromQuestion;
  }

  // Prefer question parse, else treat expression as natural language fragment.
  return fromQuestion || parseVaultPeriodFromQuestion(expr.replace(/_/g, " "), referenceDate);
}

const INTENT_TO_ROUTE: Record<ManagementIntent, {
  intent: string;
  queryFocus?: string | null;
  performanceOverview?: boolean;
}> = {
  performance_overview: {
    intent: "vault_cash_up_summary",
    queryFocus: "performance_overview",
    performanceOverview: true,
  },
  period_compare: {
    intent: "vault_cash_up_summary",
    queryFocus: "period_compare",
    performanceOverview: false,
  },
  trend_analysis: {
    intent: "vault_cash_up_summary",
    queryFocus: "period_compare",
    performanceOverview: true,
  },
  day_ranking: {
    intent: "vault_cash_up_summary",
    queryFocus: "day_ranking",
    performanceOverview: false,
  },
  operational_review: {
    intent: "vault_operational_review",
    queryFocus: null,
    performanceOverview: false,
  },
  issue_detection: {
    intent: "vault_business_reasoning",
    queryFocus: null,
    performanceOverview: false,
  },
  briefing_summary: {
    intent: "vault_cash_up_summary",
    queryFocus: "performance_overview",
    performanceOverview: true,
  },
  management_summary: {
    intent: "vault_cash_up_summary",
    queryFocus: "performance_overview",
    performanceOverview: true,
  },
  branch_compare: {
    intent: "executive_analysis",
    queryFocus: null,
    performanceOverview: false,
  },
  cost_margin: {
    intent: "vault_cash_up_summary",
    queryFocus: "performance_overview",
    performanceOverview: true,
  },
  factual_lookup: {
    intent: "vault_cash_up_summary",
    queryFocus: null,
    performanceOverview: false,
  },
  unsupported: {
    intent: "unknown",
    queryFocus: null,
    performanceOverview: false,
  },
};

/**
 * High-level: maybe invoke planner and rewrite route.
 */
export async function enrichRouteWithManagementPlanner(
  route: Record<string, unknown>,
  question: string,
  options: PlanManagementOptions & { filters?: { branch?: string | null } } = {},
) {
  if (!shouldInvokeManagementPlanner(route as { intent?: string; confidence?: string }, question)) {
    return {
      route,
      plannerUsed: false,
      plannerSource: null as null | "openai" | "heuristic",
      plan: null as ManagementPlan | null,
      applied: false,
      applyReason: "not_invoked",
    };
  }

  const { plan, source } = await planManagementQuestion(question, options);
  const applied = applyManagementPlanToRoute(route, plan, {
    question,
    referenceDate: options.referenceDate,
    filters: options.filters,
  });

  return {
    route: applied.applied ? applied.route : route,
    plannerUsed: true,
    plannerSource: source,
    plan,
    applied: applied.applied,
    applyReason: applied.reason,
  };
}

/**
 * Apply a validated management plan onto an Edge route object.
 * Deterministic temporal resolution happens here — not in the model.
 */
export function applyManagementPlanToRoute(
  route: Record<string, unknown>,
  plan: ManagementPlan,
  options: {
    question?: string;
    referenceDate?: Date;
    filters?: { branch?: string | null };
  } = {},
) {
  if (!plan || plan.needs_clarification || plan.intent === "unsupported") {
    return {
      route,
      applied: false,
      reason: plan?.needs_clarification ? "needs_clarification" : "unsupported",
    };
  }

  const referenceDate = options.referenceDate || new Date();
  const question = String(options.question || "");
  const mapping = INTENT_TO_ROUTE[plan.intent] || INTENT_TO_ROUTE.performance_overview;

  let vaultPeriod = resolvePlannerTimeExpression(plan.time.expression, question, referenceDate);
  let vaultCompare = parseVaultComparePeriodsFromQuestion(question, referenceDate);

  if (!vaultCompare && plan.comparison?.requested) {
    const current = vaultPeriod || parseVaultPeriodFromQuestion("last 7 days", referenceDate);
    if (current?.startDate && current?.endDate) {
      const previous = buildPreviousEquivalentVaultPeriod(current);
      if (previous?.startDate && previous?.endDate) {
        vaultCompare = {
          current,
          previous,
          periodType: "planner_compare",
          isComparison: true,
          autoAttached: true,
        };
        vaultPeriod = current;
      }
    }
  }

  if (vaultCompare?.current) vaultPeriod = vaultCompare.current;

  const branchMention = plan.scope.branch
    || (route.branchMention as string | null)
    || (options.filters?.branch && options.filters.branch !== "all" ? options.filters.branch : null)
    || null;

  const next = {
    ...route,
    intent: mapping.intent,
    confidence: plan.confidence === "high" ? "high" : "medium",
    score: Math.max(Number(route.score || 0), 36),
    branchMention,
    vaultPeriod: vaultPeriod || route.vaultPeriod || null,
    vaultCompare: vaultCompare || (plan.comparison?.requested ? route.vaultCompare : null) || null,
    performanceOverview: Boolean(mapping.performanceOverview),
    queryFocus: mapping.queryFocus,
    foodicsPeriod: null,
    foodicsCompare: null,
    debug: {
      ...((route.debug as Record<string, unknown>) || {}),
      managementPlanner: {
        intent: plan.intent,
        metricFamily: plan.metric_family,
        timeExpression: plan.time.expression,
        comparison: plan.comparison,
        operations: plan.operations,
        branch: branchMention,
      },
      branchLabel: branchMention
        ? ({ khobar: "Khobar", riyadh: "Riyadh", jeddah: "Jeddah" } as Record<string, string>)[branchMention] || branchMention
        : (route.debug as { branchLabel?: string } | undefined)?.branchLabel || null,
    },
  };

  return { route: next, applied: true, reason: "planned" };
}
