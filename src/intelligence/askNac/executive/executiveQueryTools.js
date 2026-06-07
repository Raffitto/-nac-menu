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
