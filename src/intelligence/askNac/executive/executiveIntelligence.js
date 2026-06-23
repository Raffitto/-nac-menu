/**
 * Executive Intelligence Layer — restaurant heuristics, hypothesis ranking, evidence mapping.
 * Applied before generating recommendations in Ask NAC answers.
 */

import {
  deriveTrafficSpendInterpretation,
  deriveRecommendedAction,
} from "../interpretation/operationalInterpretation";

const HEURISTIC_RULES = Object.freeze([
  {
    id: "traffic_problem",
    match: ({ guestsDir, spendDir }) => guestsDir === "down" && spendDir === "stable",
    hypothesis: "Traffic problem — fewer guests with stable average spend.",
    confidence: "medium",
  },
  {
    id: "spending_problem",
    match: ({ guestsDir, spendDir }) => guestsDir === "stable" && spendDir === "down",
    hypothesis: "Spending problem — guest count held but average spend fell.",
    confidence: "medium",
  },
  {
    id: "platform_issue",
    match: ({ deliveryDir, dineInDir }) => deliveryDir === "down" && dineInDir === "stable",
    hypothesis: "Platform issue — delivery softened while dine-in held steady.",
    confidence: "medium",
  },
  {
    id: "competitor_displacement",
    match: ({ patioUp, nacDown, branchMemory }) => {
      const hasPatioSignal = branchMemory?.some((m) => /patio|competitor|football/i.test(m.fact));
      return hasPatioSignal && patioUp && nacDown;
    },
    hypothesis: "Possible competitor displacement — patio traffic up while NAC traffic down.",
    confidence: "low",
  },
]);

function pctChange(current, previous) {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
  return ((c - p) / p) * 100;
}

function direction(current, previous, thresholdPct = 2) {
  const change = pctChange(current, previous);
  if (change == null) return "unknown";
  if (Math.abs(change) < thresholdPct) return "stable";
  return change > 0 ? "up" : "down";
}

function buildDirectionContext(current = {}, previous = {}) {
  const guestsDir = direction(current.totalGuests, previous.totalGuests);
  const spendDir = direction(current.averageSpend, previous.averageSpend);
  const deliveryDir = direction(current.totalDeliverySales, previous.totalDeliverySales);
  const salesDir = direction(current.totalSales, previous.totalSales);
  const dineInDir = salesDir;
  return { guestsDir, spendDir, deliveryDir, salesDir, dineInDir, patioUp: false, nacDown: salesDir === "down" };
}

/**
 * Apply operational heuristics before generating recommendations.
 *
 * @returns {{ interpretation: string|null, recommendedAction: string|null, heuristics: object[] }}
 */
export function applyRestaurantHeuristics(current = {}, previous = {}, branchMemory = []) {
  const ctx = buildDirectionContext(current, previous);
  const matched = HEURISTIC_RULES
    .filter((rule) => {
      try {
        return rule.match({ ...ctx, branchMemory });
      } catch {
        return false;
      }
    })
    .map((rule) => ({
      id: rule.id,
      hypothesis: rule.hypothesis,
      confidence: rule.confidence,
      evidence: [],
    }));

  const interpretation = deriveTrafficSpendInterpretation(current, previous)
    || matched[0]?.hypothesis
    || null;
  const recommendedAction = deriveRecommendedAction(interpretation);

  return { interpretation, recommendedAction, heuristics: matched };
}

/**
 * Rank hypotheses by confidence (high > medium > low) then by evidence count.
 */
export function rankHypotheses(hypotheses = []) {
  const order = { high: 0, medium: 1, low: 2 };
  return [...hypotheses].sort((a, b) => {
    const confA = order[String(a.confidence || "medium").toLowerCase()] ?? 1;
    const confB = order[String(b.confidence || "medium").toLowerCase()] ?? 1;
    if (confA !== confB) return confA - confB;
    const evA = Array.isArray(a.evidence) ? a.evidence.length : 0;
    const evB = Array.isArray(b.evidence) ? b.evidence.length : 0;
    return evB - evA;
  });
}

/**
 * Map a conclusion to supporting metrics, facts, and branch memory.
 * Clearly distinguishes facts from assumptions.
 */
export function buildEvidenceMap({
  conclusion = "",
  metrics = [],
  facts = [],
  branchMemory = [],
  assumptions = [],
} = {}) {
  return {
    conclusion,
    supportingMetrics: (metrics || []).map((m) => ({
      label: m.label || m.key,
      value: m.value,
      source: m.source || "vault",
      type: "fact",
    })),
    supportingFacts: (facts || []).map((f) => ({
      text: typeof f === "string" ? f : f.text,
      source: typeof f === "object" ? f.source : "data",
      type: "fact",
    })),
    supportingMemory: (branchMemory || []).map((m) => ({
      text: typeof m === "string" ? m : m.fact,
      category: typeof m === "object" ? m.category : "operational",
      type: "memory",
    })),
    assumptions: (assumptions || []).map((a) => ({
      text: typeof a === "string" ? a : a.text,
      type: "assumption",
    })),
  };
}

/**
 * Build ranked hypothesis list for "why" answers.
 */
export function buildRankedHypotheses({ heuristics = [], nilHypotheses = [], metrics = [] } = {}) {
  const combined = [
    ...heuristics.map((h) => ({
      hypothesis: h.hypothesis,
      evidence: metrics.slice(0, 3).map((m) => `${m.label}: ${m.value}`),
      confidence: h.confidence || "medium",
      source: "heuristic",
    })),
    ...(nilHypotheses || []).map((h) => ({
      hypothesis: h.text || h.hypothesis,
      evidence: (h.evidence || []).map((e) => (typeof e === "string" ? e : e.text)).filter(Boolean),
      confidence: h.confidence || "medium",
      source: "nil",
    })),
  ];
  return rankHypotheses(combined);
}
