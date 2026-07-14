/**
 * RBAC filters for executive / network intelligence packages (no engine forks).
 */

import {
  allowedBranchIds,
  canAccessAllBranches,
  canAccessNetworkReviews,
  reviewAllowedBranchIds,
} from "../dashboard/config/rbac";
import { OPERATIONAL_BRANCHES } from "../dashboard/engines/branchOperationalReviewEngine";
import {
  buildCanonicalBranchComparison,
  normalizeBranchId,
} from "../dashboard/utils/branchIdentity";
import { branchDashboardName } from "../dashboard/config/branchDisplayConfig";

function branchAllowed(profile, branchId) {
  if (!profile?.authenticated || canAccessAllBranches(profile)) return true;
  const id = normalizeBranchId(branchId);
  if (!id) return false;
  return allowedBranchIds(profile).includes(id);
}

/** Cache / fetch key segment — prevents cross-role intelligence cache bleed. */
export function rbacScopeCacheKey(profile) {
  if (!profile?.authenticated) return "anon";
  if (canAccessAllBranches(profile)) return "network";
  const ids = allowedBranchIds(profile).filter(Boolean).sort();
  return ids.length ? ids.join("+") : "denied";
}

export function isNetworkWideExecutiveScope(profile) {
  if (!profile?.authenticated) return true;
  return canAccessAllBranches(profile);
}

/**
 * Branch comparison rows scoped to RBAC — never pads hidden branches with zero rows.
 */
export function buildBranchComparisonForProfile(profile, rawRows = [], defaults = {}) {
  const merged = buildCanonicalBranchComparison(rawRows, defaults);
  if (!profile?.authenticated || canAccessAllBranches(profile)) return merged;
  const ids = new Set(allowedBranchIds(profile));
  return merged.filter((row) => ids.has(normalizeBranchId(row.branch_id)));
}

/** Review-only branch comparison scope; never expands operational RBAC. */
export function buildReviewBranchComparisonForProfile(profile, rawRows = [], defaults = {}) {
  const merged = buildCanonicalBranchComparison(rawRows, defaults);
  if (!profile?.authenticated || canAccessNetworkReviews(profile)) return merged;
  const ids = new Set(reviewAllowedBranchIds(profile));
  return merged.filter((row) => ids.has(normalizeBranchId(row.branch_id)));
}

function branchIdFromComparisonRow(row) {
  return normalizeBranchId(row?.branch_id || row?.branch || row?.id);
}

function filterObjectByBranch(profile, obj = {}) {
  if (!obj || !profile?.authenticated || canAccessAllBranches(profile)) return obj;
  const keep = (id) => branchAllowed(profile, id);
  return Object.fromEntries(
    Object.entries(obj).filter(([id]) => keep(normalizeBranchId(id))),
  );
}

function recomputeKpisFromComparison(comparison = []) {
  const rows = comparison || [];
  const qr_scans = rows.reduce((s, r) => s + (Number(r.qr_scans) || 0), 0);
  const google_redirects = rows.reduce((s, r) => s + (Number(r.google_redirects) || 0), 0);
  const reviews_generated = rows.reduce((s, r) => s + (Number(r.reviews_generated) || 0), 0);
  const review_page_opens = rows.reduce((s, r) => s + (Number(r.review_page_opens) || 0), 0);
  const conversion_pct =
    qr_scans > 0 ? Math.round((google_redirects / qr_scans) * 1000) / 10 : 0;
  return {
    qr_scans,
    google_redirects,
    reviews_generated,
    review_page_opens,
    conversion_pct,
    unique_review_visitors: 0,
    by_event_type: [],
  };
}

function filterSnapshotsForProfile(profile, snapshots = []) {
  if (!profile?.authenticated || canAccessAllBranches(profile)) return snapshots;
  const ids = new Set(allowedBranchIds(profile));
  return (snapshots || []).filter((s) => ids.has(normalizeBranchId(s.branch_id)));
}

function filterTimelineForScope(timeline = [], profile, networkWide) {
  if (!timeline?.length) return timeline;
  if (networkWide) return timeline;

  const keepBranch = (id) => branchAllowed(profile, id);

  return timeline
    .filter((ev) => {
      if (ev.kind === "network") return false;
      if (ev.kind === "pulse" && /network/i.test(ev.text || "")) return false;
      if (!ev.branch_id) return false;
      return keepBranch(ev.branch_id);
    })
    .map((ev) => {
      if (ev.kind === "pulse" && /network handoff/i.test(ev.text || "")) {
        const branchName = branchDashboardName(allowedBranchIds(profile)[0]);
        return {
          ...ev,
          text: ev.text.replace(/^Network/i, branchName),
          kind: "branch_pulse",
        };
      }
      return ev;
    });
}

