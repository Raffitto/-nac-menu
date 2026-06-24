/**
 * Conversation Intelligence V1 — persistent turn memory for Ask NAC.
 * Session-only (no database). Stored on the client and round-tripped to Edge.
 */

import { ASK_NAC_INTENTS } from "../intentRouter";
import { scoreSalesPerformanceQueryFocus } from "../vault/vaultSalesPerformanceIntelligence";
import { extractBranchFragment } from "./conversationFollowUpTaxonomy";

export const CONVERSATION_STATE_VERSION = 1;

const VAULT_DATA_INTENTS = new Set([
  ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
  ASK_NAC_INTENTS.VAULT_CASH_UP,
  ASK_NAC_INTENTS.VAULT_BUSINESS_REASONING,
  ASK_NAC_INTENTS.VAULT_COVERAGE_LIST,
  ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH,
  ASK_NAC_INTENTS.VAULT_DOCUMENT_SUMMARY,
  ASK_NAC_INTENTS.VAULT_WEEKLY_DASHBOARD,
  ASK_NAC_INTENTS.VAULT_KNOWLEDGE_HEALTH,
]);

const METRIC_PHRASES = Object.freeze({
  net_sales: "net sales",
  total_sales: "sales",
  sales: "sales",
  revenue: "revenue",
  guests: "guest count",
  guest_count: "guest count",
  delivery: "delivery sales",
  delivery_sales: "delivery sales",
  delivery_orders: "delivery orders",
  avg_spend: "average spend",
  orders: "orders",
  payment_mix: "payment mix",
});

const METRIC_FROM_FOCUS = Object.freeze({
  period_sales: "net_sales",
  guest_count: "guests",
  avg_spend: "avg_spend",
  delivery: "delivery_sales",
  delivery_platform: "delivery_sales",
  period_compare: "net_sales",
  payment_mix: "payment_mix",
  general: "net_sales",
});

export function createEmptyConversationState() {
  return {
    version: CONVERSATION_STATE_VERSION,
    branch: null,
    branchLabel: null,
    branchHistory: [],
    intent: null,
    metric: null,
    metricLabel: null,
    period: null,
    reportType: null,
    confidence: "none",
    dataset: null,
    answerType: null,
    filters: {},
    timestamp: null,
    sources: [],
    vaultPeriod: null,
    vaultCompare: null,
    resolvedQuestion: null,
    originalQuestion: null,
  };
}

export function metricToPhrase(metric) {
  if (!metric) return "net sales";
  return METRIC_PHRASES[metric] || String(metric).replace(/_/g, " ");
}

export function inferMetricFromQuestion(question = "") {
  const q = String(question || "").toLowerCase();
  if (/\bnet sales\b/.test(q)) return "net_sales";
  if (/\bdelivery orders?\b/.test(q)) return "delivery_orders";
  if (/\bdelivery\b/.test(q)) return "delivery_sales";
  if (/\b(guest count|guests?)\b/.test(q)) return "guests";
  if (/\b(average spend|avg spend)\b/.test(q)) return "avg_spend";
  if (/\bpayment mix\b/.test(q)) return "payment_mix";
  if (/\b(revenue|sales)\b/.test(q)) return "net_sales";
  const focus = scoreSalesPerformanceQueryFocus(question);
  if (focus && METRIC_FROM_FOCUS[focus]) return METRIC_FROM_FOCUS[focus];
  return null;
}

function normalizeBranchId(branch) {
  if (!branch) return null;
  const raw = String(branch).toLowerCase().trim();
  if (raw.includes("khobar") || raw === "nac") return "khobar";
  if (raw.includes("riyadh")) return "riyadh";
  if (raw.includes("jeddah")) return "jeddah";
  return raw;
}

function pickReportType(intent, response) {
  if (response?.conversationDataset?.reportType) return response.conversationDataset.reportType;
  if (intent === ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY || intent === ASK_NAC_INTENTS.VAULT_CASH_UP) {
    return "cash_up";
  }
  return null;
}

function buildDatasetSnapshot(response) {
  const embedded = response?.conversationDataset;
  if (embedded?.kind) {
    return {
      kind: embedded.kind,
      aggregation: embedded.aggregation || null,
      dailyBreakdown: embedded.dailyBreakdown || embedded.aggregation?.dailyBreakdown || [],
      reportType: embedded.reportType || null,
    };
  }

  const diagnostics = response?.diagnostics;
  if (diagnostics?.aggregation) {
    return {
      kind: "cash_up_aggregation",
      aggregation: diagnostics.aggregation,
      dailyBreakdown: diagnostics.aggregation.dailyBreakdown || [],
      reportType: "cash_up",
    };
  }

  return null;
}

function pickPeriodFromResponse(response, route) {
  const vaultPeriod = response?.vaultPeriod || route?.vaultPeriod || null;
  if (vaultPeriod) {
    return {
      rangeId: vaultPeriod.periodType || vaultPeriod.rangeId || null,
      label: response?.periodLabel || vaultPeriod.label || null,
      periodType: vaultPeriod.periodType || null,
      startDate: vaultPeriod.startDate || null,
      endDate: vaultPeriod.endDate || null,
    };
  }
  if (response?.periodLabel) {
    return {
      rangeId: route?.period?.rangeId || null,
      label: response.periodLabel,
      periodType: route?.period?.rangeId || null,
      startDate: null,
      endDate: null,
    };
  }
  if (route?.period) {
    return {
      rangeId: route.period.rangeId || null,
      label: route.period.label || response?.periodLabel || null,
      periodType: route.period.rangeId || null,
      startDate: null,
      endDate: null,
    };
  }
  return null;
}

