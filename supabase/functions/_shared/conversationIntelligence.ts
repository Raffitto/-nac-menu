/**
 * Edge-side Conversation Intelligence V1 (parity with client conversation modules).
 */

import { isDocumentSummaryFollowUp } from "./askNacVaultTools.ts";

export const CONVERSATION_STATE_VERSION = 1;

export const FOLLOW_UP_CATEGORIES = {
  VISUALIZATION: "visualization",
  DRILL_DOWN: "drill_down",
  COMPARISON: "comparison",
  TIME_SHIFT: "time_shift",
  FILTER: "filter",
  EXPLANATION: "explanation",
  EXPANSION: "expansion",
  BRANCH_PIVOT: "branch_pivot",
  BRANCH_COMPARE: "branch_compare",
  PRONOUN: "pronoun",
} as const;

const BRANCH_FRAGMENTS = [
  { id: "khobar", pattern: /\b(khobar|al khobar|nac)\b/i },
  { id: "riyadh", pattern: /\briyadh\b/i },
  { id: "jeddah", pattern: /\bjeddah\b/i },
];

const PERIOD_FRAGMENTS = [
  { pattern: /\blast month\b/i, text: "last month" },
  { pattern: /\bthis month\b|\bmtd\b/i, text: "this month" },
  { pattern: /\byesterday\b/i, text: "yesterday" },
  { pattern: /\btoday\b/i, text: "today" },
  { pattern: /\blast week\b/i, text: "last week" },
  { pattern: /\bthis week\b/i, text: "this week" },
  { pattern: /\b(last|past)\s+7\s+days?\b/i, text: "last 7 days" },
  { pattern: /\b(last|past)\s+14\s+days?\b/i, text: "last 14 days" },
];

function normalizeQuestion(text: string) {
  return String(text || "").trim().replace(/\s+/g, " ");
}

function stripQuestionMark(text: string) {
  return normalizeQuestion(text).replace(/\?+$/, "").trim();
}

function capitalizeBranch(branchId: string) {
  return branchId ? branchId.charAt(0).toUpperCase() + branchId.slice(1) : "";
}

function metricToPhrase(metric: string | null) {
  const map: Record<string, string> = {
    net_sales: "net sales",
    total_sales: "sales",
    sales: "sales",
    guests: "guest count",
    delivery_sales: "delivery sales",
    delivery_orders: "delivery orders",
    avg_spend: "average spend",
  };
  return metric ? (map[metric] || metric.replace(/_/g, " ")) : "net sales";
}

function inferMetricFromQuestion(question = "") {
  const q = String(question).toLowerCase();
  if (/\bnet sales\b/.test(q)) return "net_sales";
  if (/\bdelivery orders?\b/.test(q)) return "delivery_orders";
  if (/\bdelivery\b/.test(q)) return "delivery_sales";
  if (/\b(guest count|guests?)\b/.test(q)) return "guests";
  if (/\b(revenue|sales)\b/.test(q)) return "net_sales";
  return null;
}

export function createEmptyConversationState() {
  return {
    version: CONVERSATION_STATE_VERSION,
    branch: null as string | null,
    branchLabel: null as string | null,
    branchHistory: [] as string[],
    intent: null as string | null,
    metric: null as string | null,
    metricLabel: null as string | null,
    period: null as Record<string, unknown> | null,
    reportType: null as string | null,
    confidence: "none",
    dataset: null as Record<string, unknown> | null,
    answerType: null as string | null,
    filters: {} as Record<string, unknown>,
    timestamp: null as string | null,
    sources: [] as string[],
    vaultPeriod: null as Record<string, unknown> | null,
    vaultCompare: null as Record<string, unknown> | null,
    resolvedQuestion: null as string | null,
    originalQuestion: null as string | null,
  };
}

export function createEmptyConversationContext() {
  return {
    lastQuestion: null,
    lastResolvedQuestion: null,
    lastIntent: null,
    lastBranch: null,
    lastPeriod: null,
    lastMetric: null,
    lastEntity: null,
    lastAnswerSummary: null,
    lastDocumentContext: null,
    lastDataset: null,
    activeState: createEmptyConversationState(),
    pendingSessionId: null,
    awaitingInput: false,
  };
}

