/**
 * NIL confidence scoring — source count, reliability, agreement, historical consistency.
 */

import { CONFIDENCE, minConfidence } from "../../platform/contracts/dataConfidence";

const CONFIDENCE_ORDER = { [CONFIDENCE.HIGH]: 3, [CONFIDENCE.MEDIUM]: 2, [CONFIDENCE.LOW]: 1 };

/**
 * @param {Object} params
 * @param {import("./nilContract").NilSource[]} [params.sources]
 * @param {number} [params.sourceCount]
 * @param {number} [params.reliability] 0–1 average reliability
 * @param {number} [params.agreementCount] domains or signals agreeing
 * @param {number} [params.historicalConsistency] 0–1
 * @returns {{ confidence: string, factors: Object }}
 */
export function scoreStatementConfidence({
  sources = [],
  sourceCount,
  reliability,
  agreementCount = 0,
  historicalConsistency = null,
} = {}) {
  const count = sourceCount ?? sources.length;
  const avgReliability = Number.isFinite(reliability)
    ? reliability
    : averageReliability(sources);

  let score = 0;
  const factors = {
    sourceCount: count,
    averageReliability: round2(avgReliability),
    agreementCount,
    historicalConsistency: historicalConsistency == null ? null : round2(historicalConsistency),
  };

  if (count >= 3) score += 2;
  else if (count === 2) score += 1;
  else if (count === 1) score += 0;

  if (avgReliability >= 0.85) score += 2;
  else if (avgReliability >= 0.65) score += 1;

  if (agreementCount >= 2) score += 1;
  if (historicalConsistency != null) {
    if (historicalConsistency >= 0.7) score += 1;
    else if (historicalConsistency < 0.4) score -= 1;
  }

  let confidence = CONFIDENCE.LOW;
  if (score >= 4) confidence = CONFIDENCE.HIGH;
  else if (score >= 2) confidence = CONFIDENCE.MEDIUM;

  return { confidence, factors };
}

/**
 * @param {import("./nilContract").NilReasoningStatement[]} facts
 * @param {import("./nilContract").NilReasoningStatement[]} correlations
 * @param {import("./nilContract").NilReasoningStatement[]} hypotheses
 */
export function scoreOverallReasoningConfidence(facts = [], correlations = [], hypotheses = []) {
  const factLevels = facts.map((f) => f.confidence).filter(Boolean);
  const correlationLevels = correlations.map((c) => c.confidence).filter(Boolean);
  const hypothesisLevels = hypotheses.map((h) => h.confidence).filter(Boolean);

  const domainCount = new Set([
    ...facts.flatMap((f) => f.domains || []),
    ...correlations.flatMap((c) => c.domains || []),
  ]).size;

  const base = minConfidence(
    averageLevel(factLevels),
    averageLevel(correlationLevels),
    hypothesisLevels.length ? minConfidence(...hypothesisLevels) : CONFIDENCE.MEDIUM,
  );

  let confidence = base;
  if (!facts.length) confidence = CONFIDENCE.LOW;
  else if (facts.length >= 2 && domainCount >= 2 && correlations.length) {
    confidence = bumpConfidence(base);
  } else if (facts.length >= 1 && !correlations.length) {
    confidence = minConfidence(base, CONFIDENCE.MEDIUM);
  }

  return {
    confidence,
    factors: {
      factCount: facts.length,
      correlationCount: correlations.length,
      hypothesisCount: hypotheses.length,
      domainCount,
      factConfidence: averageLevel(factLevels),
      correlationConfidence: averageLevel(correlationLevels),
    },
  };
}

function averageReliability(sources = []) {
  if (!sources.length) return 0.35;
  const values = sources.map((s) => Number(s.reliability)).filter(Number.isFinite);
  if (!values.length) return 0.5;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function averageLevel(levels = []) {
  if (!levels.length) return CONFIDENCE.LOW;
  const scores = levels.map((l) => CONFIDENCE_ORDER[l] || 1);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avg >= 2.5) return CONFIDENCE.HIGH;
  if (avg >= 1.5) return CONFIDENCE.MEDIUM;
  return CONFIDENCE.LOW;
}

function bumpConfidence(level) {
  if (level === CONFIDENCE.LOW) return CONFIDENCE.MEDIUM;
  if (level === CONFIDENCE.MEDIUM) return CONFIDENCE.HIGH;
  return CONFIDENCE.HIGH;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
