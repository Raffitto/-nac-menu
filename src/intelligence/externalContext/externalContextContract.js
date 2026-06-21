/**
 * External Context Intelligence — contracts and validation.
 * Schema-aligned types for future API ingestion; no live collectors.
 */

import { NIL_DOMAINS } from "../nil/nilContract";
import { validateExternalContextSignalScope } from "./externalContextRlsContract";

/** @enum {string} */
export const EXTERNAL_SIGNAL_TYPES = Object.freeze({
  WEATHER: "weather",
  COMPETITOR: "competitor",
  MALL_EVENT: "mall_event",
  PUBLIC_HOLIDAY: "public_holiday",
  SCHOOL_CALENDAR: "school_calendar",
  LOCAL_EVENT: "local_event",
  TRAFFIC: "traffic",
  ROAD_CLOSURE: "road_closure",
  NEWS: "news",
  TOURISM: "tourism",
  MACRO: "macro",
  MANUAL_OBSERVATION: "manual_observation",
});

export const EXTERNAL_IMPACT_DIRECTIONS = Object.freeze({
  UP: "up",
  DOWN: "down",
  NEUTRAL: "neutral",
  MIXED: "mixed",
  UNKNOWN: "unknown",
});

export const EXTERNAL_CONFIDENCE_LEVELS = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});

/** Maps DB signal_type → NIL bundle key (via domain registry). */
export const SIGNAL_TYPE_TO_NIL_DOMAIN = Object.freeze({
  [EXTERNAL_SIGNAL_TYPES.WEATHER]: NIL_DOMAINS.WEATHER,
  [EXTERNAL_SIGNAL_TYPES.COMPETITOR]: NIL_DOMAINS.COMPETITIVE,
  [EXTERNAL_SIGNAL_TYPES.MALL_EVENT]: NIL_DOMAINS.LOCATION,
  [EXTERNAL_SIGNAL_TYPES.PUBLIC_HOLIDAY]: NIL_DOMAINS.CALENDAR,
  [EXTERNAL_SIGNAL_TYPES.SCHOOL_CALENDAR]: NIL_DOMAINS.CALENDAR,
  [EXTERNAL_SIGNAL_TYPES.LOCAL_EVENT]: NIL_DOMAINS.LOCATION,
  [EXTERNAL_SIGNAL_TYPES.TRAFFIC]: NIL_DOMAINS.LOCATION,
  [EXTERNAL_SIGNAL_TYPES.ROAD_CLOSURE]: NIL_DOMAINS.LOCATION,
  [EXTERNAL_SIGNAL_TYPES.NEWS]: NIL_DOMAINS.MACROECONOMIC,
  [EXTERNAL_SIGNAL_TYPES.TOURISM]: NIL_DOMAINS.MACROECONOMIC,
  [EXTERNAL_SIGNAL_TYPES.MACRO]: NIL_DOMAINS.MACROECONOMIC,
  [EXTERNAL_SIGNAL_TYPES.MANUAL_OBSERVATION]: NIL_DOMAINS.COMPETITIVE,
});

export const EXTERNAL_CONTEXT_UNAVAILABLE_NOTE =
  "No external context sources are connected yet.";

/** Language patterns adapters must not emit as definitive causality. */
export const FORBIDDEN_CAUSALITY_PATTERNS = [
  /\bbecause (the )?weather\b/i,
  /\bbecause (it )?rained\b/i,
  /\bsales dropped because\b/i,
  /\bdue to humidity\b/i,
  /\bcaused by competitors?\b/i,
  /\bcompetitors caused\b/i,
];

const VALID_BRANCHES = new Set(["khobar", "riyadh", "jeddah"]);

/**
 * @param {string} name
 * @returns {string}
 */
export function normalizeCompetitorName(name = "") {
  return String(name)
    .trim()
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s&'./-]/gu, "")
    .toLowerCase();
}

/**
 * @param {Record<string, unknown>} row
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateExternalContextSignalRow(row = {}) {
  const errors = [];
  const scope = validateExternalContextSignalScope(row);
  if (!scope.valid) errors.push(...scope.errors);

  if (!row.signal_type || !Object.values(EXTERNAL_SIGNAL_TYPES).includes(row.signal_type)) {
    errors.push("signal_type must be a known EXTERNAL_SIGNAL_TYPES value");
  }
  if (row.branch_id != null && !VALID_BRANCHES.has(row.branch_id)) {
    errors.push("branch_id must be khobar, riyadh, jeddah, or null");
  }
  if (!row.title && !row.description) {
    errors.push("title or description is required");
  }
  if (row.source_reliability != null) {
    const r = Number(row.source_reliability);
    if (!Number.isFinite(r) || r < 0 || r > 1) errors.push("source_reliability must be 0–1");
  }
  if (row.confidence != null && !Object.values(EXTERNAL_CONFIDENCE_LEVELS).includes(row.confidence)) {
    errors.push("confidence must be high, medium, or low");
  }
  return { valid: errors.length === 0, errors };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCompetitorRow(row = {}) {
  const errors = [];
  if (!row.name || !String(row.name).trim()) errors.push("name is required");
  if (row.branch_id != null && !VALID_BRANCHES.has(row.branch_id)) {
    errors.push("branch_id must be khobar, riyadh, jeddah, or null");
  }
  return { valid: errors.length === 0, errors };
}

/**
 * @param {string} signalType
 * @returns {string|null}
 */
export function mapSignalTypeToNilDomain(signalType) {
  return SIGNAL_TYPE_TO_NIL_DOMAIN[signalType] || null;
}

/**
 * Score overlap between a signal window and a query period.
 * @param {{ start_at?: string, end_at?: string, signal_date?: string }} signal
 * @param {{ startDate?: string, endDate?: string }} period
 * @returns {"high"|"medium"|"low"|"none"}
 */
export function scoreSignalPeriodOverlap(signal = {}, period = {}) {
  const start = signal.start_at || signal.signal_date;
  const end = signal.end_at || signal.signal_date;
  const pStart = period.startDate;
  const pEnd = period.endDate;
  if (!start || !pStart || !pEnd) return "low";
  const s = new Date(start).getTime();
  const e = new Date(end || start).getTime();
  const ps = new Date(pStart).getTime();
  const pe = new Date(pEnd).getTime();
  if (Number.isNaN(s) || Number.isNaN(ps) || Number.isNaN(pe)) return "low";
  if (s <= pe && e >= ps) return "high";
  const dayMs = 86400000;
  if (Math.abs(s - ps) <= dayMs * 2 || Math.abs(e - pe) <= dayMs * 2) return "medium";
  return "none";
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function containsForbiddenCausalityLanguage(text = "") {
  return FORBIDDEN_CAUSALITY_PATTERNS.some((pattern) => pattern.test(text));
}