function singleBranchHeatmapFromStatus(branchStatus = [], scoreByBranch = {}) {
  const b = branchStatus[0];
  if (!b) return { mode: "empty", columns: [], rows: [] };
  const scoreRow = scoreByBranch[b.branch_id] || {};
  return {
    mode: "single",
    columns: [],
    rows: [
      {
        branch_id: b.branch_id,
        branch_name: b.branch_name,
        cells: {},
        operational: {
          score: b.operational_score,
          momentum: b.momentum,
          redirects: b.google_redirects,
          participation: b.participation_breadth,
          health: b.health?.label,
          factors: scoreRow.factors || {},
        },
      },
    ],
  };
}

/**
 * Scope Command Center / predictive package to RBAC-visible branches.
 */
export function filterCommandCenterPackage(pkg, profile) {
  if (!pkg || !profile?.authenticated || canAccessAllBranches(profile)) return pkg;

  const keep = (branchId) => branchAllowed(profile, branchId);
  const networkWide = isNetworkWideExecutiveScope(profile);
  const allowedIds = allowedBranchIds(profile);

  const branchStatus = (pkg.branchStatus || []).filter((b) => keep(b.branch_id));
  const rankings = (pkg.rankings || []).filter((r) => keep(r.branch_id));
  const branchScores = (pkg.branchScores || []).filter((b) => keep(b.branch_id));
  const scoreByBranch = filterObjectByBranch(profile, pkg.scoreByBranch);
  const googleMovementByBranch = filterObjectByBranch(profile, pkg.googleMovementByBranch);

  const alerts = (pkg.alerts || []).filter((a) => {
    if (!a.branch_id) return false;
    return keep(a.branch_id);
  });

  let heatmap = pkg.heatmap;
  if (branchStatus.length <= 1) {
    heatmap = singleBranchHeatmapFromStatus(branchStatus, scoreByBranch);
  } else if (heatmap) {
    heatmap = {
      ...heatmap,
      mode: heatmap.mode || "matrix",
      rows: (heatmap.rows || []).filter((r) => keep(r.branch_id)),
    };
  }

  const staffByBranch = Object.fromEntries(
    Object.entries(pkg.staffByBranch || {}).filter(([id]) => keep(id)),
  );

  const staffInsights = (pkg.staffInsights || []).filter(
    (ins) => ins.branch_id && keep(ins.branch_id),
  );

  const executiveInsights = (pkg.executiveInsights || []).filter(
    (ins) => !ins.branch_id || keep(ins.branch_id),
  );

  const timeline = filterTimelineForScope(pkg.timeline, profile, networkWide);

  const soleScore =
    branchScores.length === 1 && branchScores[0].score != null
      ? branchScores[0].score
      : null;

  const dailyBrief = pkg.dailyBrief
    ? {
        ...pkg.dailyBrief,
        strongest_branch:
          branchStatus.length === 1
            ? branchStatus[0]?.branch_name
            : pkg.dailyBrief.strongest_branch,
        weakest_branch:
          branchStatus.length === 1
            ? branchStatus[0]?.branch_name
            : pkg.dailyBrief.weakest_branch,
        momentum_summary: networkWide
          ? pkg.dailyBrief.momentum_summary
          : branchStatus[0]
            ? `${branchStatus[0].branch_name} — ${branchStatus[0].momentum} momentum`
            : pkg.dailyBrief.momentum_summary,
        network_review_growth: networkWide
          ? pkg.dailyBrief.network_review_growth
          : branchStatus[0]?.review_growth != null
            ? `${branchStatus[0].review_growth >= 0 ? "+" : ""}${branchStatus[0].review_growth} review pace`
            : "—",
        operational_concern:
          branchStatus.length === 1 && branchStatus[0].health?.id === "critical"
            ? `${branchStatus[0].branch_name} requires immediate operational attention.`
            : pkg.dailyBrief.operational_concern,
      }
    : pkg.dailyBrief;

  const pulse = pkg.pulse
    ? {
        ...pkg.pulse,
        momentum:
          branchStatus.length === 1
            ? branchStatus[0].momentum
            : pkg.pulse.momentum,
        live_label: networkWide
          ? pkg.pulse.live_label
          : branchStatus[0]
            ? `${branchStatus[0].branch_name} — ${branchStatus[0].google_redirects} redirects in period`
            : pkg.pulse.live_label,
      }
    : pkg.pulse;

  return {
    ...pkg,
    branchStatus,
    rankings,
    branchScores,
    scoreByBranch,
    googleMovementByBranch,
    alerts,
    heatmap,
    staffByBranch,
    staffInsights,
    executiveInsights,
    timeline,
    dailyBrief,
    pulse,
    networkScore: soleScore ?? pkg.networkScore,
    networkScoreBuilding: branchStatus.every((b) => b.operational_score == null),
    rbacScope: {
      networkWide,
      allowedBranchIds: allowedIds,
    },
  };
}

