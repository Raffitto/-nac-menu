/**
 * Edge executive analysis tools — deterministic multi-metric conclusions.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { MONTH_HOURS } from "./mtdHybridMerge.ts";
import { branchDisplayName, periodLabelFromHours } from "./askNacEdgeAnswerBuilder.ts";

const BRANCH_IDS = ["khobar", "riyadh", "jeddah"];

function clampScore(n: number) {
  return Math.min(100, Math.max(0, Math.round(Number(n) || 0)));
}

function normalizeMax(value: number, max: number) {
  return clampScore(((Number(value) || 0) / Math.max(max, 1)) * 100);
}

function tapToGooglePct(google: number, scans: number) {
  if (!scans) return 0;
  return clampScore((google / scans) * 100);
}

function calculateReviewGrowth(movement: Record<string, unknown> = {}) {
  const delta = Number(movement.period_delta ?? movement.month_delta ?? movement.week_delta);
  if (!Number.isFinite(delta)) return 50;
  if (delta >= 20) return 100;
  if (delta >= 10) return 85;
  if (delta >= 3) return 72;
  if (delta >= 0) return 58;
  return 32;
}

function buildBranchScore(row: Record<string, unknown>, movement: Record<string, unknown> | null, networkMaxScans: number, networkMaxRedirects: number) {
  const components = {
    googleRatingScore: clampScore((Number(movement?.current_rating) || 0) * 20),
    reviewGrowthScore: calculateReviewGrowth(movement || {}),
    googleRedirectScore: normalizeMax(Number(row.google_redirects) || 0, networkMaxRedirects),
    reviewConversionScore: clampScore(Number(row.conversion_pct) || tapToGooglePct(Number(row.google_redirects) || 0, Number(row.qr_scans) || 0)),
    reviewVelocityScore: calculateReviewGrowth(movement || {}),
    menuEngagementScore: normalizeMax(Number(row.qr_scans) || 0, networkMaxScans),
  };
  const score = clampScore(Object.values(components).reduce((sum, value) => sum + value, 0) / Object.keys(components).length);
  const strengths: string[] = [];
  const risks: string[] = [];
  if (components.reviewConversionScore >= 65) strengths.push("Strong redirect conversion");
  else risks.push("Weak redirect conversion");
  if (components.reviewGrowthScore >= 70) strengths.push("Positive review growth");
  else risks.push("Flat review growth");
  if (components.menuEngagementScore >= 60) strengths.push("Healthy card-handoff volume");
  else risks.push("Low card-handoff volume");
  return {
    branch_id: row.branch_id,
    branch_name: branchDisplayName(String(row.branch_id)),
    score,
    components,
    strengths,
    risks,
  };
}

function buildSummary(analysisKind: string, branchScores: Record<string, unknown>[], reviewGrowthRows: Record<string, unknown>[]) {
  const ranked = [...branchScores].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const winner = ranked[0] || null;
  const laggard = ranked[ranked.length - 1] || null;

  if (analysisKind === "stars_gained") {
    const totalGrowth = reviewGrowthRows.reduce((sum, row) => sum + (Number(row.growth) || 0), 0);
    return {
      headline: reviewGrowthRows.length
        ? `Since follow-up tracking started, the network gained ${totalGrowth} published Google reviews.`
        : "Google review snapshot history is not available yet.",
      winner: null,
      reason: null,
      rankingTable: [],
      keyFindings: reviewGrowthRows.slice(0, 3).map((row) =>
        `${row.branch_name}: ${row.startingReviews} → ${row.currentReviews} reviews (+${row.growth}).`
      ),
      recommendedActions: reviewGrowthRows.length
        ? ["Protect branches with the highest review growth.", "Investigate branches with flat review growth."]
        : ["Enable daily Google snapshot capture from Intelligence dashboards."],
    };
  }

  if (analysisKind === "management_focus") {
    const priorities = [
      laggard ? `Strengthen ${laggard.branch_name} — lowest executive score (${laggard.score}).` : null,
      winner ? `Replicate ${winner.branch_name} redirect coaching network-wide.` : null,
      "Prioritize branches with weak conversion despite active card taps.",
    ].filter(Boolean).slice(0, 3) as string[];
    return {
      headline: priorities[0] || "Focus on redirect participation and review conversion this week.",
      winner: null,
      reason: null,
      rankingTable: ranked.slice(0, 6).map((row, index) => ({
        rank: index + 1,
        branch: row.branch_name,
        score: row.score,
        strengths: (row.strengths as string[] | undefined)?.join(" · ") || "—",
        risks: (row.risks as string[] | undefined)?.join(" · ") || "—",
      })),
      keyFindings: priorities,
      recommendedActions: priorities,
    };
  }

  const headline = winner
    ? `${winner.branch_name} is performing best overall with an executive score of ${winner.score}.`
    : "Executive branch scoring needs more card-handoff and snapshot history.";

  return {
    headline,
    winner: winner?.branch_name || null,
    reason: (winner?.strengths as string[] | undefined)?.join("; ") || null,
    rankingTable: ranked.slice(0, 6).map((row, index) => ({
      rank: index + 1,
      branch: row.branch_name,
      score: row.score,
      strengths: (row.strengths as string[] | undefined)?.join(" · ") || "—",
      risks: (row.risks as string[] | undefined)?.join(" · ") || "—",
    })),
    keyFindings: winner
      ? [`${winner.branch_name} leads on composite Google Maps and redirect performance.`]
      : ["Insufficient branch score history."],
    recommendedActions: laggard && winner && laggard.branch_id !== winner.branch_id
      ? [`Coach ${laggard.branch_name} using ${winner.branch_name} playbooks.`]
      : ["Sustain balanced staff redirect participation."],
  };
}

async function fetchReviewSummary(supabase: SupabaseClient, hours: number, branch: string | null) {
  const { data, error } = await supabase.rpc("get_review_events_summary", {
    p_branch: branch,
    p_hours: hours,
  });
  if (error) throw error;
  return data || {};
}

function branchComparisonFromSummary(summary: Record<string, unknown>) {
  return Array.isArray(summary.by_branch) ? summary.by_branch : [];
}

export async function queryExecutiveAnalysisEdge(
  supabase: SupabaseClient,
  context: Record<string, unknown> = {},
) {
  const hours = Math.max(Number(context.hours) || 0, Number(context.filters?.timeRangeHours) || 0, MONTH_HOURS);
  const analysisKind = String(context.executiveKind || "general");
  const networkSummary = await fetchReviewSummary(supabase, hours, null);
  const branchComparison = branchComparisonFromSummary(networkSummary);
  const networkMaxScans = Math.max(...branchComparison.map((row: Record<string, unknown>) => Number(row.qr_scans) || 0), 1);
  const networkMaxRedirects = Math.max(...branchComparison.map((row: Record<string, unknown>) => Number(row.google_redirects) || 0), 1);

  const { data: snapshots = [] } = await supabase
    .from("google_review_snapshots")
    .select("branch_id, branch_name, rating, review_count, snapshot_date")
    .in("branch_id", BRANCH_IDS)
    .order("snapshot_date", { ascending: true });

  const movementByBranch: Record<string, Record<string, unknown>> = {};
  for (const branchId of BRANCH_IDS) {
    const branchSnaps = (snapshots || []).filter((s: Record<string, unknown>) => String(s.branch_id) === branchId);
    const first = branchSnaps[0];
    const latest = branchSnaps[branchSnaps.length - 1];
    movementByBranch[branchId] = {
      branch_id: branchId,
      branch_name: branchDisplayName(branchId),
      tracking_start_date: first?.snapshot_date || null,
      baseline_count: first?.review_count ?? null,
      current_review_count: latest?.review_count ?? null,
      current_rating: latest?.rating != null ? Number(latest.rating) : null,
      month_delta: first && latest ? Number(latest.review_count) - Number(first.review_count) : null,
      period_delta: first && latest ? Number(latest.review_count) - Number(first.review_count) : null,
    };
  }

  const branchScores = branchComparison.map((row: Record<string, unknown>) =>
    buildBranchScore(
      row,
      movementByBranch[String(row.branch_id)] || null,
      networkMaxScans,
      networkMaxRedirects,
    )
  ).sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));

  const reviewGrowthRows = Object.values(movementByBranch)
    .map((movement) => {
      const starting = movement.baseline_count;
      const current = movement.current_review_count;
      if (starting == null || current == null) return null;
      const growth = Number(current) - Number(starting);
      return {
        branch_id: movement.branch_id,
        branch_name: movement.branch_name,
        startingReviews: starting,
        currentReviews: current,
        growth,
        growthPct: Number(starting) > 0 ? Math.round((growth / Number(starting)) * 1000) / 10 : growth > 0 ? 100 : 0,
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  const summary = buildSummary(analysisKind, branchScores, reviewGrowthRows);

  return {
    hours,
    periodLabel: periodLabelFromHours(hours),
    analysisKind,
    summary,
    branchScores,
    reviewGrowthRows,
    warnings: branchScores.length ? [] : ["No branch comparison rows returned for executive analysis."],
    sources: [
      { name: "get_review_events_summary", detail: "review funnel by branch" },
      { name: "google_review_snapshots", detail: "rating and review growth baselines" },
    ],
  };
}

export function detectExecutiveAnalysisKindEdge(question = "") {
  const q = String(question || "").toLowerCase();
  if (/\b(stars? (gained|added)|how many stars|since follow[\s-]?up)\b/.test(q)) return "stars_gained";
  if (/\b(focus on|priorit(y|ies)|what should (i|we|management)|this week)\b/.test(q)) return "management_focus";
  if (/\b(manager|management).*(impact|biggest|influence)\b/.test(q)) return "manager_impact";
  if (/\b(improved|improvement|momentum)\b/.test(q)) return "improved_most";
  if (/\b(needs attention|weakest|underperform)\b/.test(q)) return "needs_attention";
  if (/\b(google maps|google rating)\b/.test(q)) return "google_maps";
  if (/\b(best overall|performing best|performing better|winning)\b/.test(q)) return "best_overall";
  return "general";
}
