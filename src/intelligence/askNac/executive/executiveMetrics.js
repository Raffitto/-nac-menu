/**
 * Deterministic executive metrics for Ask NAC — wraps dashboard scoring engines.
 */

import { computeBranchOperationalScore, computeNetworkBranchScores } from "../../../dashboard/engines/operationalScoreEngine";
import { buildAllBranchGoogleMovement } from "../../../dashboard/utils/googleReviewSnapshotHistory";
import { branchDisplayName } from "../../../dashboard/utils/rangeState";
import { normalizeBranchId } from "../../../dashboard/utils/branchIdentity";
import { clampDisplayPct, tapToGooglePct } from "../../../dashboard/utils/reviewFunnelMetrics";

function clampScore(n) {
  return Math.min(100, Math.max(0, Math.round(Number(n) || 0)));
}

function normalizeAgainstMax(value, max) {
  const safeMax = Math.max(Number(max) || 0, 1);
  return clampScore(((Number(value) || 0) / safeMax) * 100);
}

export function calculateReviewGrowth(googleMovement = {}) {
  const delta =
    googleMovement?.period_delta ??
    googleMovement?.month_delta ??
    googleMovement?.week_delta ??
    null;
  if (delta == null || !Number.isFinite(delta)) return 50;
  if (delta >= 20) return 100;
  if (delta >= 10) return 85;
  if (delta >= 3) return 72;
  if (delta >= 0) return 58;
  return 32;
}

export function calculateRatingGrowth(googleMovement = {}, snapshots = []) {
  const branchId = (googleMovement?.branch_id || "").toLowerCase();
  const branchSnaps = (snapshots || [])
    .filter((s) => (s.branch_id || "").toLowerCase() === branchId)
    .sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)));
  const first = branchSnaps.find((s) => s.rating != null);
  const latest = [...branchSnaps].reverse().find((s) => s.rating != null);
  if (!first?.rating || !latest?.rating) return 50;
  const delta = Number(latest.rating) - Number(first.rating);
  if (delta >= 0.3) return 95;
  if (delta >= 0.1) return 78;
  if (delta >= 0) return 62;
  if (delta >= -0.1) return 45;
  return 28;
}

export function calculateReviewVelocity(googleMovement = {}) {
  const week = googleMovement?.week_delta;
  const month = googleMovement?.month_delta;
  if (week == null && month == null) return 45;
  const pace = week != null ? week * 4 : month;
  if (pace >= 12) return 92;
  if (pace >= 6) return 78;
  if (pace >= 2) return 64;
  if (pace >= 0) return 52;
  return 34;
}

export function calculateGoogleImpact(branchRow = {}) {
  const redirects = Number(branchRow.google_redirects) || 0;
  const scans = Number(branchRow.qr_scans) || 0;
  const conversion = Number(branchRow.conversion_pct) || tapToGooglePct(redirects, scans);
  const redirectScore = Math.min(100, redirects * 4);
  const conversionScore = clampDisplayPct(conversion);
  return clampScore(redirectScore * 0.55 + conversionScore * 0.45);
}

export function calculateBranchMomentum(googleMovement = {}, branchRow = {}) {
  const growth = calculateReviewGrowth(googleMovement);
  const velocity = calculateReviewVelocity(googleMovement);
  const impact = calculateGoogleImpact(branchRow);
  return clampScore(growth * 0.4 + velocity * 0.35 + impact * 0.25);
}

export function buildExecutiveBranchScore(input = {}) {
  const branchId = normalizeBranchId(input.branchId);
  const branchRow = input.branchRow || {};
  const googleMovement = input.googleMovement || null;
  const operational = computeBranchOperationalScore({
    branchId,
    branchRow,
    staff: input.staff || [],
    googleMovement,
    networkMaxScans: input.networkMaxScans,
  });

  const components = {
    googleRatingScore: clampScore((Number(googleMovement?.current_rating) || 0) * 20),
    reviewGrowthScore: calculateReviewGrowth(googleMovement),
    googleRedirectScore: normalizeAgainstMax(
      branchRow.google_redirects,
      input.networkMaxRedirects,
    ),
    reviewConversionScore: clampDisplayPct(
      branchRow.conversion_pct || tapToGooglePct(branchRow.google_redirects, branchRow.qr_scans),
    ),
    reviewVelocityScore: calculateReviewVelocity(googleMovement),
    menuEngagementScore: normalizeAgainstMax(branchRow.qr_scans, input.networkMaxScans),
  };

  const composite = clampScore(
    Object.values(components).reduce((sum, value) => sum + value, 0) / Object.keys(components).length,
  );

  return {
    branch_id: branchId,
    branch_name: branchDisplayName(branchId),
    score: operational.score ?? composite,
    compositeScore: composite,
    operationalScore: operational.score,
    tier_label: operational.tier_label,
    insufficient_data: operational.insufficient_data,
    provisional: operational.provisional,
    components,
    strengths: operational.strengths || [],
    risks: operational.weaknesses || [],
  };
}