export function operationalBranchIdsForProfile(profile) {
  if (!profile?.authenticated || canAccessAllBranches(profile)) {
    return [...OPERATIONAL_BRANCHES];
  }
  return allowedBranchIds(profile);
}

/**
 * Filter Command Center engine inputs before package generation (prevents cross-branch leakage).
 */
export function filterExecutiveCommandInput(input = {}, profile) {
  if (!input || !profile?.authenticated || canAccessAllBranches(profile)) {
    return {
      ...input,
      networkWide: true,
      allowedBranchIds: operationalBranchIdsForProfile(profile),
    };
  }

  const keep = (branchId) => branchAllowed(profile, branchId);
  const allowedBranchIdsList = operationalBranchIdsForProfile(profile);
  const networkWide = allowedBranchIdsList.length > 1;

  const branchComparison = (input.branchComparison || []).filter((row) =>
    keep(branchIdFromComparisonRow(row)),
  );
  const previousComparison = (input.previousComparison || []).filter((row) =>
    keep(branchIdFromComparisonRow(row)),
  );

  const staffByBranch = Object.fromEntries(
    Object.entries(input.staffByBranch || {}).filter(([id]) => keep(id)),
  );

  const snapshots = filterSnapshotsForProfile(profile, input.snapshots);

  const kpis = branchComparison.length
    ? recomputeKpisFromComparison(branchComparison)
    : input.kpis;

  return {
    ...input,
    branchComparison,
    previousComparison,
    staffByBranch,
    snapshots,
    kpis,
    networkWide,
    allowedBranchIds: allowedBranchIdsList,
  };
}

/** Scope predictive inputs for review surfaces without widening operational access. */
export function filterReviewIntelligenceInput(input = {}, profile) {
  const permitted = reviewAllowedBranchIds(profile).filter(Boolean);
  const requested = normalizeBranchId(input.activeBranch);
  const allowedIds =
    requested && permitted.includes(requested) ? [requested] : permitted;
  const allowed = new Set(allowedIds);
  const keep = (branchId) => allowed.has(normalizeBranchId(branchId));

  return {
    ...input,
    branchComparison: (input.branchComparison || []).filter((row) =>
      keep(branchIdFromComparisonRow(row)),
    ),
    previousComparison: (input.previousComparison || []).filter((row) =>
      keep(branchIdFromComparisonRow(row)),
    ),
    staffByBranch: Object.fromEntries(
      Object.entries(input.staffByBranch || {}).filter(([id]) => keep(id)),
    ),
    snapshots: (input.snapshots || []).filter((row) => keep(row.branch_id)),
    networkWide: !requested && canAccessNetworkReviews(profile),
    allowedBranchIds: allowedIds,
  };
}

/** Dynamic Command Center hero title for branch-scoped users. */
export function commandCenterPulseTitle(profile) {
  if (!profile?.authenticated || canAccessAllBranches(profile)) {
    return "Network operational pulse";
  }
  const ids = allowedBranchIds(profile);
  if (ids.length === 1) {
    return `${branchDashboardName(ids[0])} operational pulse`;
  }
  if (ids.length > 1) {
    return "Regional operational pulse";
  }
  return "Operational pulse";
}

export function commandCenterHeatmapEmptyCopy(profile, heatmapRowCount = 0, heatmapMode = "matrix") {
  if (heatmapMode === "single") return null;
  if (heatmapRowCount > 1) return null;
  if (!profile?.authenticated || canAccessAllBranches(profile)) {
    return "Waiting for sufficient branch comparison data — cross-branch heatmap fills in as branches report.";
  }
  return "Branch-scoped view — network comparison unlocks for executive roles with multi-branch access.";
}

