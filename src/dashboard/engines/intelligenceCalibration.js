/**
 * Phase 10 — Operational calibration & trust layer.
 * Prevents technically-correct but operationally fake insights.
 */

import { STAFF_SHIFT_HINTS } from "../config/menuOperationalTaxonomy";

export const CONFIDENCE = {
  HIGH: "high",
  MODERATE: "moderate",
  LOW: "low_sample",
};

export const CONFIDENCE_LABEL = {
  high: "HIGH confidence",
  moderate: "MODERATE confidence",
  low_sample: "LOW sample size",
};

const MIN_QTY_FOR_COACHING = 120;
const MIN_BEV_GROSS_FOR_MIX = 800;
const MIN_MOCKTAIL_GROSS = 400;
const MIN_PARENT_FOR_ATTACH = 80;

function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

/** Per-waiter signal confidence — gates strong claims */
export function buildSignalConfidence(w, team = {}) {
  const qty = w.quantity || 0;
  const bevGross = w.ops?.bevGross || 0;
  const mocktailGross = w.ops?.mocktailGross || 0;
  const parentQty = w.parent_qty || 0;
  const shiftHint = STAFF_SHIFT_HINTS[w.waiter];
  const shiftLean = w.ops?.shiftLean || "balanced";

  const shiftConfidence =
    shiftHint && shiftLean === shiftHint
      ? CONFIDENCE.HIGH
      : qty >= 300
        ? shiftLean === "breakfast" || shiftLean === "pm"
          ? CONFIDENCE.MODERATE
          : CONFIDENCE.MODERATE
        : CONFIDENCE.LOW;

  const beverageMixConfidence =
    bevGross >= MIN_BEV_GROSS_FOR_MIX
      ? mocktailGross >= MIN_MOCKTAIL_GROSS
        ? CONFIDENCE.HIGH
        : CONFIDENCE.MODERATE
      : bevGross > 0
        ? CONFIDENCE.LOW
        : CONFIDENCE.LOW;

  const modifierConfidence =
    parentQty >= MIN_PARENT_FOR_ATTACH
      ? CONFIDENCE.HIGH
      : parentQty >= 40
        ? CONFIDENCE.MODERATE
        : CONFIDENCE.LOW;

  const volumeConfidence =
    qty >= 400 ? CONFIDENCE.HIGH : qty >= MIN_QTY_FOR_COACHING ? CONFIDENCE.MODERATE : CONFIDENCE.LOW;

  return {
    shift: shiftConfidence,
    beverageMix: beverageMixConfidence,
    modifier: modifierConfidence,
    volume: volumeConfidence,
    overall: minConfidence([shiftConfidence, beverageMixConfidence, modifierConfidence, volumeConfidence]),
  };
}

function minConfidence(levels) {
  if (levels.includes(CONFIDENCE.LOW)) return CONFIDENCE.LOW;
  if (levels.includes(CONFIDENCE.MODERATE)) return CONFIDENCE.MODERATE;
  return CONFIDENCE.HIGH;
}

/** Internal raw score before percentile calibration */
export function computeRawRevenueQualityScore(w) {
  const gross = w.gross_sales || w.primarySales || 0;
  if (gross <= 0) return 0;

  const premiumShare = pct(
    (w.ops?.premiumBevGross || 0) + (w.ops?.premiumFoodGross || 0) + (w.ops?.dessertGross || 0) * 0.5,
    gross,
  );
  const lowValuePenalty = Math.min(25, (w.ops?.lowValueBevPct || 0) * 0.35);
  const modBonus = Math.min(20, (w.modifierAttachPct || 0) * 1.1);
  const avgCheckBonus = Math.min(20, ((w.avgCheck || 0) / 50) * 20);
  const premBevBonus = Math.min(25, (w.ops?.premiumBevPct || 0) * 1.0);
  const qtyInflationPenalty =
    (w.quantity || 0) >= 500 && (w.avgCheck || 0) < 38 ? 12 : (w.avgCheck || 0) < 30 && (w.quantity || 0) >= 350 ? 8 : 0;

  const raw = premiumShare + modBonus + avgCheckBonus + premBevBonus - lowValuePenalty - qtyInflationPenalty;
  return Math.max(0, raw);
}

function percentileRank(value, sortedAsc) {
  if (!sortedAsc.length) return 50;
  if (sortedAsc.length === 1) return 55;
  const below = sortedAsc.filter((v) => v < value).length;
  return (below / (sortedAsc.length - 1)) * 100;
}

/** Map team percentile → executive-friendly 35–92 scale */
export function percentileToDisplayRevenueQuality(percentile) {
  const p = Math.max(0, Math.min(100, percentile));
  if (p >= 92) return Math.round(88 + (p - 92) * 0.5);
  if (p >= 75) return Math.round(72 + (p - 75) * 0.94);
  if (p >= 50) return Math.round(55 + (p - 50) * 0.68);
  if (p >= 25) return Math.round(42 + (p - 25) * 0.52);
  return Math.round(35 + p * 0.28);
}

