/**
 * Session-only Ask NAC conversation memory (no database persistence).
 */

import {
  captureConversationStateFromTurn,
  createEmptyConversationState,
  inferMetricFromQuestion,
  shouldInvalidateConversationState,
} from "./conversationState";

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

function pickDocumentContextFromResponse(response) {
  if (!response) return null;
  if (response.intent !== "vault_document_search" && response.intent !== "vault_document_summary") {
    return null;
  }

  const sources = response.vaultSources || [];
  const fileIds = sources.map((s) => s.fileId).filter(Boolean);
  const fileTitles = sources.map((s) => s.title).filter(Boolean);

  if (!fileIds.length && Array.isArray(response.keyMetrics)) {
    for (const metric of response.keyMetrics) {
      if (metric?.label) fileTitles.push(metric.label);
    }
  }

  if (!fileIds.length && !fileTitles.length) return null;

  return {
    fileIds,
    fileTitles,
    searchTerms: response.searchTerms || null,
  };
}

function pickEntityFromResponse(response) {
  if (!response) return null;
  if (response.intent === "category_sales") {
    const metric = response.keyMetrics?.find((m) => /category/i.test(m.label || ""));
    if (metric?.value) return String(metric.value);
    const match = String(response.directAnswer || "").match(/^\s*([^—–]+?)\s+category/i);
    if (match) return match[1].trim();
  }
  if (response.intent === "vault_coverage_list") {
    const period = response.periodLabel || response.vaultPeriod?.label;
    if (period) return period;
  }
  return null;
}

export function updateConversationContext(context = {}, payload = {}) {
  const base = { ...createEmptyConversationContext(), ...context };
  const { question, resolvedQuestion, response, route } = payload;

  if (question && shouldInvalidateConversationState(question)) {
    return createEmptyConversationContext();
  }

  const nextResolvedQuestion = resolvedQuestion ?? base.lastResolvedQuestion;
  const nextIntent = response?.intent ?? route?.intent ?? base.lastIntent;
  const nextBranch = response?.branchLabel ?? route?.branchMention ?? base.lastBranch;
  const nextPeriod = response?.periodLabel ?? route?.period?.rangeId ?? route?.vaultPeriod?.periodType ?? base.lastPeriod;
  const nextMetric =
    inferMetricFromQuestion(nextResolvedQuestion || question)
    || response?.conversationDataset?.metric
    || base.lastMetric;
  const nextDataset = response?.conversationDataset ?? base.lastDataset;

  const activeState = captureConversationStateFromTurn({
    question,
    resolvedQuestion: nextResolvedQuestion,
    response,
    route,
    previousState: base.activeState,
  });

  return {
    ...base,
    lastQuestion: question ?? base.lastQuestion,
    lastResolvedQuestion: nextResolvedQuestion,
    lastIntent: nextIntent,
    lastBranch: nextBranch,
    lastPeriod: nextPeriod,
    lastMetric: nextMetric,
    lastEntity: pickEntityFromResponse(response) ?? base.lastEntity,
    lastAnswerSummary: response?.directAnswer
      ? String(response.directAnswer).slice(0, 240)
      : base.lastAnswerSummary,
    lastDocumentContext:
      pickDocumentContextFromResponse(response) ?? base.lastDocumentContext,
    lastDataset: nextDataset,
    activeState,
    pendingSessionId: response?.awaitingInput
      ? (response?.pendingSessionId || response?.pendingSession?.id || base.pendingSessionId)
      : (response?.pendingSession?.status === "complete" ? null : (response?.pendingSessionId ?? base.pendingSessionId)),
    awaitingInput: Boolean(response?.awaitingInput),
  };
}

export function resetConversationContext() {
  return createEmptyConversationContext();
}
