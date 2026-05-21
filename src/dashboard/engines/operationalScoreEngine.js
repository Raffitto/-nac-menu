/**
 * Weighted branch operational score (0–100) — deterministic, tunable.
 */

import { branchDisplayName } from "../utils/rangeState";
import {
  OPERATIONAL_SCORE_WEIGHTS,
  OPERATIONAL_SCORE_TIERS,
  SCORE_MIN_CARD_TAPS,
  SCORE_MIN_STAFF_ACTIVE,
} from "../config/operationalScoreWeights";
import { clampDisplayPct, tapToGooglePct } from "../utils/reviewFunnelMetrics";

const W = OPERATIONAL_SCORE_WEIGHTS;

function clamp01(n) {
  return Math.min(100, Math.max(0, Number(n) || 0));
}

function tierForScore(score) {
  const s = Math.round(score);
  return (
    OPERATIONAL_SCORE_TIERS.find((t) => s >= t.min && s <= t.max) ||
    OPERATIONAL_SCORE_TIERS[OPERATIONAL_SCORE_TIERS.length - 1]
  );
}

/** Lower concentration of redirects on one person = higher score */
function staffConsistencyScore(staff = []) {
  const active = staff.filter((s) => (s.scans || 0) >= 2);
  if (active.length < 2) return 35;
  const totalGoogle = active.reduce((sum, s) => sum + (s.google || 0), 0);
  if (totalGoogle <= 0) return 45;
  const topShare = Math.max(...active.map((s) => s.google || 0)) / totalGoogle;
  return clamp01((1 - topShare) * 85 + 15);
}

function staffParticipationScore(staff = []) {
  if (!staff.length) return 0;
  const active = staff.filter((s) => (s.scans || 0) >= 3).length;
  return clamp01((active / staff.length) * 100);
}

function redirectEfficiencyScore(branchRow) {
  const scans = branchRow?.qr_scans || 0;
  const google = branchRow?.google_redirects || 0;
  const interactions = branchRow?.reviews_generated || 0;
  if (scans < 5) return 0;
  const tapToGoogle = tapToGooglePct(google, scans);
  const interactionToGoogle =
    interactions > 0 ? clampDisplayPct((google / interactions) * 100) : tapToGoogle;
  return clamp01(tapToGoogle * 0.65 + interactionToGoogle * 0.35);
}

function reviewMomentumScore(googleMovement) {
  if (!googleMovement?.tracking_start_date) return 40;
  const delta =
    googleMovement?.period_delta ??
    googleMovement?.week_delta ??
    googleMovement?.month_delta ??
    null;
  if (delta == null || !Number.isFinite(delta)) return 45;
  if (delta >= 8) return 95;
  if (delta >= 3) return 82;
  if (delta >= 1) return 70;
  if (delta === 0) return 55;
  if (delta < 0) return 35;
  return 50;
}

function reviewGrowthScore(googleMovement) {
  const month = googleMovement?.month_delta;
  if (month == null || !Number.isFinite(month)) return 50;
  if (month >= 20) return 100;
  if (month >= 10) return 85;
  if (month >= 3) return 72;
  if (month >= 0) return 58;
  return 32;
}

function activityVolumeScore(qrScans, networkMax) {
  const max = Math.max(networkMax, 1);
  return clamp01((qrScans / max) * 100);
}

/**
 * @param {object} input
 * @param {string} input.branchId
 * @param {object} input.branchRow — comparison row (qr_scans, conversion_pct, …)
 * @param {Array} input.staff
 * @param {object} [input.googleMovement]
 * @param {number} [input.networkMaxScans]
 */
export function computeBranchOperationalScore(input = {}) {
  const branchId = (input.branchId || "").toLowerCase();
  const row = input.branchRow || {};
  const staff = input.staff || [];
  const googleMovement = input.googleMovement || null;
  const scans = Number(row.qr_scans) || 0;
  const activeStaff = staff.filter((s) => (s.scans || 0) >= 2).length;

  const insufficient =
    scans < SCORE_MIN_CARD_TAPS ||
    (staff.length > 0 && activeStaff < SCORE_MIN_STAFF_ACTIVE && scans < SCORE_MIN_CARD_TAPS * 2);

  if (insufficient) {
    return {
      branch_id: branchId,
      branch_name: branchDisplayName(branchId),
      score: null,
      tier: null,
      tier_label: null,
      insufficient_data: true,
      message: "Insufficient historical data",
      strengths: [],
      weaknesses: [],
      factors: {},
    };
  }

  const factors = {
    tapToGoogleConversion: clamp01(row.conversion_pct || tapToGooglePct(row.google_redirects, scans)),
    staffParticipation: staffParticipationScore(staff),
    staffConsistency: staffConsistencyScore(staff),
    reviewMomentum: reviewMomentumScore(googleMovement),
    redirectEfficiency: redirectEfficiencyScore(row),
    activityVolume: activityVolumeScore(scans, input.networkMaxScans || scans),
    reviewGrowthTrend: reviewGrowthScore(googleMovement),
  };

  const score = Math.round(
    factors.tapToGoogleConversion * W.tapToGoogleConversion +
      factors.staffParticipation * W.staffParticipation +
      factors.staffConsistency * W.staffConsistency +
      factors.reviewMomentum * W.reviewMomentum +
      factors.redirectEfficiency * W.redirectEfficiency +
      factors.activityVolume * W.activityVolume +
      factors.reviewGrowthTrend * W.reviewGrowthTrend,
  );

  const tier = tierForScore(score);
  const strengths = [];
  const weaknesses = [];

  if (factors.tapToGoogleConversion >= 70) strengths.push("Strong tap-to-Google conversion");
  else if (factors.tapToGoogleConversion < 45) weaknesses.push("Weak tap-to-Google follow-through");

  if (factors.staffParticipation >= 65) strengths.push("Healthy staff participation breadth");
  else weaknesses.push("Low staff participation breadth");

  if (factors.staffConsistency >= 60) strengths.push("Balanced redirect contribution across staff");
  else weaknesses.push("Redirect concentration on few staff");

  if (factors.reviewMomentum >= 70) strengths.push("Positive review momentum");
  else if (factors.reviewMomentum < 45) weaknesses.push("Flat or declining review momentum");

  if (factors.activityVolume >= 65) strengths.push("Solid card-handoff volume");
  else if (factors.activityVolume < 40) weaknesses.push("Low card-handoff volume");

  return {
    branch_id: branchId,
    branch_name: branchDisplayName(branchId),
    score,
    tier: tier.id,
    tier_label: tier.label,
    insufficient_data: false,
    message: null,
    strengths: strengths.slice(0, 3),
    weaknesses: weaknesses.slice(0, 3),
    factors,
  };
}

export function computeNetworkBranchScores({
  branchComparison = [],
  staffByBranch = {},
  googleMovementByBranch = {},
} = {}) {
  const rows = branchComparison || [];
  const networkMaxScans = Math.max(...rows.map((r) => r.qr_scans || 0), 1);

  return rows.map((row) => {
    const id = (row.branch_id || "").toLowerCase();
    return computeBranchOperationalScore({
      branchId: id,
      branchRow: row,
      staff: staffByBranch[id] || [],
      googleMovement: googleMovementByBranch[id] || null,
      networkMaxScans,
    });
  });
}
