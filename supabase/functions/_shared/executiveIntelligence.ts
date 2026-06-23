/**
 * Executive Intelligence Layer (Edge) — heuristics, hypothesis ranking, evidence mapping.
 */

function pctChange(current: unknown, previous: unknown) {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
  return ((c - p) / p) * 100;
}

function direction(current: unknown, previous: unknown, thresholdPct = 2) {
  const change = pctChange(current, previous);
  if (change == null) return "unknown";
  if (Math.abs(change) < thresholdPct) return "stable";
  return change > 0 ? "up" : "down";
}

function deriveTrafficSpendInterpretation(
  current: Record<string, unknown> = {},
  previous: Record<string, unknown> = {},
) {
  const salesDir = direction(current.totalSales, previous.totalSales);
  const guestsDir = direction(current.totalGuests, previous.totalGuests);
  const spendDir = direction(current.averageSpend, previous.averageSpend);
  const deliveryDir = direction(current.totalDeliverySales, previous.totalDeliverySales);

  if (salesDir === "down" && guestsDir === "stable" && spendDir === "down") {
    return "The issue appears spend-driven, not traffic-driven — guest count held but average spend fell.";
  }
  if (salesDir === "down" && guestsDir === "down" && spendDir === "stable") {
    return "The issue appears traffic-driven — fewer guests with stable average spend.";
  }
  if (salesDir === "down" && deliveryDir === "up") {
    return "Delivery helped offset weaker dine-in performance during the comparison window.";
  }
  return null;
}

function deriveRecommendedAction(interpretation: string | null) {
  if (!interpretation) return null;
  if (/spend-driven/i.test(interpretation)) {
    return "Review upsell execution, add-on placement, and premium item mix before blaming traffic.";
  }
  if (/traffic-driven/i.test(interpretation)) {
    return "Focus on traffic drivers — reservations, walk-in conversion, and local demand signals.";
  }
  return null;
}

export function applyRestaurantHeuristics(
  current: Record<string, unknown> = {},
  previous: Record<string, unknown> = {},
  branchMemory: { fact?: string }[] = [],
) {
  const guestsDir = direction(current.totalGuests, previous.totalGuests);
  const spendDir = direction(current.averageSpend, previous.averageSpend);
  const deliveryDir = direction(current.totalDeliverySales, previous.totalDeliverySales);
  const salesDir = direction(current.totalSales, previous.totalSales);

  const heuristics: { id: string; hypothesis: string; confidence: string; evidence: string[] }[] = [];
  if (guestsDir === "down" && spendDir === "stable") {
    heuristics.push({
      id: "traffic_problem",
      hypothesis: "Traffic problem — fewer guests with stable average spend.",
      confidence: "medium",
      evidence: [],
    });
  }
  if (guestsDir === "stable" && spendDir === "down") {
    heuristics.push({
      id: "spending_problem",
      hypothesis: "Spending problem — guest count held but average spend fell.",
      confidence: "medium",
      evidence: [],
    });
  }
  if (deliveryDir === "down" && salesDir === "stable") {
    heuristics.push({
      id: "platform_issue",
      hypothesis: "Platform issue — delivery softened while dine-in held steady.",
      confidence: "medium",
      evidence: [],
    });
  }
  if (branchMemory.some((m) => /patio|competitor|football/i.test(m.fact || "")) && salesDir === "down") {
    heuristics.push({
      id: "competitor_displacement",
      hypothesis: "Possible competitor displacement — patio traffic up while NAC traffic down.",
      confidence: "low",
      evidence: [],
    });
  }

  const interpretation = deriveTrafficSpendInterpretation(current, previous) || heuristics[0]?.hypothesis || null;
  return {
    interpretation,
    recommendedAction: deriveRecommendedAction(interpretation),
    heuristics,
  };
}

export function rankHypotheses(hypotheses: Record<string, unknown>[] = []) {
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return [...hypotheses].sort((a, b) => {
    const confA = order[String(a.confidence || "medium").toLowerCase()] ?? 1;
    const confB = order[String(b.confidence || "medium").toLowerCase()] ?? 1;
    if (confA !== confB) return confA - confB;
    const evA = Array.isArray(a.evidence) ? a.evidence.length : 0;
    const evB = Array.isArray(b.evidence) ? b.evidence.length : 0;
    return evB - evA;
  });
}

export function buildEvidenceMap({
  conclusion = "",
  metrics = [],
  facts = [],
  branchMemory = [],
  assumptions = [],
}: Record<string, unknown> = {}) {
  return {
    conclusion,
    supportingMetrics: (metrics as Record<string, unknown>[]).map((m) => ({
      label: m.label || m.key,
      value: m.value,
      source: m.source || "vault",
      type: "fact",
    })),
    supportingFacts: (facts as unknown[]).map((f) => ({
      text: typeof f === "string" ? f : (f as Record<string, unknown>).text,
      type: "fact",
    })),
    supportingMemory: (branchMemory as Record<string, unknown>[]).map((m) => ({
      text: typeof m === "string" ? m : m.fact,
      category: typeof m === "object" ? m.category : "operational",
      type: "memory",
    })),
    assumptions: (assumptions as unknown[]).map((a) => ({
      text: typeof a === "string" ? a : (a as Record<string, unknown>).text,
      type: "assumption",
    })),
  };
}

export function buildRankedHypotheses({
  heuristics = [],
  nilHypotheses = [],
  metrics = [],
}: Record<string, unknown> = {}) {
  const combined = [
    ...(heuristics as Record<string, unknown>[]).map((h) => ({
      hypothesis: h.hypothesis,
      evidence: (metrics as Record<string, unknown>[]).slice(0, 3).map((m) => `${m.label}: ${m.value}`),
      confidence: h.confidence || "medium",
      source: "heuristic",
    })),
    ...(nilHypotheses as Record<string, unknown>[]).map((h) => ({
      hypothesis: h.text || h.hypothesis,
      evidence: (Array.isArray(h.evidence) ? h.evidence : []).map((e) => (typeof e === "string" ? e : (e as Record<string, unknown>).text)).filter(Boolean),
      confidence: h.confidence || "medium",
      source: "nil",
    })),
  ];
  return rankHypotheses(combined);
}
