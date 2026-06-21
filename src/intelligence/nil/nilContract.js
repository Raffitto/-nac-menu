/**
 * NAC OS Intelligence Layer (NIL) — response contract.
 * Separates confirmed facts, correlations, hypotheses, and recommendations.
 */

import { CONFIDENCE } from "../../platform/contracts/dataConfidence";

export { CONFIDENCE as NIL_CONFIDENCE };

/** @enum {string} */
export const EVIDENCE_LEVELS = Object.freeze({
  FACT: "fact",
  CORRELATION: "correlation",
  HYPOTHESIS: "hypothesis",
  RECOMMENDATION: "recommendation",
  RAW: "raw",
});

/** @enum {string} */
export const NIL_DOMAINS = Object.freeze({
  INTERNAL_OPERATIONAL: "internal_operational",
  COMPETITIVE: "competitive",
  WEATHER: "weather",
  CALENDAR: "calendar",
  LOCATION: "location",
  MACROECONOMIC: "macroeconomic",
  BRAND_HEALTH: "brand_health",
  PRODUCT: "product",
  LABOR: "labor",
});

export const NIL_DOMAIN_LABELS = Object.freeze({
  [NIL_DOMAINS.INTERNAL_OPERATIONAL]: "Internal operational intelligence",
  [NIL_DOMAINS.COMPETITIVE]: "Competitive intelligence",
  [NIL_DOMAINS.WEATHER]: "Weather intelligence",
  [NIL_DOMAINS.CALENDAR]: "Calendar intelligence",
  [NIL_DOMAINS.LOCATION]: "Location intelligence",
  [NIL_DOMAINS.MACROECONOMIC]: "Macroeconomic intelligence",
  [NIL_DOMAINS.BRAND_HEALTH]: "Brand health intelligence",
  [NIL_DOMAINS.PRODUCT]: "Product intelligence",
  [NIL_DOMAINS.LABOR]: "Labor intelligence",
});

/**
 * @typedef {Object} NilSource
 * @property {string} name
 * @property {string} [detail]
 * @property {number} [reliability] 0–1
 * @property {string} [branch]
 * @property {string} [period]
 */

/**
 * @typedef {Object} NilSignal
 * @property {string} id
 * @property {string} domain
 * @property {string} type metric|event|observation|trend|comparison
 * @property {string} label
 * @property {unknown} [value]
 * @property {string} [unit]
 * @property {string|null} [direction] up|down|stable|null
 * @property {string} [periodLabel]
 * @property {string} [branchLabel]
 * @property {NilSource[]} sources
 * @property {number} reliability 0–1
 * @property {string} evidenceLevel
 * @property {string[]} [supports]
 * @property {Record<string, unknown>} [metadata]
 */

/**
 * @typedef {Object} NilReasoningStatement
 * @property {string} id
 * @property {string} level fact|correlation|hypothesis|recommendation
 * @property {string} text
 * @property {string} confidence high|medium|low
 * @property {NilSource[]} sources
 * @property {string[]} [supportingSignalIds]
 * @property {string[]} [domains]
 */

/**
 * @typedef {Object} NilReasoningResult
 * @property {NilReasoningStatement[]} facts
 * @property {NilReasoningStatement[]} correlations
 * @property {NilReasoningStatement[]} hypotheses
 * @property {NilReasoningStatement[]} recommendations
 * @property {string} confidence high|medium|low
 * @property {Object} confidenceFactors
 * @property {Object} meta
 */

/**
 * @typedef {Object} NilSignalBundleInput
 * @property {unknown[]} [internalSignals]
 * @property {unknown[]} [competitorSignals]
 * @property {unknown[]} [weatherSignals]
 * @property {unknown[]} [calendarSignals]
 * @property {unknown[]} [locationSignals]
 * @property {unknown[]} [macroSignals]
 * @property {unknown[]} [brandSignals]
 * @property {unknown[]} [productSignals]
 * @property {unknown[]} [laborSignals]
 * @property {string} [question]
 * @property {string} [branchLabel]
 * @property {string} [periodLabel]
 */

let statementCounter = 0;

export function resetNilStatementCounter() {
  statementCounter = 0;
}

export function nextNilStatementId(prefix = "nil") {
  statementCounter += 1;
  return `${prefix}-${statementCounter}`;
}

/**
 * @param {Partial<NilSignal>} fields
 * @returns {NilSignal}
 */
export function createSignal(fields = {}) {
  return {
    id: fields.id || nextNilStatementId("signal"),
    domain: fields.domain || NIL_DOMAINS.INTERNAL_OPERATIONAL,
    type: fields.type || "metric",
    label: fields.label || "",
    value: fields.value ?? null,
    unit: fields.unit || "",
    direction: fields.direction ?? null,
    periodLabel: fields.periodLabel || "",
    branchLabel: fields.branchLabel || "",
    sources: Array.isArray(fields.sources) ? fields.sources : [],
    reliability: Number.isFinite(fields.reliability) ? fields.reliability : 0.5,
    evidenceLevel: fields.evidenceLevel || EVIDENCE_LEVELS.RAW,
    supports: Array.isArray(fields.supports) ? fields.supports : [],
    metadata: fields.metadata || {},
  };
}

/**
 * @param {Partial<NilReasoningStatement>} fields
 * @returns {NilReasoningStatement}
 */
export function createReasoningStatement(fields = {}) {
  return {
    id: fields.id || nextNilStatementId(fields.level || "stmt"),
    level: fields.level || EVIDENCE_LEVELS.FACT,
    text: String(fields.text || "").trim(),
    confidence: fields.confidence || CONFIDENCE.MEDIUM,
    sources: Array.isArray(fields.sources) ? fields.sources : [],
    supportingSignalIds: Array.isArray(fields.supportingSignalIds) ? fields.supportingSignalIds : [],
    domains: Array.isArray(fields.domains) ? fields.domains : [],
  };
}

/**
 * @param {Partial<NilReasoningResult>} fields
 * @returns {NilReasoningResult}
 */
export function createNilReasoningResult(fields = {}) {
  return {
    facts: Array.isArray(fields.facts) ? fields.facts : [],
    correlations: Array.isArray(fields.correlations) ? fields.correlations : [],
    hypotheses: Array.isArray(fields.hypotheses) ? fields.hypotheses : [],
    recommendations: Array.isArray(fields.recommendations) ? fields.recommendations : [],
    confidence: fields.confidence || CONFIDENCE.LOW,
    confidenceFactors: fields.confidenceFactors || {},
    meta: fields.meta || {},
  };
}

export function createEmptySignalBundleInput() {
  return {
    internalSignals: [],
    competitorSignals: [],
    weatherSignals: [],
    calendarSignals: [],
    locationSignals: [],
    macroSignals: [],
    brandSignals: [],
    productSignals: [],
    laborSignals: [],
  };
}
