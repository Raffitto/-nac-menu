/**
 * Operational importance weighting — premium restaurant operator logic, not spreadsheet math.
 */

const RULE_WEIGHTS = {
  fries_burger: 1.05,
  truffle_rigatoni: 1.45,
  chocolate_dessert: 1.35,
  shot_coffee: 0.72,
  milk_coffee: 0.78,
  syrup_pancakes: 0.38,
  truffle_burger: 1.2,
};

const PREMIUM_PATTERNS = [
  "prawn",
  "shrimp",
  "sumac",
  "wagyu",
  "truffle",
  "mocktail",
  "mojito",
  "lemonade",
  "vanilla",
  "chocolate sauce",
  "dessert",
  "steak",
  "premium",
  "protein",
  "halloumi",
  "avocado",
];

const LOW_PRIORITY_PATTERNS = ["maple syrup", "syrup", "extra shot", "fresh milk", "milk"];

function patternBoost(text = "") {
  const n = String(text).toLowerCase();
  let boost = 1;
  if (PREMIUM_PATTERNS.some((p) => n.includes(p))) boost += 0.35;
  if (LOW_PRIORITY_PATTERNS.some((p) => n.includes(p))) boost -= 0.45;
  return Math.max(0.25, boost);
}

/**
 * Weight attachment opportunity for executive prioritization.
 */
export function applyOperationalImportance(pair) {
  const baseWeight = RULE_WEIGHTS[pair.id] ?? 1;
  const labelBoost = patternBoost(pair.label);
  const parentBoost = (pair.topParents || []).slice(0, 2).reduce((s, p) => s + patternBoost(p.name) * 0.15, 0);
  const weight = baseWeight * labelBoost + parentBoost;

  const weightedGap = (pair.gap || 0) * weight;
  const weightedLostRevenue = Math.round((pair.estimatedLostRevenue || 0) * weight);
  const weightedOpportunityScore = Math.min(
    100,
    Math.round((pair.opportunityScore || 0) * weight * 0.85 + (weightedLostRevenue > 500 ? 8 : 0)),
  );

  return {
    ...pair,
    operationalWeight: Math.round(weight * 100) / 100,
    weightedOpportunityScore,
    weightedLostRevenue,
    weightedGap,
    strategicallyPrioritized: weight >= 1.1,
  };
}

export function rankAttachmentOpportunities(pairs = []) {
  return [...pairs]
    .map(applyOperationalImportance)
    .sort((a, b) => b.weightedOpportunityScore - a.weightedOpportunityScore);
}