/**
 * Build rich state from a completed Ask NAC turn.
 */
export function captureConversationStateFromTurn({
  question,
  resolvedQuestion,
  response,
  route,
  previousState = null,
  branchPivot = null,
}) {
  const intent = response?.intent ?? route?.intent ?? previousState?.intent ?? null;
  const branchLabel = response?.branchLabel ?? route?.branchMention ?? previousState?.branchLabel ?? null;
  const branch = normalizeBranchId(branchLabel) || previousState?.branch || null;
  const metric =
    inferMetricFromQuestion(resolvedQuestion || question)
    || previousState?.metric
    || (intent === ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY ? "net_sales" : null);

  const period = pickPeriodFromResponse(response, route) || previousState?.period || null;
  const dataset = buildDatasetSnapshot(response) || previousState?.dataset || null;
  const preservedDataset = dataset?.dailyBreakdown?.length
    ? dataset
    : (previousState?.dataset?.dailyBreakdown?.length
      ? { ...previousState.dataset, ...(dataset || {}) }
      : dataset);
  const branchHistory = Array.isArray(previousState?.branchHistory)
    ? [...previousState.branchHistory]
    : [];

  const pivotBranch = branchPivot || extractBranchFragment(resolvedQuestion || question || "");
  if (pivotBranch && !branchHistory.includes(pivotBranch)) {
    branchHistory.push(pivotBranch);
  }
  if (branch && !branchHistory.includes(branch)) {
    branchHistory.push(branch);
  }

  return {
    version: CONVERSATION_STATE_VERSION,
    branch,
    branchLabel,
    branchHistory: branchHistory.slice(-4),
    intent,
    metric,
    metricLabel: metricToPhrase(metric),
    period,
    reportType: pickReportType(intent, response),
    confidence: response?.confidence || response?.dataConfidence?.level || "medium",
    dataset: preservedDataset,
    answerType: response?.answerType || null,
    filters: {
      ...(previousState?.filters || {}),
      ...(response?.conversationDataset?.filters || {}),
    },
    timestamp: new Date().toISOString(),
    sources: (response?.sources || []).map((s) => s?.name || s).filter(Boolean).slice(0, 8),
    vaultPeriod: response?.vaultPeriod || route?.vaultPeriod || previousState?.vaultPeriod || null,
    vaultCompare: response?.vaultCompare || route?.vaultCompare || previousState?.vaultCompare || null,
    resolvedQuestion: resolvedQuestion || question || null,
    originalQuestion: question || null,
  };
}

/**
 * Bridge legacy flat context fields into ConversationState V1.
 */
export function conversationStateFromLegacyContext(context = {}) {
  if (context?.activeState?.version === CONVERSATION_STATE_VERSION) {
    return { ...createEmptyConversationState(), ...context.activeState };
  }

  const state = createEmptyConversationState();
  state.branch = normalizeBranchId(context.lastBranch);
  state.branchLabel = context.lastBranch || null;
  state.intent = context.lastIntent || null;
  state.metric = inferMetricFromQuestion(context.lastResolvedQuestion || context.lastQuestion)
    || (context.lastMetric && !String(context.lastMetric).startsWith("vault_") ? context.lastMetric : null)
    || (state.intent === ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY ? "net_sales" : null);
  state.metricLabel = metricToPhrase(state.metric);
  state.period = context.lastPeriod
    ? { rangeId: context.lastPeriod, label: context.lastPeriod, periodType: context.lastPeriod }
    : null;
  state.resolvedQuestion = context.lastResolvedQuestion || context.lastQuestion || null;
  state.originalQuestion = context.lastQuestion || null;
  state.dataset = context.lastDataset || null;
  if (state.branch) state.branchHistory = [state.branch];
  return state;
}

export function hasActionableConversationState(state) {
  if (!state) return false;
  return Boolean(
    state.resolvedQuestion
    || state.intent
    || state.metric
    || state.period
    || state.dataset,
  );
}

export function shouldInvalidateConversationState(question = "") {
  const q = String(question || "").toLowerCase().trim();
  if (!q) return false;
  if (/^(new question|start over|reset context|forget context)\b/.test(q)) return true;
  if (/^help\b/.test(q) && q.length < 20) return false;
  return false;
}

export function isVaultConversationIntent(intent) {
  return VAULT_DATA_INTENTS.has(intent);
}

export function buildBaseQuestionFromState(state = {}) {
  const metricPhrase = metricToPhrase(state.metric);
  const periodLabel = state.period?.label || state.vaultPeriod?.label || "the active period";
  const branchSuffix = state.branchLabel ? ` for ${state.branchLabel}` : "";
  const filterSuffix = state.filters?.deliveryOnly ? " delivery only" : "";
  const platform = state.filters?.deliveryPlatform;
  const platformSuffix = platform ? ` ${platform} only` : "";
  return `Show ${metricPhrase} for ${periodLabel}${branchSuffix}${filterSuffix}${platformSuffix}`.replace(/\s+/g, " ").trim();
}
