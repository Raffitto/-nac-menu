/**
 * Coherence helpers: calibrated judgement, sentence dedupe, contradiction checks.
 */

import type { AnalysisIntent } from "./turnSemantics.ts";
import {
  MAGNITUDE_FLAT_PCT,
  MAGNITUDE_MODERATE_PCT,
  MAGNITUDE_SLIGHT_PCT,
  formatPercent,
  isEffectivelyFlat,
  metricCopula,
} from "./managementPresentation.ts";

type AnomalyClass =
  | "normal"
  | "mildly_unusual"
  | "materially_unusual"
  | "strong_outlier"
  | "weak_outlier"
  | null;

export function formatCalibratedJudgement(input: {
  intent: AnalysisIntent;
  label: string;
  dayLabel: string;
  baselineLabel: string;
  deltaPct: number | null;
  anomalyClass: AnomalyClass | null;
  sufficient: boolean;
  insufficientText: string | null;
}): string | null {
  if (!input.sufficient) return input.insufficientText;
  if (input.deltaPct == null) return input.insufficientText;
  const pct = formatPercent(Math.abs(input.deltaPct));
  const copula = metricCopula(input.label);
  const vs = `versus ${input.baselineLabel} (${pct})`;
  const outlier = input.anomalyClass === "strong_outlier" || input.anomalyClass === "weak_outlier";
  const unusual = input.anomalyClass === "materially_unusual" || input.anomalyClass === "mildly_unusual";
  const askingNormal = input.intent === "anomaly";
  const mag = Math.abs(input.deltaPct);
  const up = input.deltaPct > 0;

  if (outlier) {
    return up
      ? `Unusually strong. ${input.dayLabel} ${input.label} ${copula} ${pct} above ${input.baselineLabel}.`
      : `Unusually weak. ${input.dayLabel} ${input.label} ${copula} ${pct} below ${input.baselineLabel}.`;
  }

  if (isEffectivelyFlat(input.deltaPct) || mag < MAGNITUDE_FLAT_PCT) {
    return askingNormal
      ? `Broadly yes — it was around the normal range ${vs}.`
      : `Broadly yes. ${input.dayLabel} ${input.label} ${copula} around ${input.baselineLabel} (${pct}).`;
  }

  if (mag < MAGNITUDE_SLIGHT_PCT) {
    return up
      ? `A little stronger than normal. ${input.dayLabel} ${input.label} ${copula} ${pct} above ${input.baselineLabel}.`
      : `A little softer than normal. ${input.dayLabel} ${input.label} ${copula} ${pct} below ${input.baselineLabel}.`;
  }

  if (mag < MAGNITUDE_MODERATE_PCT) {
    if (askingNormal) {
      return up
        ? `A little stronger than the baseline, not an outlier. ${input.dayLabel} ${input.label} ${copula} ${pct} above ${input.baselineLabel}.`
        : `A little softer than the baseline, not an outlier. ${input.dayLabel} ${input.label} ${copula} ${pct} below ${input.baselineLabel}.`;
    }
    return up
      ? `Broadly yes — a little stronger than ${input.baselineLabel} (${pct}).`
      : `Not particularly. ${input.dayLabel} ${input.label} ${copula} ${pct} below ${input.baselineLabel}.`;
  }

  if (unusual && !outlier) {
    return up
      ? `Yes — strong. ${input.dayLabel} ${input.label} ${copula} ${pct} above ${input.baselineLabel}.`
      : `No. ${input.dayLabel} ${input.label} ${copula} ${pct} below ${input.baselineLabel}.`;
  }

  return up
    ? `Yes. ${input.dayLabel} ${input.label} ${copula} ${pct} above ${input.baselineLabel}.`
    : `No. ${input.dayLabel} ${input.label} ${copula} ${pct} below ${input.baselineLabel}.`;
}

