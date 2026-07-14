/**
 * Canonical review intelligence — single network-scoped dataset for all review widgets.
 */

import { fetchReviewEventsSummary } from "./intelligenceQueryApi";
import {
  canFetchCrossBranchComparison,
  resolveRbacQueryBranch,
} from "./rbacQueryScope";
import { canAccessNetworkReviews } from "../dashboard/config/rbac";
import { buildReviewBranchComparisonForProfile } from "./rbacIntelligenceScope";
import { normalizeBranchId } from "../dashboard/utils/branchIdentity";
import { fetchStaffMergedByBranch } from "../dashboard/utils/reviewStaffByBranch";
import {
  kpisFromReviewSummary,
  dailyTrendFromReviewSummary,
  branchComparisonFromReviewSummary,
  branchScansFromComparison,
} from "../dashboard/utils/reviewSummaryMap";
import { mergeStaffStats } from "../dashboard/utils/staffReviewStats";
import { buildNetworkStaffCoachingInsights } from "../dashboard/engines/staffCoachingIntelligenceEngine";
import { logBiIntelligenceDiagnostics } from "./intelligenceDiagnostics";
import { isNacDebugEnabled } from "./nacDebug";

/**
 * Resolve whether review surfaces load network-wide or a single branch.
 * CEO/developer: network unless an explicit branch filter is set (not null / all).
 * Branch managers: always scoped to assigned branch.
 */
export function resolveReviewScope(profile, requestedBranch = null) {
  const normalized = normalizeBranchId(requestedBranch);
  const networkCapable =
    canFetchCrossBranchComparison(profile) || canAccessNetworkReviews(profile);

  if (networkCapable && !normalized) {
    return {
      mode: "network",
      networkWide: true,
      queryBranch: null,
      displayBranch: null,
      label: "Network (all branches)",
    };
  }

  const queryBranch =
    networkCapable && normalized
      ? normalized
      : resolveRbacQueryBranch(profile, normalized);
  return {
    mode: "branch",
    networkWide: false,
    queryBranch,
    displayBranch: queryBranch,
    label: queryBranch || "Branch",
  };
}

/**
 * Detect coaching/insight vs table mismatch (executive diagnostics).
 */
export function assertReviewDataIntegrity({
  networkWide = false,
  branchComparison = [],
  staffMerged = [],
  staffInsights = [],
} = {}) {
  const warnings = [];
  const comparison = branchComparison || [];
  const staff = staffMerged || [];

  const staffByBranch = {};
  for (const row of staff) {
    const id = normalizeBranchId(row.branch);
    if (!id) continue;
    if (!staffByBranch[id]) staffByBranch[id] = [];
    staffByBranch[id].push(row);
  }

  const insightBranches = new Set(
    (staffInsights || []).map((ins) => normalizeBranchId(ins.branch_id)).filter(Boolean),
  );

  for (const branchId of insightBranches) {
    const comp = comparison.find((r) => normalizeBranchId(r.branch_id) === branchId);
    const scans = Number(comp?.qr_scans) || 0;
    const google = Number(comp?.google_redirects) || 0;
    const staffActive = (staffByBranch[branchId] || []).some(
      (s) => (s.scans || 0) > 0 || (s.google || 0) > 0,
    );
    if (staffActive && scans === 0 && google === 0) {
      warnings.push(
        `Coaching references ${branchId} activity but branch table shows zero card taps/redirects — scope mismatch.`,
      );
    }
  }

  if (networkWide) {
    const compTotal = comparison.reduce((s, r) => s + (Number(r.qr_scans) || 0), 0);
    const staffTotal = staff.reduce((s, r) => s + (Number(r.scans) || 0), 0);
    if (staffTotal > 0 && compTotal === 0) {
      warnings.push(
        "Network staff data is present but branch comparison totals are zero — aggregation path diverged.",
      );
    }
    const branchesWithStaff = Object.keys(staffByBranch).filter((id) =>
      staffByBranch[id].some((s) => (s.scans || 0) >= 3),
    );
    const branchesWithScans = comparison.filter((r) => (Number(r.qr_scans) || 0) > 0).length;
    if (branchesWithStaff.length >= 2 && branchesWithScans < 2) {
      warnings.push(
        "Multiple branches show staff activity but branch table under-reports network card taps.",
      );
    }
  }

  return {
    ok: warnings.length === 0,
    warnings,
  };
}

/**
 * Canonical review fetch — tables, KPIs, staff, and comparison use the same scope.
 */
export async function fetchUnifiedReviewTruth(supabase, { hours = 24, profile = null, branch = null } = {}) {
  const scope = resolveReviewScope(profile, branch);

  const networkSummary = scope.networkWide
    ? await fetchReviewEventsSummary(supabase, { branch: null, hours }).catch(() => null)
    : null;

  const branchSummary = !scope.networkWide
    ? await fetchReviewEventsSummary(supabase, { branch: scope.queryBranch, hours }).catch(() => null)
    : null;

  const summary = scope.networkWide ? networkSummary : branchSummary;

  const staffRows = await fetchStaffMergedByBranch(supabase, {
    hours,
    activeBranch: scope.networkWide ? null : scope.queryBranch,
  });

  const comparison = buildReviewBranchComparisonForProfile(
    profile,
    branchComparisonFromReviewSummary(summary || {}),
  );

  const staffMerged = mergeStaffStats([], staffRows);
  const staffByBranch = {};
  for (const row of staffMerged) {
    const id = normalizeBranchId(row.branch);
    if (!id) continue;
    if (!staffByBranch[id]) staffByBranch[id] = [];
    staffByBranch[id].push(row);
  }

  const staffInsights = buildNetworkStaffCoachingInsights(staffByBranch);
  const integrity = assertReviewDataIntegrity({
    networkWide: scope.networkWide,
    branchComparison: comparison,
    staffMerged,
    staffInsights,
  });

  if (integrity.warnings.length && (isNacDebugEnabled() || process.env.NODE_ENV === "development")) {
    logBiIntelligenceDiagnostics({
      source: "unifiedReviewTruth",
      reviewIntegrity: integrity,
      networkWide: scope.networkWide,
      branchComparisonCount: comparison.length,
      staffCount: staffMerged.length,
    });
  }

  return {
    scope,
    summary,
    kpis: kpisFromReviewSummary(summary),
    staffMerged,
    staffByBranch,
    dailyTrend: dailyTrendFromReviewSummary(summary),
    branchComparison: comparison,
    branchScans: branchScansFromComparison(comparison),
    staffInsights,
    integrity,
    partial: Boolean(summary?._partial),
    note: summary?._note || null,
  };
}