function normalizeBranchId(branch: unknown) {
  if (!branch) return null;
  const raw = String(branch).toLowerCase().trim();
  if (raw.includes("khobar") || raw === "nac") return "khobar";
  if (raw.includes("riyadh")) return "riyadh";
  if (raw.includes("jeddah")) return "jeddah";
  return raw;
}

export function conversationStateFromLegacyContext(context: Record<string, unknown> = {}) {
  const active = context.activeState as Record<string, unknown> | undefined;
  if (active?.version === CONVERSATION_STATE_VERSION) {
    return { ...createEmptyConversationState(), ...active };
  }
  const state = createEmptyConversationState();
  state.branch = normalizeBranchId(context.lastBranch);
  state.branchLabel = (context.lastBranch as string) || null;
  state.intent = (context.lastIntent as string) || null;
  state.metric = inferMetricFromQuestion(String(context.lastResolvedQuestion || context.lastQuestion || ""))
    || ((context.lastIntent === "vault_cash_up_summary") ? "net_sales" : null);
  state.metricLabel = metricToPhrase(state.metric);
  state.period = context.lastPeriod
    ? { rangeId: context.lastPeriod, label: context.lastPeriod, periodType: context.lastPeriod }
    : null;
  state.resolvedQuestion = (context.lastResolvedQuestion as string) || (context.lastQuestion as string) || null;
  state.dataset = (context.lastDataset as Record<string, unknown>) || null;
  if (state.branch) state.branchHistory = [state.branch];
  return state;
}

export function captureConversationStateFromTurn({
  question,
  resolvedQuestion,
  response,
  route,
  previousState = null,
}: {
  question?: string;
  resolvedQuestion?: string;
  response?: Record<string, unknown>;
  route?: Record<string, unknown>;
  previousState?: ReturnType<typeof createEmptyConversationState> | null;
}) {
  const prev = previousState || createEmptyConversationState();
  const intent = (response?.intent as string) ?? (route?.intent as string) ?? prev.intent;
  const branchLabel = (response?.branchLabel as string) ?? (route?.branchMention as string) ?? prev.branchLabel;
  const branch = normalizeBranchId(branchLabel) || prev.branch;
  const metric = inferMetricFromQuestion(resolvedQuestion || question || "") || prev.metric
    || (intent === "vault_cash_up_summary" ? "net_sales" : null);
  const branchHistory = [...prev.branchHistory];
  const pivotBranch = extractBranchFragment(resolvedQuestion || question || "");
  if (pivotBranch && !branchHistory.includes(pivotBranch)) branchHistory.push(pivotBranch);
  if (branch && !branchHistory.includes(branch)) branchHistory.push(branch);

  const conversationDataset = response?.conversationDataset as Record<string, unknown> | undefined;
  const aggregation = conversationDataset?.aggregation as Record<string, unknown> | undefined;

  return {
    ...createEmptyConversationState(),
    branch,
    branchLabel,
    branchHistory: branchHistory.slice(-4),
    intent,
    metric,
    metricLabel: metricToPhrase(metric),
    period: response?.periodLabel
      ? { label: response.periodLabel, rangeId: (route as { period?: { rangeId?: string } })?.period?.rangeId || null }
      : prev.period,
    dataset: conversationDataset
      ? {
        kind: conversationDataset.kind || "cash_up_aggregation",
        aggregation: aggregation || null,
        dailyBreakdown: conversationDataset.dailyBreakdown || aggregation?.dailyBreakdown || [],
      }
      : prev.dataset,
    resolvedQuestion: resolvedQuestion || question || null,
    originalQuestion: question || null,
    timestamp: new Date().toISOString(),
    vaultPeriod: (response?.vaultPeriod as Record<string, unknown>) || (route?.vaultPeriod as Record<string, unknown>) || prev.vaultPeriod,
  };
}

