/**
 * Orchestrates predictive operational intelligence from real metrics only.
 */

import { GOOGLE_PLACE_BRANCHES } from "../config/googleBranchPlaces";
import { computeNetworkBranchScores } from "./operationalScoreEngine";
import { computeReviewMomentum } from "./reviewMomentumEngine";
import {
  buildNetworkStaffCoachingInsights,
} from "./staffCoachingIntelligenceEngine";
import { buildExecutiveOperationalInsights } from "./executiveOperationalInsightEngine";
import {
  buildAllBranchGoogleMovement,
} from "../utils/googleReviewSnapshotHistory";
function rangeDaysFromId(rangeId) {
  if (rangeId === "today") return 1;
  if (rangeId === "7d") return 7;
  if (rangeId === "month") return 30;
  return 14;
}

/**
 * @param {object} input
 * @param {object} input.kpis
 * @param {Array} input.branchComparison
 * @param {Object<string,Array>} input.staffByBranch
 * @param {Array} input.snapshots
 * @param {string} input.selectedRange
 * @param {Array} input.dailyTrend
 * @param {object} [input.previousKpis]
 * @param {object} [input.googleMovementByBranch]
 */
export function buildPredictiveIntelligencePackage(input = {}) {
  const branchComparison = input.branchComparison?.length > 0 ? input.branchComparison : [];

  const snapshots = input.snapshots || [];
  const googleMovementByBranch =
    input.googleMovementByBranch ||
    Object.fromEntries(
      buildAllBranchGoogleMovement(snapshots, {
        periodRange: input.selectedRange || "month",
      }).map((g) => [g.branch_id, g]),
    );

  const staffByBranch = input.staffByBranch || {};
  GOOGLE_PLACE_BRANCHES.forEach((id) => {
    if (!staffByBranch[id]) staffByBranch[id] = [];
  });

  const branchScores = computeNetworkBranchScores({
    branchComparison,
    staffByBranch,
    googleMovementByBranch,
  });

  const activeBranch = (input.activeBranch || "").toLowerCase();
  const branchMovement = activeBranch ? googleMovementByBranch[activeBranch] : null;

  const momentum = computeReviewMomentum({
    kpis: input.kpis,
    dailyTrend: input.dailyTrend || [],
    googleMovement: branchMovement,
    previousKpis: input.previousKpis,
    selectedRange: input.selectedRange,
    rangeDays: rangeDaysFromId(input.selectedRange),
  });

  const staffInsights = buildNetworkStaffCoachingInsights(staffByBranch);
  const executiveInsights = buildExecutiveOperationalInsights({
    branchScores,
    branchComparison,
    staffInsights,
    momentum,
  });

  const scoreByBranch = Object.fromEntries(branchScores.map((s) => [s.branch_id, s]));

  const scored = branchScores.filter((s) => s.score != null);
  const networkScore =
    scored.length > 0
      ? Math.round(scored.reduce((sum, s) => sum + (s.score || 0), 0) / scored.length)
      : null;
  const networkScoreProvisional = scored.some((s) => s.provisional);
  const networkScoreBuilding = scored.length > 0 && scored.every((s) => s.provisional);

  return {
    branchScores,
    scoreByBranch,
    networkScore,
    networkScoreProvisional,
    networkScoreBuilding,
    momentum,
    staffInsights,
    executiveInsights,
    googleMovementByBranch,
    generated_at: new Date().toISOString(),
  };
}

/** Format lines for PDF export blocks */
export function formatPredictiveExportLines(pkg, branchId = null) {
  if (!pkg) return [];
  const lines = [];
  const id = branchId ? (branchId || "").toLowerCase() : null;
  const score = id ? pkg.scoreByBranch?.[id] : null;
  const mom = pkg.momentum;

  if (score?.score != null) {
    lines.push(`Operational score: ${score.score} (${score.tier_label})`);
    if (score.strengths?.[0]) lines.push(`Strength: ${score.strengths[0]}`);
    if (score.weaknesses?.[0]) lines.push(`Risk: ${score.weaknesses[0]}`);
  } else if (score?.message) {
    lines.push(score.message);
  }

  if (mom && !mom.insufficient_data) {
    if (mom.tonight_redirects) {
      lines.push(`Expected redirects tonight: ${mom.tonight_redirects.low}-${mom.tonight_redirects.high}`);
    }
    if (mom.monthly_review_gain != null) {
      const sign = mom.monthly_review_gain >= 0 ? "+" : "";
      lines.push(`Estimated monthly review gain: ${sign}${mom.monthly_review_gain}`);
    }
    if (mom.redirect_pace_vs_last_week != null) {
      const sign = mom.redirect_pace_vs_last_week >= 0 ? "+" : "";
      lines.push(`Redirect pace vs prior period: ${sign}${mom.redirect_pace_vs_last_week}%`);
    }
    lines.push(`Momentum: ${mom.momentum}`);
  } else if (mom?.message) {
    lines.push(mom.message);
  }

  pkg.executiveInsights?.slice(0, 2).forEach((ins) => {
    lines.push(ins.text);
  });

  return lines.slice(0, 8);
}