export function buildExecutiveBranchScores({
  branchComparison = [],
  staffByBranch = {},
  googleMovementByBranch = {},
  snapshots = [],
} = {}) {
  const rows = branchComparison || [];
  const networkMaxScans = Math.max(...rows.map((r) => Number(r.qr_scans) || 0), 1);
  const networkMaxRedirects = Math.max(...rows.map((r) => Number(r.google_redirects) || 0), 1);

  return rows
    .map((row) => {
      const branchId = normalizeBranchId(row.branch_id);
      if (!branchId) return null;
      const movement = googleMovementByBranch[branchId] || null;
      return buildExecutiveBranchScore({
        branchId,
        branchRow: row,
        staff: staffByBranch[branchId] || [],
        googleMovement: movement,
        networkMaxScans,
        networkMaxRedirects,
        snapshots,
      });
    })
    .filter(Boolean)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

export function calculateReviewGrowthRows(googleMovementByBranch = {}) {
  return Object.values(googleMovementByBranch)
    .map((movement) => {
      const starting = movement?.baseline_count;
      const current = movement?.current_review_count;
      if (starting == null || current == null) return null;
      const growth = current - starting;
      const growthPct =
        starting > 0 ? Math.round((growth / starting) * 1000) / 10 : growth > 0 ? 100 : 0;
      return {
        branch_id: movement.branch_id,
        branch_name: movement.branch_name || branchDisplayName(movement.branch_id),
        startingReviews: starting,
        currentReviews: current,
        growth,
        growthPct,
        trackingStart: movement.tracking_start_date,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.growth - a.growth);
}

function rankByMomentum(branchScores = []) {
  return [...branchScores].sort(
    (a, b) =>
      (b.components?.reviewVelocityScore ?? 0) - (a.components?.reviewVelocityScore ?? 0) ||
      (b.score ?? 0) - (a.score ?? 0),
  );
}

function rankByNeedsAttention(branchScores = []) {
  return [...branchScores].sort(
    (a, b) => (a.score ?? 101) - (b.score ?? 101) || (a.components?.reviewConversionScore ?? 0) - (b.components?.reviewConversionScore ?? 0),
  );
}

export function buildExecutiveSummary({
  analysisKind = "general",
  branchScores = [],
  rankings = [],
  reviewGrowthRows = [],
  commandCenter = null,
} = {}) {
  const ranked = branchScores.length ? branchScores : rankings;
  const winner = ranked[0] || null;
  const laggard = ranked[ranked.length - 1] || null;
  const brief = commandCenter?.dailyBrief || {};
  const momentumLeader = rankByMomentum(branchScores)[0] || winner;
  const attentionBranch = rankByNeedsAttention(branchScores)[0] || laggard;

  const rankingTable = ranked.slice(0, 6).map((row, index) => ({
    rank: index + 1,
    branch: row.branch_name,
    score: row.score ?? row.operational_score ?? row.compositeScore,
    strengths: (row.strengths || []).slice(0, 2).join(" · ") || "Building baseline",
    risks: (row.risks || row.weaknesses || []).slice(0, 2).join(" · ") || "Monitor conversion",
  }));

  const keyFindings = [];
  const recommendedActions = [];

  if (analysisKind === "stars_gained") {
    const totalGrowth = reviewGrowthRows.reduce((sum, row) => sum + (row.growth || 0), 0);
    const headline =
      reviewGrowthRows.length > 0
        ? `Since follow-up tracking started, the network gained ${totalGrowth} published Google reviews across ${reviewGrowthRows.length} branches.`
        : "Google review snapshot history is not available yet — capture daily snapshots to track star and review growth.";
    reviewGrowthRows.slice(0, 3).forEach((row) => {
      keyFindings.push(
        `${row.branch_name}: ${row.startingReviews} → ${row.currentReviews} reviews (${row.growth >= 0 ? "+" : ""}${row.growth}, ${row.growthPct}%).`,
      );
    });
    if (reviewGrowthRows.length === 0) {
      recommendedActions.push("Enable daily Google snapshot capture from Intelligence dashboards.");
    } else {
      recommendedActions.push("Protect branches with the highest review growth by sustaining redirect coaching.");
      recommendedActions.push("Investigate branches with flat or negative review growth.");
    }
    return { headline, winner: null, reason: null, rankingTable: [], reviewGrowthRows, keyFindings, recommendedActions };
  }

  if (analysisKind === "management_focus") {
    const priorities = [];
    if (attentionBranch) {
      priorities.push(`Strengthen ${attentionBranch.branch_name} — lowest executive score (${attentionBranch.score ?? "n/a"}).`);
    }
    if (brief.operational_concern) priorities.push(brief.operational_concern);
    if (brief.coaching_focus) priorities.push(brief.coaching_focus);
    const top3 = priorities.filter(Boolean).slice(0, 3);
    while (top3.length < 3 && brief.recommended_focus) {
      top3.push(brief.recommended_focus);
    }
    return {
      headline: top3[0] || "Focus on redirect participation and review conversion across the network this week.",
      winner: null,
      reason: null,
      rankingTable,
      keyFindings: top3,
      recommendedActions: top3,
    };
  }

  if (analysisKind === "manager_impact") {
    const topStaff = brief.top_performer_today;
    const headline = topStaff
      ? `${topStaff} is driving the strongest manager-level impact in the current period.`
      : "No manager-level impact leader yet — staff redirect attribution needs more activity.";
    if (topStaff) keyFindings.push(topStaff);
    if (brief.coaching_focus) recommendedActions.push(brief.coaching_focus);
    recommendedActions.push("Replicate top performer handoff routines in weaker branches.");
    return { headline, winner: topStaff, reason: brief.coaching_focus, rankingTable, keyFindings, recommendedActions };
  }

  if (analysisKind === "improved_most") {
    const leader = momentumLeader;
    const headline = leader
      ? `${leader.branch_name} improved the most on review momentum and redirect impact (${leader.components?.reviewVelocityScore}/100 velocity score).`
      : "Insufficient history to identify the most improved branch.";
    if (leader) {
      keyFindings.push(`${leader.branch_name} review velocity score: ${leader.components?.reviewVelocityScore}.`);
      keyFindings.push(`${leader.branch_name} review growth score: ${leader.components?.reviewGrowthScore}.`);
    }
    recommendedActions.push(`Study ${leader?.branch_name || "leading branch"} redirect coaching this period.`);
    return {
      headline,
      winner: leader?.branch_name,
      reason: (leader?.strengths || []).join("; "),
      rankingTable: rankByMomentum(branchScores).slice(0, 6).map((row, index) => ({
        rank: index + 1,
        branch: row.branch_name,
        score: row.components?.reviewVelocityScore,
        strengths: `Growth ${row.components?.reviewGrowthScore} · Impact ${row.components?.googleRedirectScore}`,
        risks: (row.risks || []).slice(0, 2).join(" · ") || "Monitor conversion",
      })),
      keyFindings,
      recommendedActions,
    };
  }

  if (analysisKind === "needs_attention") {
    const target = attentionBranch;
    const headline = target
      ? `${target.branch_name} needs attention with the lowest executive score (${target.score ?? "n/a"}) and risks: ${(target.risks || []).slice(0, 2).join(", ") || "conversion lag"}.`
      : "No branch scores available yet — need more card-handoff history.";
    if (target) {
      keyFindings.push(`Weakest score: ${target.branch_name} (${target.score ?? "n/a"}).`);
      (target.risks || []).slice(0, 2).forEach((risk) => keyFindings.push(risk));
    }
    recommendedActions.push(brief.recommended_focus || "Increase redirect coaching in the weakest branch.");
    return {
      headline,
      winner: null,
      reason: (target?.risks || []).join("; "),
      rankingTable: rankByNeedsAttention(branchScores).slice(0, 6).map((row, index) => ({
        rank: index + 1,
        branch: row.branch_name,
        score: row.score,
        strengths: (row.strengths || []).slice(0, 1).join(" · ") || "—",
        risks: (row.risks || []).slice(0, 2).join(" · ") || "Needs coaching",
      })),
      keyFindings,
      recommendedActions,
    };
  }

  const googleWinner =
    analysisKind === "google_maps"
      ? [...branchScores].sort(
          (a, b) =>
            (b.components?.googleRatingScore ?? 0) - (a.components?.googleRatingScore ?? 0) ||
            (b.components?.reviewGrowthScore ?? 0) - (a.components?.reviewGrowthScore ?? 0),
        )[0] || winner
      : winner;

  const headline = googleWinner
    ? `${googleWinner.branch_name} is performing best overall with an executive score of ${googleWinner.score ?? googleWinner.compositeScore} (${googleWinner.tier_label || "ranked leader"}).`
    : "Executive branch scoring needs more card-handoff and snapshot history.";

  if (googleWinner) {
    keyFindings.push(
      `Rating score ${googleWinner.components?.googleRatingScore}, review growth ${googleWinner.components?.reviewGrowthScore}, redirect impact ${googleWinner.components?.googleRedirectScore}.`,
    );
    (googleWinner.strengths || []).slice(0, 2).forEach((item) => keyFindings.push(item));
  }
  if (laggard && laggard.branch_id !== googleWinner?.branch_id) {
    recommendedActions.push(`Coach ${laggard.branch_name} using ${googleWinner?.branch_name || "leading branch"} playbooks.`);
  }
  recommendedActions.push(brief.recommended_focus || "Sustain balanced staff redirect participation.");

  return {
    headline,
    winner: googleWinner?.branch_name,
    reason: (googleWinner?.strengths || []).join("; ") || brief.recommended_focus,
    rankingTable,
    keyFindings,
    recommendedActions,
  };
}

export function buildGoogleMovementMap(snapshots = [], selectedRange = "month") {
  return Object.fromEntries(
    buildAllBranchGoogleMovement(snapshots, { periodRange: selectedRange }).map((row) => [row.branch_id, row]),
  );
}

export { computeNetworkBranchScores };