export function updateConversationContextEdge(context: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) {
  const base = { ...createEmptyConversationContext(), ...context };
  const question = payload.question as string | undefined;
  const resolvedQuestion = (payload.resolvedQuestion as string) ?? base.lastResolvedQuestion;
  const response = payload.response as Record<string, unknown> | undefined;
  const route = payload.route as Record<string, unknown> | undefined;

  const activeState = captureConversationStateFromTurn({
    question,
    resolvedQuestion,
    response,
    route,
    previousState: base.activeState as ReturnType<typeof createEmptyConversationState>,
  });

  return {
    ...base,
    lastQuestion: question ?? base.lastQuestion,
    lastResolvedQuestion: resolvedQuestion,
    lastIntent: (response?.intent as string) ?? (route?.intent as string) ?? base.lastIntent,
    lastBranch: (response?.branchLabel as string) ?? (route?.branchMention as string) ?? base.lastBranch,
    lastPeriod: (response?.periodLabel as string) ?? base.lastPeriod,
    lastMetric: inferMetricFromQuestion(resolvedQuestion || question || "") ?? base.lastMetric,
    lastDataset: response?.conversationDataset ?? base.lastDataset,
    activeState,
  };
}

function extractBranchFragment(text: string) {
  for (const item of BRANCH_FRAGMENTS) {
    if (item.pattern.test(text)) return item.id;
  }
  return null;
}

function extractPeriodFragment(text: string) {
  for (const item of PERIOD_FRAGMENTS) {
    if (item.pattern.test(text)) return item;
  }
  return null;
}

function buildBaseQuestionFromState(state: ReturnType<typeof createEmptyConversationState>) {
  const periodLabel = (state.period?.label as string) || (state.vaultPeriod?.label as string) || "the active period";
  const branchSuffix = state.branchLabel ? ` for ${state.branchLabel}` : "";
  return `Show ${metricToPhrase(state.metric)} for ${periodLabel}${branchSuffix}`.replace(/\s+/g, " ").trim();
}

function classifyFollowUp(question: string, state: ReturnType<typeof createEmptyConversationState> | null) {
  const q = normalizeQuestion(question).toLowerCase();
  const hasState = Boolean(state?.resolvedQuestion || state?.metric);
  if (/\b(visuali[sz]e|chart|graph|plot)\b/.test(q) || /^visuali[sz]e\s+it\b/.test(q)) {
    return { category: FOLLOW_UP_CATEGORIES.VISUALIZATION, subCategory: "chart", confidence: hasState ? "known" : "inferred" };
  }
  if (/\b(break\s*(it\s+)?down|daily breakdown)\b/.test(q) || /\bby\s+(day|platform|branch)\b/.test(q)) {
    const byMatch = q.match(/\bby\s+(day|platform|branch)\b/);
    return { category: FOLLOW_UP_CATEGORIES.DRILL_DOWN, subCategory: byMatch ? `by_${byMatch[1]}` : "by_day", confidence: hasState ? "known" : "inferred" };
  }
  if (/\b(compare|vs|versus|compared to)\b/.test(q) || /^compare\s+(it|both|them)\b/.test(q)) {
    let subCategory = "generic";
    if (/\b(previous|prior)\s+week\b/.test(q)) subCategory = "previous_week";
    if (/\b(last|previous)\s+year\b/.test(q)) subCategory = "last_year";
    if (/\bboth\b/.test(q)) subCategory = "branches";
    return { category: FOLLOW_UP_CATEGORIES.COMPARISON, subCategory, confidence: hasState ? "known" : "inferred" };
  }
  if (/^(what about|how about)\b/.test(q) && extractBranchFragment(q)) {
    return { category: FOLLOW_UP_CATEGORIES.BRANCH_PIVOT, subCategory: extractBranchFragment(q), confidence: "known" };
  }
  if (/\b(only|just)\b/.test(q) || /\b(delivery only|only delivery|cash only|card only|hungerstation|jahez|keeta)\b/.test(q)) {
    return { category: FOLLOW_UP_CATEGORIES.FILTER, subCategory: "constraint", confidence: hasState ? "known" : "inferred" };
  }
  if (/^why\b/.test(q) || /\b(explain|what happened|what drove)\b/.test(q)) {
    return { category: FOLLOW_UP_CATEGORIES.EXPLANATION, subCategory: "why", confidence: hasState ? "known" : "missing" };
  }
  if (/^(and )?(yesterday|today|last week|this week|last month|this month)\??$/.test(q)) {
    return { category: FOLLOW_UP_CATEGORIES.TIME_SHIFT, subCategory: "period_only", confidence: hasState ? "known" : "missing" };
  }
  if (/^which\b.*\b(stronger|better|worse)\b/.test(q)) {
    return { category: FOLLOW_UP_CATEGORIES.BRANCH_COMPARE, subCategory: "strength", confidence: hasState ? "known" : "missing" };
  }
  return { category: null, subCategory: null, confidence: "missing" };
}