export function combineAnomalyAndTrend(input: {
  anomalyClass: AnomalyClass | null;
  anomalyText: string | null;
  trendClass: string | null;
  trendText: string | null;
  dayLabel: string | null;
  weekdayName: string | null;
}): string | null {
  const normalDay = !input.anomalyClass || input.anomalyClass === "normal";
  const weakDay = input.anomalyClass === "weak_outlier" || input.anomalyClass === "mildly_unusual" || input.anomalyClass === "materially_unusual";
  if (normalDay && input.trendClass === "downward") {
    return `${input.dayLabel || "The day"} itself was within the normal ${input.weekdayName || "weekday"} range, but the broader recent trend is lower.`;
  }
  if (normalDay && input.trendClass === "upward") {
    return `${input.dayLabel || "The day"} itself was within the normal ${input.weekdayName || "weekday"} range, while the broader recent trend is higher.`;
  }
  if (weakDay && (input.trendClass === "broadly_flat" || input.trendClass === "noisy")) {
    return `${input.dayLabel || "This result"} looks more like a one-off than a sustained deterioration.`;
  }
  if (weakDay && input.trendClass === "downward") {
    return "This sits on a downward trend, so it looks like both a notable soft day and broader weakness.";
  }
  return null;
}

export function dedupeSentences(sentences: string[], max = 4): string[] {
  const out: string[] = [];
  const percents = new Set<string>();
  for (const raw of sentences) {
    const s = String(raw || "").replace(/\s+/g, " ").trim();
    if (!s) continue;
    const pcts = s.match(/-?\d+(?:\.\d+)?%/g) || [];
    const dupPct = pcts.some((p) => percents.has(p)) && /versus|down|up|above|below/.test(s)
      && out.some((prev) => pcts.some((p) => prev.includes(p)));
    const overlap = out.some((prev) => {
      const a = prev.toLowerCase();
      const b = s.toLowerCase();
      if (a === b) return true;
      if (a.includes(b) || b.includes(a)) return true;
      const share = (a.split(" ").filter((w) => w.length > 4 && b.includes(w)).length);
      return share >= 8;
    });
    if (overlap || dupPct) continue;
    for (const p of pcts) percents.add(p);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export function validateAnswerCoherence(input: {
  text: string;
  branchId: string | null;
  primaryMetric?: string | null;
  deltaPct?: number | null;
  anomalyClass?: AnomalyClass | null;
  coverageIncomplete?: boolean;
  infeasible?: boolean;
}): string {
  let text = String(input.text || "");
  const lower = text.toLowerCase();
  const delta = input.deltaPct;
  if (delta != null && delta < -MAGNITUDE_FLAT_PCT && /\bincrease\b|\bwere up\b/.test(lower) && /decline|down|below/.test(lower)) {
    text = text.replace(/[^.]*\bincrease\b[^.]*\./gi, "").replace(/\s+/g, " ").trim();
  }
  if (input.anomalyClass === "normal" && /strong (high )?outlier|unusually weak/.test(lower)) {
    text = text.replace(/[^.]*outlier[^.]*\./gi, "").replace(/\s+/g, " ").trim();
  }
  if (input.coverageIncomplete && /complete (month|week|period)/i.test(text)) {
    text = text.replace(/complete (month|week|period)/gi, "observed period");
  }
  if (input.infeasible && /\d+(?:\.\d+)?%/.test(text) && /not operating|not valid/.test(lower) === false) {
    return "This comparison is not valid from the available branch history.";
  }
  if (input.primaryMetric === "covers" && /net sales were/i.test(text) && !/covers/i.test(text)) {
    text = text.replace(/For [^,]+, net sales were[^.]*\./i, "").trim();
  }
  return text.replace(/\s{2,}/g, " ").trim();
}

export function depthLimit(intent: AnalysisIntent, ranking: boolean, comparison: boolean): number {
  if (ranking) return 2;
  if (intent === "judgement" || intent === "anomaly") return 2;
  if (intent === "why" || intent === "contributors" || intent === "breadth") return 4;
  if (intent === "stands_out") return 4;
  if (intent === "action") return 3;
  if (intent === "trend") return 2;
  if (comparison) return 4;
  return 3;
}
