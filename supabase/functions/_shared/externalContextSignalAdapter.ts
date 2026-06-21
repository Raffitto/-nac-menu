/**
 * External context → NIL signal adapter (Edge mirror).
 */

import { createEmptySignalBundleInput, EVIDENCE_LEVELS, NIL_DOMAINS } from "./nil/nilContract.ts";
import {
  EXTERNAL_CONFIDENCE_LEVELS,
  EXTERNAL_SIGNAL_TYPES,
  mapSignalTypeToNilDomain,
  scoreSignalPeriodOverlap,
} from "./externalContextContract.ts";

const BUNDLE_KEYS: Record<string, string> = {
  [NIL_DOMAINS.WEATHER]: "weatherSignals",
  [NIL_DOMAINS.COMPETITIVE]: "competitorSignals",
  [NIL_DOMAINS.CALENDAR]: "calendarSignals",
  [NIL_DOMAINS.LOCATION]: "locationSignals",
  [NIL_DOMAINS.MACROECONOMIC]: "macroSignals",
};

type NilBundle = Record<string, unknown[]>;

export function adaptExternalContextToNilBundle(input: Record<string, unknown> = {}) {
  const bundle = createEmptySignalBundleInput() as NilBundle;
  const competitorsById = new Map(
    ((input.competitors as Record<string, unknown>[]) || []).map((c) => [c.id, c]),
  );

  for (const row of (input.externalSignals as Record<string, unknown>[]) || []) {
    const nilSignal = externalSignalRowToNil(row, {
      branchLabel: input.branchLabel as string,
      periodLabel: input.periodLabel as string,
      period: input.period as Record<string, unknown>,
    });
    if (!nilSignal) continue;
    const domain = mapSignalTypeToNilDomain(String(row.signal_type || ""));
    const key = domain ? BUNDLE_KEYS[domain] : null;
    if (key && bundle[key]) bundle[key].push(nilSignal);
  }

  for (const obs of (input.competitorObservations as Record<string, unknown>[]) || []) {
    const nilSignal = competitorObservationToNil(
      obs,
      competitorsById.get(obs.competitor_id) as Record<string, unknown> | undefined,
      {
        branchLabel: input.branchLabel as string,
        periodLabel: input.periodLabel as string,
        period: input.period as Record<string, unknown>,
      },
    );
    if (nilSignal) bundle.competitorSignals.push(nilSignal);
  }

  return bundle;
}

function externalSignalRowToNil(row: Record<string, unknown>, context: Record<string, unknown> = {}) {
  const domain = mapSignalTypeToNilDomain(String(row.signal_type || ""));
  if (!domain) return null;

  const overlap = scoreSignalPeriodOverlap(row, (context.period as Record<string, unknown>) || {});
  const reliability = Number(row.source_reliability);
  const text = buildExternalSignalText(row);

  return {
    domain,
    type: row.signal_type === EXTERNAL_SIGNAL_TYPES.WEATHER ? "metric" : "observation",
    label: String(row.title || row.description || "External signal").slice(0, 200),
    value: text,
    direction: row.impact_direction || null,
    evidenceLevel: EVIDENCE_LEVELS.CORRELATION,
    observation: true,
    source: row.source_name || "External context registry",
    sourceDetail: [row.source_type, row.location_label].filter(Boolean).join(" · "),
    reliability: Number.isFinite(reliability) ? reliability : defaultReliability(row),
    branchLabel: context.branchLabel || row.branch_id || "",
    periodLabel: context.periodLabel || "",
    metadata: {
      ...(row.metadata as Record<string, unknown> || {}),
      signalId: row.id,
      overlap,
      confidence: row.confidence,
      sourceUrl: row.source_url,
      impactedMetrics: row.impacted_metrics,
      cautiousLanguage: true,
    },
  };
}

function competitorObservationToNil(
  obs: Record<string, unknown>,
  competitor: Record<string, unknown> | undefined,
  context: Record<string, unknown> = {},
) {
  const name = String(competitor?.name || "Competitor");
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
        { signal_date: obs.observation_date as string },
        (context.period as Record<string, unknown>) || {},
      ),
    },
  };
}

function buildExternalSignalText(row: Record<string, unknown>) {
  const title = row.title ? String(row.title) : "";
  const desc = row.description ? String(row.description) : "";
  const combined = [title, desc].filter(Boolean).join(" — ");
  if (/may have|might|possible|could/i.test(combined)) return combined;
  if (row.signal_type === EXTERNAL_SIGNAL_TYPES.WEATHER) {
    return `${combined} (may have affected walk-in comfort)`.trim();
  }
  return `${combined} (may have contributed to nearby traffic patterns)`.trim();
}

function ensureCautiousObservationText(text: string, competitorName: string) {
  if (/may have|might|appeared|observed|possible/i.test(text)) return text;
  return `Observed report: ${competitorName} — ${text} (manual observation; may indicate nearby traffic shift)`;
}

function defaultReliability(row: Record<string, unknown>) {
  if (row.source_type === "manual") return 0.45;
  if (row.source_type === "api") return 0.75;
  if (row.confidence === EXTERNAL_CONFIDENCE_LEVELS.HIGH) return 0.8;
  if (row.confidence === EXTERNAL_CONFIDENCE_LEVELS.LOW) return 0.4;
  return 0.55;
}

export function mergeNilSignalBundles(base: Record<string, unknown> = {}, external: Record<string, unknown> = {}) {
  const merged = { ...createEmptySignalBundleInput(), ...base } as NilBundle;
  for (const key of Object.values(BUNDLE_KEYS)) {
    merged[key] = [...((merged[key] as unknown[]) || []), ...((external[key] as unknown[]) || [])];
  }
  return merged;
}

export function hasExternalContextSignals(bundle: Record<string, unknown> = {}) {
  return Object.values(BUNDLE_KEYS).some((key) => ((bundle[key] as unknown[]) || []).length > 0);
}