function isConversationFollowUp(question: string, context: Record<string, unknown>) {
  const state = conversationStateFromLegacyContext(context);
  const classified = classifyFollowUp(question, state);
  if (classified.category) return true;
  const q = normalizeQuestion(question).toLowerCase();
  if (!context.lastResolvedQuestion && !context.lastQuestion && !context.activeState) return false;
  if (/^i mean\b/.test(q)) return true;
  if (/^(what about|how about)\b/.test(q)) return true;
  if (/^and\b/.test(q) && q.split(/\s+/).length <= 6) return true;
  if (/^(and )?(yesterday|last month|this month|today|last week)\??$/.test(q)) return true;
  return false;
}

function resolveConversationTurn(question: string, context: Record<string, unknown>) {
  const original = normalizeQuestion(question);
  const state = conversationStateFromLegacyContext(context);
  const classification = classifyFollowUp(original, state);
  if (!classification.category) return { resolvedQuestion: original, usedContext: false, resolutionNotes: [] as string[] };

  const base = buildBaseQuestionFromState(state);
  const periodLabel = (state.period?.label as string) || (state.vaultPeriod?.label as string) || "the active period";
  const branchSuffix = state.branchLabel ? ` for ${state.branchLabel}` : "";

  if (classification.category === FOLLOW_UP_CATEGORIES.VISUALIZATION) {
    return {
      resolvedQuestion: `${base} daily breakdown`,
      usedContext: true,
      resolutionNotes: ["Inherited metric, period, and branch from the previous answer."],
      followUpCategory: classification.category,
      preferDatasetReuse: Boolean(state.dataset),
    };
  }
  if (classification.category === FOLLOW_UP_CATEGORIES.DRILL_DOWN) {
    const dimension = String(classification.subCategory || "by_day").replace(/^by_/, "").replace(/_/g, " ");
    return {
      resolvedQuestion: `${base} by ${dimension}`,
      usedContext: true,
      resolutionNotes: [`Drill-down inherited from prior turn (${dimension}).`],
      followUpCategory: classification.category,
      preferDatasetReuse: dimension === "day" && Boolean(state.dataset),
    };
  }
  if (classification.category === FOLLOW_UP_CATEGORIES.COMPARISON) {
    if (classification.subCategory === "branches" || /\bcompare both\b/i.test(original)) {
      const history = state.branchHistory.length >= 2
        ? state.branchHistory.slice(-2)
        : [state.branch, extractBranchFragment(state.resolvedQuestion || "")].filter(Boolean) as string[];
      if (history.length >= 2) {
        const labels = history.slice(-2).map(capitalizeBranch);
        return {
          resolvedQuestion: `Compare ${labels[0]} and ${labels[1]} ${metricToPhrase(state.metric)} for ${periodLabel}`,
          usedContext: true,
          resolutionNotes: ["Comparing the two branches referenced in this conversation."],
          followUpCategory: FOLLOW_UP_CATEGORIES.BRANCH_COMPARE,
          preferDatasetReuse: false,
        };
      }
    }
    const compareTarget = /\blast 7 days\b/i.test(periodLabel) ? "previous 7 days" : "previous period";
    return {
      resolvedQuestion: `Compare ${metricToPhrase(state.metric)} for ${periodLabel} to ${compareTarget}${branchSuffix}`,
      usedContext: true,
      resolutionNotes: ["Inherited metric and period; applied comparison follow-up."],
      followUpCategory: classification.category,
      preferDatasetReuse: false,
    };
  }
  if (classification.category === FOLLOW_UP_CATEGORIES.BRANCH_PIVOT && classification.subCategory) {
    const stripBranch = (text: string, branchId: string | null) => {
      if (!branchId) return text;
      const label = capitalizeBranch(branchId);
      return text.replace(new RegExp(`\\b${label}\\b`, "i"), "").replace(new RegExp(`\\b${branchId}\\b`, "i"), "").replace(/\s+/g, " ").trim();
    };
    const withoutBranch = stripBranch(stripQuestionMark(state.resolvedQuestion || base), state.branch);
    return {
      resolvedQuestion: `${withoutBranch} for ${capitalizeBranch(String(classification.subCategory))}?`,
      usedContext: true,
      resolutionNotes: [`Switched branch context to ${capitalizeBranch(String(classification.subCategory))}.`],
      followUpCategory: classification.category,
      preferDatasetReuse: false,
    };
  }
  if (classification.category === FOLLOW_UP_CATEGORIES.FILTER) {
    const q = original.toLowerCase();
    let suffix = "";
    if (/\bdelivery only\b/.test(q) || /\bonly delivery\b/.test(q)) suffix = " delivery only";
    else if (/\bonly\s+(hungerstation|hunger|jahez|keeta)\b/.test(q)) {
      suffix = ` ${q.match(/\bonly\s+(hungerstation|hunger|jahez|keeta)\b/)?.[1] || ""} only`;
    } else if (/\b(hungerstation|hunger|jahez|keeta)\s+only\b/.test(q)) {
      suffix = ` ${q.match(/\b(hungerstation|hunger|jahez|keeta)\b/)?.[1] || ""} only`;
    }
    if (suffix) {
      return {
        resolvedQuestion: `${stripQuestionMark(state.resolvedQuestion || base)}${suffix}?`,
        usedContext: true,
        resolutionNotes: ["Applied filter on top of the active conversation context."],
        followUpCategory: classification.category,
        preferDatasetReuse: false,
      };
    }
  }
  if (classification.category === FOLLOW_UP_CATEGORIES.EXPLANATION) {
    if (/worst day|weakest day|lowest day/.test(original.toLowerCase())) {
      const breakdown = (state.dataset?.dailyBreakdown as { date: string; totalSales?: number }[])
        || ((state.dataset?.aggregation as { dailyBreakdown?: { date: string; totalSales?: number }[] })?.dailyBreakdown)
        || [];
      if (breakdown.length) {
        const rows = [...breakdown].filter((r) => r.totalSales != null);
        rows.sort((a, b) => Number(a.totalSales) - Number(b.totalSales));
        if (rows[0]?.date) {
          return {
            resolvedQuestion: `Why were ${metricToPhrase(state.metric)} lower on ${rows[0].date}${branchSuffix}?`,
            usedContext: true,
            resolutionNotes: ["Explanation anchored to the weakest day in the prior dataset."],
            followUpCategory: classification.category,
            preferDatasetReuse: true,
          };
        }
      }
    }
    return {
      resolvedQuestion: `Why did ${metricToPhrase(state.metric)} change for ${periodLabel}${branchSuffix}?`,
      usedContext: true,
      resolutionNotes: ["Inherited metric and period for explanation routing."],
      followUpCategory: classification.category,
      preferDatasetReuse: Boolean(state.dataset),
    };
  }
  if (classification.category === FOLLOW_UP_CATEGORIES.TIME_SHIFT) {
    const period = extractPeriodFragment(original);
    if (period) {
      const withoutPeriod = stripQuestionMark(state.resolvedQuestion || base);
      return {
        resolvedQuestion: `${withoutPeriod} ${period.text}?`,
        usedContext: true,
        resolutionNotes: [`Shifted period to ${period.text}.`],
        followUpCategory: classification.category,
        preferDatasetReuse: false,
      };
    }
  }
  if (classification.category === FOLLOW_UP_CATEGORIES.BRANCH_COMPARE) {
    const labels = state.branchHistory.slice(-2).map(capitalizeBranch);
    return {
      resolvedQuestion: `Compare ${labels[0]} and ${labels[1]} ${metricToPhrase(state.metric)} for ${periodLabel} — which is stronger?`,
      usedContext: true,
      resolutionNotes: ["Strength question mapped to branch comparison."],
      followUpCategory: classification.category,
      preferDatasetReuse: false,
    };
  }

  return { resolvedQuestion: original, usedContext: false, resolutionNotes: [] as string[] };
}

