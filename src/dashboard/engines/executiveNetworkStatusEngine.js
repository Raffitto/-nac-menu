/**
 * Per-branch executive health cards — deterministic from scores + factors.
 */

import { branchDisplayName } from "../utils/rangeState";
import { computeReviewMomentum } from "./reviewMomentumEngine";

const HEALTH = {
  healthy: { id: "healthy", label: "Healthy" },
  watch: { id: "watch", label: "Watch" },
  risk: { id: "risk", label: "Risk" },
  critical: { id: "critical", label: "Critical" },
};

function healthFromScore(scoreRow) {
  if (scoreRow?.insufficient_data) return HEALTH.watch;
  const score = scoreRow?.score;
  if (score == null) return HEALTH.watch;
  if (score >= 75) return HEALTH.healthy;
  if (score >= 60) return HEALTH.watch;
  if (score >= 45) return HEALTH.risk;
  return HEALTH.critical;
}

function engagementLevel(participation, consistency) {
  const p = Number(participation) || 0;
  const c = Number(consistency) || 0;
  const avg = (p + c) / 2;
  if (avg >= 70) return "High";
  if (avg >= 45) return "Moderate";
  if (avg >= 25) return "Low";
  return "Minimal";
}

/**
 * @param {object} input
 */
export function buildNetworkBranchStatus(input = {}) {
  const comparison = input.branchComparison || [];
  const scoreByBranch = input.scoreByBranch || {};
  const staffByBranch = input.staffByBranch || {};
  const googleMovementByBranch = input.googleMovementByBranch || {};
  const selectedRange = input.selectedRange || "today";

  return comparison.map((row) => {
    const id = (row.branch_id || "").toLowerCase();
    const scoreRow = scoreByBranch[id] || {};
    const staff = staffByBranch[id] || [];
    const movement = googleMovementByBranch[id] || null;
    const momentum = computeReviewMomentum({
      kpis: {
        qr_scans: row.qr_scans,
        google_redirects: row.google_redirects,
        conversion_pct: row.conversion_pct,
      },
      googleMovement: movement,
      selectedRange,
      rangeDays: 7,
    });

    const activeStaff = staff.filter((s) => (s.scans || 0) >= 2).length;
    const participation = scoreRow.factors?.staffParticipation ?? 0;

    return {
      branch_id: id,
      branch_name: branchDisplayName(id),
      operational_score: scoreRow.score,
      tier: scoreRow.tier,
      tier_label: scoreRow.tier_label,
      insufficient_data: scoreRow.insufficient_data,
      momentum: momentum.insufficient_data ? "Stable" : momentum.momentum,
      redirect_pace_pct: momentum.redirect_pace_vs_last_week,
      participation_breadth: Math.round(participation),
      staff_engagement: engagementLevel(
        scoreRow.factors?.staffParticipation,
        scoreRow.factors?.staffConsistency,
      ),
      review_growth: movement?.month_delta ?? movement?.period_delta ?? null,
      google_redirects: row.google_redirects || 0,
      conversion_pct: row.conversion_pct || 0,
      qr_scans: row.qr_scans || 0,
      active_staff_count: activeStaff,
      health: healthFromScore(scoreRow),
      pulse: scoreRow.score != null && scoreRow.score >= 75 ? "strong" : scoreRow.score >= 60 ? "steady" : "weak",
    };
  });
}

export function rankBranchesByScore(statusRows = []) {
  return [...statusRows].sort((a, b) => (b.operational_score ?? -1) - (a.operational_score ?? -1));
}
