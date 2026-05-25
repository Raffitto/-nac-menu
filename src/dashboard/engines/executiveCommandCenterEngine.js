/**
 * Executive Command Center — orchestrates network status, alerts, brief, timeline, heatmap.
 */

import { buildPredictiveIntelligencePackage } from "./predictiveIntelligenceEngine";
import { buildNetworkBranchStatus, rankBranchesByScore } from "./executiveNetworkStatusEngine";
import { buildExecutiveAlerts } from "./executiveAlertEngine";
import { buildDailyExecutiveBrief } from "./dailyExecutiveBriefEngine";
import { buildExecutiveTimeline } from "./executiveTimelineEngine";
import { buildExecutiveHeatmap } from "./executiveHeatmapEngine";

/**
 * @param {object} input — review + staff + snapshots (same as predictive package)
 */
export function buildExecutiveCommandCenterPackage(input = {}) {
  const predictive = buildPredictiveIntelligencePackage(input);

  const branchStatus = buildNetworkBranchStatus({
    branchComparison: input.branchComparison,
    scoreByBranch: predictive.scoreByBranch,
    staffByBranch: input.staffByBranch,
    googleMovementByBranch: predictive.googleMovementByBranch,
    selectedRange: input.selectedRange,
  });

  const rankings = rankBranchesByScore(branchStatus);

  const alerts = buildExecutiveAlerts({
    branchScores: predictive.branchScores,
    branchComparison: input.branchComparison,
    staffInsights: predictive.staffInsights,
    momentum: predictive.momentum,
    branchStatus,
    previousComparison: input.previousComparison,
    networkWide: input.networkWide !== false,
    allowedBranchIds: input.allowedBranchIds,
  });

  const dailyBrief = buildDailyExecutiveBrief({
    branchStatus,
    momentum: predictive.momentum,
    staffInsights: predictive.staffInsights,
    networkScore: predictive.networkScore,
    branchComparison: input.branchComparison,
    staffByBranch: input.staffByBranch,
  });

  const timeline = buildExecutiveTimeline({
    branchStatus,
    momentum: predictive.momentum,
    branchComparison: input.branchComparison,
    alerts,
    networkWide: input.networkWide !== false,
    allowedBranchIds: input.allowedBranchIds,
  });

  const heatmap = buildExecutiveHeatmap({
    branchStatus,
    scoreByBranch: predictive.scoreByBranch,
  });

  const kpis = input.kpis || {};
  const totalRedirectsToday = Number(kpis.google_redirects) || 0;
  const networkPace =
    predictive.momentum?.redirect_pace_vs_last_week != null
      ? predictive.momentum.redirect_pace_vs_last_week
      : null;

  const activeStaffCount = Object.values(input.staffByBranch || {}).reduce(
    (sum, staff) => sum + staff.filter((s) => (s.scans || 0) >= 2).length,
    0,
  );

  const strongest = rankings[0] || null;
  const weakest = rankings[rankings.length - 1] || null;
  const hasScoredBranch = branchStatus.some((b) => b.operational_score != null);
  const buildingBaseline = predictive.networkScoreBuilding;

  return {
    ...predictive,
    branchStatus,
    rankings,
    alerts,
    dailyBrief,
    timeline,
    heatmap,
    pulse: {
      total_redirects: totalRedirectsToday,
      redirect_pace_pct: networkPace,
      active_staff_count: activeStaffCount,
      momentum: predictive.momentum?.momentum || "Stable",
      live_label:
        totalRedirectsToday > 0
          ? `${totalRedirectsToday} Google redirects in period`
          : activeStaffCount > 0
            ? `${activeStaffCount} staff with live scan activity — review completion tracking needs more redirect history`
            : hasScoredBranch
              ? "Calibrating live pulse — redirect participation will sharpen as card handoffs accumulate"
              : "Insufficient redirect history for live operational pulse",
      building_baseline: buildingBaseline,
      has_scored_branch: hasScoredBranch,
    },
    strongest_branch: strongest,
    weakest_branch: weakest,
    generated_at: new Date().toISOString(),
  };
}

/** PDF export lines */
export function formatExecutiveCommandExportLines(pkg) {
  if (!pkg) return [];
  const lines = [];
  const brief = pkg.dailyBrief;

  if (pkg.networkScore != null) {
    lines.push(`Network operational score: ${pkg.networkScore}`);
  }
  if (brief?.strongest_branch) lines.push(`Strongest branch: ${brief.strongest_branch}`);
  if (brief?.weakest_branch) lines.push(`Weakest branch: ${brief.weakest_branch}`);
  if (brief?.momentum_summary) lines.push(brief.momentum_summary);
  if (brief?.recommended_focus) lines.push(`Focus: ${brief.recommended_focus}`);

  (pkg.alerts || []).slice(0, 5).forEach((a) => {
    lines.push(`[${a.severity.toUpperCase()}] ${a.text}`);
  });

  (pkg.rankings || []).slice(0, 3).forEach((r, i) => {
    if (r.operational_score != null) {
      lines.push(`#${i + 1} ${r.branch_name}: ${r.operational_score} (${r.tier_label || r.health?.label})`);
    }
  });

  return lines.slice(0, 14);
}
