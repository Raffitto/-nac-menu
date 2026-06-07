/**
 * Session-only Ask NAC conversation memory (no database persistence).
 */

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

  return {
    ...base,
    lastQuestion: question ?? base.lastQuestion,
    lastResolvedQuestion: resolvedQuestion ?? base.lastResolvedQuestion,
    lastIntent: response?.intent ?? route?.intent ?? base.lastIntent,
    lastBranch: response?.branchLabel ?? route?.branchMention ?? base.lastBranch,
    lastPeriod: response?.periodLabel ?? route?.period?.rangeId ?? base.lastPeriod,
    lastMetric: response?.intent ?? route?.intent ?? base.lastMetric,
    lastEntity: pickEntityFromResponse(response) ?? base.lastEntity,
    lastAnswerSummary: response?.directAnswer
      ? String(response.directAnswer).slice(0, 240)
      : base.lastAnswerSummary,
  };
}

export function resetConversationContext() {
  return createEmptyConversationContext();
}