/**
 * Revenue quality /100 — percentile-calibrated so teams see achievable bands, not brutal zeros.
 */
export function computeRevenueQualityScore(w, teamWaiters = []) {
  const list = teamWaiters?.length ? teamWaiters : [w];
  const rawValues = list.map((x) => computeRawRevenueQualityScore(x)).sort((a, b) => a - b);
  const raw = computeRawRevenueQualityScore(w);
  const pct = percentileRank(raw, rawValues);
  return percentileToDisplayRevenueQuality(pct);
}

export function isBreakfastHeavy(w) {
  return w.ops?.shiftLean === "breakfast" || (w.ops?.breakfastPct || 0) >= 32;
}

export function isPmHeavy(w) {
  return w.ops?.shiftLean === "pm" || ((w.ops?.dessertPct || 0) >= 12 && (w.ops?.breakfastPct || 0) < 22);
}

export function isLowValueBeverageDominant(w) {
  return (w.ops?.bevGross || 0) > 400 && (w.ops?.lowValueBevPct || 0) >= 52;
}

export function isPremiumBeverageMeaningful(w) {
  return (w.ops?.premiumBevGross || 0) >= MIN_MOCKTAIL_GROSS || (w.ops?.premiumBevPct || 0) >= 18;
}

export function isVolumeWithoutMargin(w) {
  return (w.quantity || 0) >= 450 && (w.avgCheck || 0) < 36 && (w.modifierAttachPct || 0) < 10;
}

/** Attach calibration + revenue quality to each waiter */
export function calibrateWaiterProfiles(waiters = [], team = {}) {
  const list = waiters.filter((w) => w.role === "waiter" || !w.role);
  const pool = list.length ? list : waiters;

  return waiters.map((w) => {
    const confidence = buildSignalConfidence(w, team);
    const revenueQualityRaw = computeRawRevenueQualityScore(w);
    const revenueQualityScore = computeRevenueQualityScore(w, pool);
    return {
      ...w,
      confidence,
      confidenceLabel: CONFIDENCE_LABEL[confidence.overall],
      revenueQualityScore,
      revenueQualityRaw: Math.round(revenueQualityRaw),
      calibration: {
        breakfastExpected: isBreakfastHeavy(w),
        pmExpected: isPmHeavy(w),
        lowValueBevDominant: isLowValueBeverageDominant(w),
        premiumBevMeaningful: isPremiumBeverageMeaningful(w),
        volumeWithoutMargin: isVolumeWithoutMargin(w),
        shouldNotCelebrateBreakfast: isBreakfastHeavy(w),
        shouldNotCelebrateRawBeverage: isLowValueBeverageDominant(w),
      },
    };
  });
}

export function calibrateTeamContext(team = {}, waiters = []) {
  const waiterList = waiters.filter((w) => w.role === "waiter" || !w.role);
  return {
    ...team,
    avgPremiumBevPct:
      waiterList.length > 0
        ? Math.round(waiterList.reduce((s, w) => s + (w.ops?.premiumBevPct || 0), 0) / waiterList.length)
        : 0,
    avgRevenueQuality:
      waiterList.length > 0
        ? Math.round(waiterList.reduce((s, w) => s + (w.revenueQualityScore || 0), 0) / waiterList.length)
        : 0,
    hasReliableBevData: (team.bevGross || 0) >= 3000,
    hasReliableShiftData: waiterList.some((w) => (w.quantity || 0) >= 300),
  };
}

/** Gate team-level insights — returns null if should not publish */
export function gateTeamInsight({ confidence = CONFIDENCE.MODERATE, minConfidence = CONFIDENCE.MODERATE, title, body, impact, severity }) {
  const order = [CONFIDENCE.LOW, CONFIDENCE.MODERATE, CONFIDENCE.HIGH];
  if (order.indexOf(confidence) < order.indexOf(minConfidence)) {
    return null;
  }
  const prefix =
    confidence === CONFIDENCE.LOW
      ? "[Limited data] "
      : confidence === CONFIDENCE.MODERATE
        ? ""
        : "";
  return {
    title: prefix + title,
    body,
    impact,
    severity,
    confidence,
    confidenceLabel: CONFIDENCE_LABEL[confidence],
  };
}

export function downgradeEstimatedImpact(text, confidence) {
  if (confidence === CONFIDENCE.HIGH) return text;
  if (confidence === CONFIDENCE.MODERATE) return text?.replace(/could add \d+–\d+%/, "may improve margin mix") || text;
  return "Insufficient sample to estimate revenue impact — monitor next period.";
}

/**
 * Apply calibration pass across export payload intelligence.
 */
export function applyIntelligenceCalibration({ waiters = [], team = {}, coaching = [], insights = [], awards = {} }) {
  const calibratedWaiters = calibrateWaiterProfiles(waiters, team);
  const calibratedTeam = calibrateTeamContext(team, calibratedWaiters);

  return {
    waiters: calibratedWaiters,
    team: calibratedTeam,
    coaching,
    insights,
    awards,
  };
}