export function resolveFollowUpQuestion(question: string, context: Record<string, unknown> = {}) {
  const original = normalizeQuestion(question);
  if (!original) return { resolvedQuestion: original, usedContext: false, resolutionNotes: [] as string[] };

  const docCtx = context.lastDocumentContext as { fileIds?: string[]; fileTitles?: string[] } | undefined;
  if (docCtx?.fileIds?.length && isDocumentSummaryFollowUp(original)) {
    const title = docCtx.fileTitles?.[0] || "this document";
    return {
      resolvedQuestion: `Summarize ${title}`,
      usedContext: true,
      resolutionNotes: ["Using the active uploaded document from the previous answer."],
    };
  }

  const conversationTurn = resolveConversationTurn(original, context);
  if (conversationTurn.usedContext) return conversationTurn;

  if (!isConversationFollowUp(original, context)) {
    return { resolvedQuestion: original, usedContext: false, resolutionNotes: [] as string[] };
  }

  const base = stripQuestionMark(String(context.lastResolvedQuestion || context.lastQuestion || ""));
  const period = extractPeriodFragment(original);
  if (base && period) {
    return {
      resolvedQuestion: `${base} ${period.text}?`.replace(/\?\?+$/, "?"),
      usedContext: true,
      resolutionNotes: ["Inherited context from the previous question."],
    };
  }

  const branch = extractBranchFragment(original);
  if (base && branch && !extractBranchFragment(base)) {
    return {
      resolvedQuestion: `${base} for ${capitalizeBranch(branch)}?`,
      usedContext: true,
      resolutionNotes: ["Inherited context from the previous question."],
    };
  }

  if (/^i mean\b/i.test(original) && context.lastResolvedQuestion) {
    const stripped = original.replace(/^i mean\b/i, "").trim();
    const merged = `${stripQuestionMark(String(context.lastResolvedQuestion))} ${stripped}`.replace(/\s+/g, " ");
    return {
      resolvedQuestion: `${merged}?`,
      usedContext: true,
      resolutionNotes: ["Expanded “I mean …” using the previous question."],
    };
  }

  return { resolvedQuestion: original, usedContext: false, resolutionNotes: [] as string[] };
}

export function prepareAskNacQuestionEdge({
  question,
  conversationContext = null,
  filters = {},
}: {
  question: string;
  conversationContext?: Record<string, unknown> | null;
  filters?: Record<string, unknown>;
}) {
  const resolution = conversationContext
    ? resolveFollowUpQuestion(question, conversationContext)
    : { resolvedQuestion: question, usedContext: false, resolutionNotes: [] as string[], preferDatasetReuse: false, followUpCategory: null as string | null };

  const effectiveQuestion = resolution.resolvedQuestion || question;
  const effectiveFilters = { ...filters };

  if (resolution.usedContext && conversationContext?.lastPeriod && !effectiveFilters.selectedRange) {
    effectiveFilters.selectedRange = conversationContext.lastPeriod;
  }

  return {
    originalQuestion: question,
    effectiveQuestion,
    conversationResolution: resolution,
    conversationTurn: resolution.usedContext
      ? {
        followUpCategory: (resolution as { followUpCategory?: string }).followUpCategory || null,
        preferDatasetReuse: Boolean((resolution as { preferDatasetReuse?: boolean }).preferDatasetReuse),
      }
      : null,
    filters: effectiveFilters,
  };
}
