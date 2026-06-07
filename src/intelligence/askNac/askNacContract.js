/**
 * Ask NAC structured response contract — all answers (deterministic or AI-wrapped) use this shape.
 */

export const ANSWER_TYPES = Object.freeze({
  METRIC: "metric",
  LEADERBOARD: "leaderboard",
  COMPARISON: "comparison",
  EXECUTIVE: "executive",
  MISSING_DATA: "missing_data",
  UNKNOWN: "unknown",
  ERROR: "error",
});

export const CONFIDENCE_LEVELS = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  NONE: "none",
});

/** @typedef {import('./askNacContract').AskNacResponse} AskNacResponse */

/**
 * @param {Partial<AskNacResponse>} fields
 * @returns {AskNacResponse}
 */
export function createAskNacResponse(fields = {}) {
  return {
    answerType: fields.answerType || ANSWER_TYPES.UNKNOWN,
    title: fields.title || "Ask NAC",
    directAnswer: fields.directAnswer || "",
    keyMetrics: Array.isArray(fields.keyMetrics) ? fields.keyMetrics : [],
    insights: Array.isArray(fields.insights) ? fields.insights : [],
    recommendations: Array.isArray(fields.recommendations) ? fields.recommendations : [],
    sources: Array.isArray(fields.sources) ? fields.sources : [],
    warnings: Array.isArray(fields.warnings) ? fields.warnings : [],
    missingData: Array.isArray(fields.missingData) ? fields.missingData : [],
    confidence: fields.confidence || CONFIDENCE_LEVELS.MEDIUM,
    exportOptions: Array.isArray(fields.exportOptions) ? fields.exportOptions : [],
    isAiGenerated: Boolean(fields.isAiGenerated),
    intent: fields.intent || null,
    periodLabel: fields.periodLabel || null,
    branchLabel: fields.branchLabel || null,
    serverConnected: fields.serverConnected ?? null,
    readiness: fields.readiness || null,
    diagnostics: fields.diagnostics || null,
    vaultSources: Array.isArray(fields.vaultSources) ? fields.vaultSources : [],
    conversationResolution: fields.conversationResolution || null,
    executiveSummary: fields.executiveSummary || null,
    dataConfidence: fields.dataConfidence || null,
  };
}

export function metricEntry(label, value, { unit = "", source = "", note = "" } = {}) {
  return {
    label,
    value,
    unit,
    source,
    note,
  };
}

export function sourceEntry(name, detail = "") {
  return { name, detail };
}
