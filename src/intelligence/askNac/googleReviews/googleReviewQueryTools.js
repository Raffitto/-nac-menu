/**
 * Google review count queries from daily snapshot history.
 */

import {
  fetchGoogleReviewSnapshots,
  computeBranchGoogleMovement,
  buildAllBranchGoogleMovement,
} from "../../../dashboard/utils/googleReviewSnapshotHistory";
import { branchDisplayName } from "../../../dashboard/utils/rangeState";
import { parseFoodicsPeriodFromQuestion } from "../foodics/foodicsPeriodParser";
import { GOOGLE_PLACE_BRANCHES } from "../../../dashboard/config/googleBranchPlaces";

function resolveSnapshotPeriod(question = "", period = {}) {
  const q = String(question || "").toLowerCase();
  if (/\blast month\b/.test(q) || period.rangeId === "last_month") {
    const bounds = parseFoodicsPeriodFromQuestion("last month");
    return {
      periodStartDate: bounds.startDate,
      periodEndDate: bounds.endDate,
      periodLabel: bounds.label,
      periodRange: "custom",
    };
  }
  if (/\bthis month\b|\bmtd\b|\bmonth to date\b/.test(q) || period.rangeId === "month") {
    const bounds = parseFoodicsPeriodFromQuestion("this month");
    return {
      periodStartDate: bounds.startDate,
      periodEndDate: bounds.endDate,
      periodLabel: bounds.label,
      periodRange: "custom",
    };
  }
  const named = parseFoodicsPeriodFromQuestion(question);
  if (named?.startDate) {
    return {
      periodStartDate: named.startDate,
      periodEndDate: named.endDate,
      periodLabel: named.label,
      periodRange: "custom",
    };
  }
  return { periodRange: period.rangeId === "7d" ? "7d" : "month" };
}

function reviewDeltaFromReport(report) {
  if (report?.period_delta != null) return report.period_delta;
  if (report?.month_delta != null) return report.month_delta;
  if (report?.week_delta != null) return report.week_delta;
  if (report?.today_delta != null) return report.today_delta;
  return null;
}

export async function queryGoogleReviewCount(supabase, context = {}) {
  const branch = context.branchMention || context.filters?.branch || context.branch || null;
  const { data: snapshots = [], error } = await fetchGoogleReviewSnapshots();
  if (error) throw error;

  const periodOptions = resolveSnapshotPeriod(context.question, context.period || {});

  if (branch) {
    const report = computeBranchGoogleMovement(snapshots, branch, periodOptions);
    const delta = reviewDeltaFromReport(report);
    return {
      branch,
      branchLabel: branchDisplayName(branch),
      periodLabel: report.period_label || periodOptions.periodLabel || context.period?.rangeId || "selected period",
      reviewDelta: delta,
      currentReviewCount: report.current_review_count,
      currentRating: report.current_rating,
      trackingStartDate: report.tracking_start_date,
      partial: Boolean(report.period_partial || report.month_partial),
      historyNote: report.history_note,
      report,
      sources: [{ name: "google_review_snapshots", detail: "published review count delta" }],
      warnings: !report.tracking_start_date
        ? ["No Google review snapshots stored for this branch yet."]
        : delta == null
          ? ["Snapshot history exists but the selected period delta could not be computed."]
          : [],
    };
  }

  const reports = buildAllBranchGoogleMovement(snapshots, {
    branchIds: GOOGLE_PLACE_BRANCHES,
    ...periodOptions,
  });
  const networkDelta = reports.reduce((sum, row) => sum + (reviewDeltaFromReport(row) || 0), 0);
  const hasHistory = reports.some((row) => row.tracking_start_date);

  return {
    branch: null,
    branchLabel: "Network (all branches)",
    periodLabel: periodOptions.periodLabel || "selected period",
    reviewDelta: hasHistory ? networkDelta : null,
    branchReports: reports,
    partial: reports.some((row) => row.period_partial || row.month_partial),
    sources: [{ name: "google_review_snapshots", detail: "network review count delta" }],
    warnings: !hasHistory ? ["No Google review snapshots stored yet."] : [],
  };
}

export async function probeGoogleReviewSnapshots() {
  const { data = [] } = await fetchGoogleReviewSnapshots().catch(() => ({ data: [] }));
  return { hasSnapshots: data.length > 0, count: data.length };
}
