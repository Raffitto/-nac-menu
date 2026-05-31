/**
 * Global executive visual language — semantic colors, labels, terminology.
 * Every chart and PDF export should import from here.
 */

export const SEMANTIC = {
  gold: "#d7bc8a",
  goldRgb: [215, 188, 138],
  teal: "#4ecdc4",
  tealRgb: [78, 205, 196],
  red: "#e85d4c",
  redRgb: [232, 93, 76],
  amber: "#f5a623",
  amberRgb: [245, 166, 35],
  gray: "#8F7A5F",
  grayRgb: [143, 122, 95],
  neutral: "rgba(249,249,247,0.45)",
  pageBg: "#0c0c0e",
  cardBg: "rgba(22,24,28,0.95)",
};

/** Semantic meaning: benchmark / target / strategic KPI */
export const COLOR_BENCHMARK = SEMANTIC.goldRgb;
/** Actual performance / premium achievement */
export const COLOR_PERFORMANCE = SEMANTIC.tealRgb;
/** Leakage / risk / monetization loss */
export const COLOR_RISK = SEMANTIC.redRgb;
/** Opportunity / recoverable upside */
export const COLOR_OPPORTUNITY = SEMANTIC.amberRgb;
/** Baseline / neutral */
export const COLOR_NEUTRAL = SEMANTIC.grayRgb;

export const SHIFT_LABELS = {
  breakfast: "Morning shift",
  pm: "Dinner shift",
  balanced: "Mixed daypart",
};

export const REVENUE_QUALITY_BANDS = {
  elite: { min: 85, label: "Elite monetization" },
  strong: { min: 72, label: "Strong revenue quality" },
  average: { min: 52, label: "Average revenue quality" },
  developing: { min: 38, label: "Developing monetization" },
  weak: { min: 0, label: "Margin risk profile" },
};

export function revenueQualityBand(score) {
  const s = score ?? 0;
  if (s >= REVENUE_QUALITY_BANDS.elite.min) return REVENUE_QUALITY_BANDS.elite;
  if (s >= REVENUE_QUALITY_BANDS.strong.min) return REVENUE_QUALITY_BANDS.strong;
  if (s >= REVENUE_QUALITY_BANDS.average.min) return REVENUE_QUALITY_BANDS.average;
  if (s >= REVENUE_QUALITY_BANDS.developing.min) return REVENUE_QUALITY_BANDS.developing;
  return REVENUE_QUALITY_BANDS.weak;
}

export const SCATTER_QUADRANTS = {
  premium_balanced: {
    id: "premium_balanced",
    label: "Premium balanced",
    hint: "High gross sales with strong revenue quality",
  },
  hidden_opportunity: {
    id: "hidden_opportunity",
    label: "Hidden upside",
    hint: "Volume present — premium conversion opportunity",
  },
  volume_risk: {
    id: "volume_risk",
    label: "Volume without margin",
    hint: "Highest volume, weakest monetization quality",
  },
  quality_specialist: {
    id: "quality_specialist",
    label: "Quality specialist",
    hint: "Lower volume, high margin behavior",
  },
};

export const ARCHETYPES = {
  premium_seller: { label: "Premium seller", tone: "teal" },
  volume_heavy: { label: "Volume-heavy", tone: "amber" },
  hidden_upside: { label: "Hidden upside", tone: "amber" },
  balanced_operator: { label: "Balanced operator", tone: "teal" },
  breakfast_specialist: { label: "Breakfast specialist", tone: "gold" },
  dinner_specialist: { label: "Dinner specialist", tone: "teal" },
  margin_risk: { label: "Margin risk", tone: "critical" },
};

export const EXECUTIVE_LABELS = {
  modifierAttach: "Modifier attach",
  premiumBeverageMix: "Premium beverage mix",
  revenueQuality: "Revenue quality",
  operationalScore: "Operational score",
  dinnerShift: "Dinner shift",
  morningShift: "Morning shift",
  grossSales: "Gross sales",
  avgTicket: "Average ticket",
  avgItemValue: "Avg item value",
  recoverableOpportunity: "Recoverable operational opportunity",
  attachmentLeakage: "Modifier monetization leakage",
  beverageOpportunity: "Premium beverage conversion potential",
  revenueAtRisk: "Revenue at risk",
  strategicSignals: "Strategic operational signals",
  managementPriorities: "Management priorities",
  commercialIntelligence: "Commercial intelligence",
};

export const MENU_QUADRANT_COPY = {
  Star: {
    title: "Stars — protect and promote",
    body: "High popularity and strong margin contribution. These items anchor the menu and should remain visible, well-staffed, and consistently executed.",
  },
  Puzzle: {
    title: "Puzzles — visibility or pricing fix",
    body: "Strong margin but under-ordered. Improve placement, photography, staff recommendation, or consider repositioning price to unlock demand.",
  },
  Workhorse: {
    title: "Workhorses — margin protection",
    body: "High traffic, thinner margin. Pair with premium modifiers, beverages, and sides. Avoid over-discounting.",
  },
  Dog: {
    title: "Dogs — simplify or reinvent",
    body: "Low engagement and weak economics. Candidates for removal, bundle into combos, or complete recipe repositioning.",
  },
};
