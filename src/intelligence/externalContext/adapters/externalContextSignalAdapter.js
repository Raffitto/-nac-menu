/**
 * External context → NIL signal adapter.
 * Converts DB rows into businessReasoningEngine bundle inputs.
 * Does not invent causality — uses correlation/hypothesis evidence levels only.
 */

import { createEmptySignalBundleInput, EVIDENCE_LEVELS, NIL_DOMAINS } from "../../nil/nilContract";
import {
  EXTERNAL_CONFIDENCE_LEVELS,
  EXTERNAL_SIGNAL_TYPES,
  mapSignalTypeToNilDomain,
  scoreSignalPeriodOverlap,
} from "../externalContextContract";
import { normalizeCompetitorRecord } from "../competitorRegistry";

const BUNDLE_KEYS = {
  [NIL_DOMAINS.WEATHER]: "weatherSignals",
  [NIL_DOMAINS.COMPETITIVE]: "competitorSignals",
  [NIL_DOMAINS.CALENDAR]: "calendarSignals",
  [NIL_DOMAINS.LOCATION]: "locationSignals",
  [NIL_DOMAINS.MACROECONOMIC]: "macroSignals",
};

/**
 * @param {Object} input
 * @param {Array<Record<string, unknown>>} [input.externalSignals]
 * @param {Array<Record<string, unknown>>} [input.competitorObservations]
 * @param {Array<Record<string, unknown>>} [input.competitors]
 * @param {Object} [input.period]
 * @param {string} [input.branchLabel]
 * @param {string} [input.periodLabel]
 * @returns {import("../nil/nilContract").NilSignalBundleInput}
 */
export function adaptExternalContextToNilBundle(input = {}) {
  const bundle = createEmptySignalBundleInput();
  const competitorsById = new Map(
    (input.competitors || []).map((c) => [c.id, normalizeCompetitorRecord(c)]),
  );

  for (const row of input.externalSignals || []) {
    const nilSignal = externalSignalRowToNil(row, {
      branchLabel: input.branchLabel,
      periodLabel: input.periodLabel,
      period: input.period,
    });
    if (!nilSignal) continue;
    const domain = mapSignalTypeToNilDomain(row.signal_type);
    const key = BUNDLE_KEYS[domain];
    if (key && bundle[key]) bundle[key].push(nilSignal);
  }

  for (const obs of input.competitorObservations || []) {
    const nilSignal = competitorObservationToNil(obs, competitorsById.get(obs.competitor_id), {
      branchLabel: input.branchLabel,
      periodLabel: input.periodLabel,
      period: input.period,
    });
    if (nilSignal) bundle.competitorSignals.push(nilSignal);
  }

  return bundle;
}

function externalSignalRowToNil(row, context = {}) {
  const domain = mapSignalTypeToNilDomain(row.signal_type);
  if (!domain) return null;

  const overlap = scoreSignalPeriodOverlap(row, context.period || {});
  const reliability = Number(row.source_reliability);
  const text = buildExternalSignalText(row);
  const evidenceLevel = row.signal_type === EXTERNAL_SIGNAL_TYPES.WEATHER
    ? EVIDENCE_LEVELS.CORRELATION
    : EVIDENCE_LEVELS.CORRELATION;

  return {
    domain,
    type: row.signal_type === EXTERNAL_SIGNAL_TYPES.WEATHER ? "metric" : "observation",
    label: String(row.title || row.description || "External signal").slice(0, 200),
    value: text,
    direction: row.impact_direction || null,
    evidenceLevel,
    observation: true,
    source: row.source_name || "External context registry",
    sourceDetail: [row.source_type, row.location_label].filter(Boolean).join(" · "),
    reliability: Number.isFinite(reliability) ? reliability : defaultReliability(row),
    branchLabel: context.branchLabel || row.branch_id || "",
    periodLabel: context.periodLabel || "",
    metadata: {
      ...(row.metadata || {}),
      signalId: row.id,
      overlap,
      confidence: row.confidence,
      sourceUrl: row.source_url,
      impactedMetrics: row.impacted_metrics,
      cautiousLanguage: true,
    },
  };
}

function competitorObservationToNil(obs, competitor, context = {}) {
  const name = competitor?.name || "Competitor";
  const text = String(obs.observation_text || "").trim();
  if (!text) return null;

  const cautious = ensureCautiousObservationText(text, name);
  const reliability = Number(obs.source_reliability);

  return {
    domain: NIL_DOMAINS.COMPETITIVE,
    type: "observation",
    label: `${name} observation`,
    value: cautious,
    evidenceLevel: EVIDENCE_LEVELS.CORRELATION,
    observation: cautious,
    source: obs.source_type || "Competitor observation",
    sourceDetail: competitor?.area_label || context.branchLabel || "",
    reliability: Number.isFinite(reliability) ? reliability : 0.5,
    branchLabel: context.branchLabel || obs.branch_id || "",
    periodLabel: context.periodLabel || obs.observation_date || "",
    metadata: {
      competitorId: obs.competitor_id,
      observationDate: obs.observation_date,
      promotionDetected: obs.promotion_detected,
      eventDetected: obs.event_detected,
      overlap: scoreSignalPeriodOverlap(
        { signal_date: obs.observation_date },
        context.period || {},
      ),
    },
  };
}

function buildExternalSignalText(row) {
  const title = row.title ? String(row.title) : "";
  const desc = row.description ? String(row.description) : "";
  const combined = [title, desc].filter(Boolean).join(" — ");
  if (/may have|might|possible|could/i.test(combined)) return combined;
  if (row.signal_type === EXTERNAL_SIGNAL_TYPES.WEATHER) {
    return `${combined} (may have affected walk-in comfort)`.trim();
  }
  return `${combined} (may have contributed to nearby traffic patterns)`.trim();
}

function ensureCautiousObservationText(text, competitorName) {
  if (/may have|might|appeared|observed|possible/i.test(text)) return text;
  return `Observed report: ${competitorName} — ${text} (manual observation; may indicate nearby traffic shift)`;
}

function defaultReliability(row) {
  if (row.source_type === "manual") return 0.45;
  if (row.source_type === "api") return 0.75;
  if (row.confidence === EXTERNAL_CONFIDENCE_LEVELS.HIGH) return 0.8;
  if (row.confidence === EXTERNAL_CONFIDENCE_LEVELS.LOW) return 0.4;
  return 0.55;
}

/**
 * Merge external bundle into an existing NIL input (internal + external).
 * @param {import("../nil/nilContract").NilSignalBundleInput} base
 * @param {import("../nil/nilContract").NilSignalBundleInput} external
 */
export function mergeNilSignalBundles(base = {}, external = {}) {
  const merged = { ...createEmptySignalBundleInput(), ...base };
  for (const key of Object.values(BUNDLE_KEYS)) {
    merged[key] = [...(merged[key] || []), ...(external[key] || [])];
  }
  return merged;
}

/**
 * Whether any external bundle keys have signals.
 * @param {import("../nil/nilContract").NilSignalBundleInput} bundle
 */
export function hasExternalContextSignals(bundle = {}) {
  return Object.values(BUNDLE_KEYS).some((key) => (bundle[key] || []).length > 0);
}
