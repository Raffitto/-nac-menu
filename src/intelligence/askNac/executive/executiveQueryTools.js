/**
 * Ask NAC executive analysis query tool — multi-metric deterministic conclusions.
 */

import { fetchUnifiedReviewTruth } from "../../../lib/unifiedReviewTruth";
import { fetchGoogleReviewSnapshots } from "../../../dashboard/utils/googleReviewSnapshotHistory";
import { buildExecutiveCommandCenterPackage } from "../../../dashboard/engines/executiveCommandCenterEngine";
import { periodLabelFromHours } from "../../../dashboard/utils/businessDay";
import { MONTH_HOURS } from "../../../dashboard/utils/rangeState";
import {
  buildExecutiveBranchScores,
  buildExecutiveSummary,
  buildGoogleMovementMap,
  calculateReviewGrowthRows,
} from "./executiveMetrics";
import {
  assessNetworkDataConfidence,
  evaluateExecutiveRankingEligibility,
  requiresExecutiveRankingSafeguard,
  DATA_SOURCE_KEYS,
} from "../confidence/dataConfidenceLayer";

function defaultExecutiveHours(context = {}) {
  const hours = Number(context.hours) || 0;
  if (hours >= 168) return hours;
  const filterHours = Number(context.filters?.timeRangeHours) || 0;
  if (filterHours >= 168) return filterHours;
  return MONTH_HOURS;
}

export async function queryExecutiveAnalysis(supabase, context = {}) {
  const hours = defaultExecutiveHours(context);
  const selectedRange = context.filters?.selectedRange || context.period?.rangeId || "month";

  const truth = await fetchUnifiedReviewTruth(supabase, {
    hours,
    profile: context.profile,
    branch: null,
  });

  const { data: snapshots = [], error: snapshotError } = await fetchGoogleReviewSnapshots();
  const googleMovementByBranch = buildGoogleMovementMap(snapshots, selectedRange);
  const branchComparison = truth.branchComparison || [];
  const staffByBranch = truth.staffByBranch || {};

  const commandCenter = buildExecutiveCommandCenterPackage({
    kpis: truth.kpis,
    branchComparison,
    staffByBranch,
    snapshots,
    selectedRange,
    dailyTrend: truth.dailyTrend,
    networkWide: truth.scope?.networkWide !== false,
  });

  const branchScores = buildExecutiveBranchScores({
    branchComparison,
    staffByBranch,
    googleMovementByBranch,
    snapshots,
  });

  const reviewGrowthRows = calculateReviewGrowthRows(googleMovementByBranch);
  const analysisKind = context.executiveKind || "general";
  const coverageAssessment = await assessNetworkDataConfidence(supabase, {
    hours,
    profile: context.profile,
  });
  const rankingEligibility = evaluateExecutiveRankingEligibility(coverageAssessment, analysisKind);

  if (!rankingEligibility.allowed && requiresExecutiveRankingSafeguard(analysisKind)) {
    return {
      hours,
      periodLabel: periodLabelFromHours(hours),
      analysisKind,
      coverageBlocked: true,
      coverageAssessment,
      rankingEligibility,
      summary: {
        headline: rankingEligibility.reason || "Insufficient data for a valid network-wide comparison.",
        winner: null,
        reason: null,
        rankingTable: [],
        keyFindings: coverageAssessment.branchCoverage.map(
          (row) =>
            `${row.branch_name}: ${row.availableSourceCount}/${DATA_SOURCE_KEYS?.length || 8} sources available`,
        ),
        recommendedActions: [coverageAssessment.recommendation],
      },
      branchScores: [],
      reviewGrowthRows: [],
      rankings: [],
      warnings: coverageAssessment.missingSources.map((source) => `Missing: ${source}`),
      sources: [{ name: "dataConfidenceLayer", detail: "network coverage assessment" }],
    };
  }

  const summary = buildExecutiveSummary({
    analysisKind,
    branchScores,
    rankings: commandCenter.rankings || [],
    reviewGrowthRows,
    commandCenter,
  });

  return {
    hours,
    periodLabel: periodLabelFromHours(hours),
    analysisKind,
    coverageAssessment,
    summary,
    branchScores,
    reviewGrowthRows,
    rankings: commandCenter.rankings || [],
    networkScore: commandCenter.networkScore,
    dailyBrief: commandCenter.dailyBrief,
    partial: Boolean(truth.partial),
    note: truth.note,
    warnings: [
      ...(truth.integrity?.warnings || []),
      snapshotError ? "Google review snapshots unavailable — growth metrics may be partial." : null,
      branchScores.every((row) => row.insufficient_data)
        ? "Branch executive scores are provisional — more card-handoff history is needed."
        : null,
    ].filter(Boolean),
    sources: [
      { name: "fetchUnifiedReviewTruth", detail: "review_events + staff attribution" },
      { name: "google_review_snapshots", detail: "rating and review growth baselines" },
      { name: "operationalScoreEngine", detail: "deterministic executive branch scoring" },
    ],
  };
}
