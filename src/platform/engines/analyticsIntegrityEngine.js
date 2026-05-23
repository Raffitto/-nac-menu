/**
 * Analytics integrity metrics — trust / observability signals.
 */

import { detectHourlyGranularity } from "../../dashboard/utils/hourlyBucketLabels";
import { canonicalCategoryOpenCount } from "../../lib/menuEventTypes";

function branchDistributionImbalance(branchDist = {}) {
  const vals = Object.values(branchDist).map((n) => Number(n) || 0);
  if (vals.length < 2) return { imbalanced: false, ratio: 1 };
  const max = Math.max(...vals);
  const min = Math.min(...vals.filter((v) => v > 0)) || 0;
  if (min === 0) return { imbalanced: true, ratio: Infinity };
  return { imbalanced: max / min > 8, ratio: Math.round((max / min) * 10) / 10 };
}

export function buildAnalyticsIntegrityReport({
  biData = null,
  tracking = null,
  dataSource = null,
  liveFallback = false,
  sufficiency = null,
  reviewKpis = null,
} = {}) {
  const ok = Number(tracking?.ok) || 0;
  const fail = Number(tracking?.fail) || 0;
  const totalTracks = ok + fail;
  const missingEventRatio = totalTracks > 0 ? Math.round((fail / totalTracks) * 1000) / 10 : 0;

  const byHour = biData?.by_hour || [];
  const gran = detectHourlyGranularity(byHour);
  const populated =
    gran === "hour"
      ? byHour.filter((r) => (Number(r.count) || 0) > 0).length
      : byHour.filter((r) => (Number(r.count) || 0) > 0).length;
  const expectedBuckets = gran === "hour" ? 24 : Math.max(byHour.length, 7);
  const sparseHourBuckets = expectedBuckets > 0 ? populated / expectedBuckets : 0;

  const branchDist = tracking?.branch_distribution || {};
  const branchBalance = branchDistributionImbalance(branchDist);

  const menuSessions = Number(biData?.total_sessions) || 0;
  const reviewScans = Number(reviewKpis?.qr_scans) || 0;

  let reviewMenuSync = "unknown";
  if (menuSessions > 0 && reviewScans > 0) {
    const ratio = reviewScans / menuSessions;
    if (ratio > 4) reviewMenuSync = "review_heavy";
    else if (ratio < 0.05) reviewMenuSync = "menu_heavy";
    else reviewMenuSync = "aligned";
  } else if (menuSessions > 5 && reviewScans === 0) {
    reviewMenuSync = "review_silent";
  } else if (reviewScans > 5 && menuSessions === 0) {
    reviewMenuSync = "menu_silent";
  }

  const rpcFallbackDivergence = liveFallback || dataSource === "client_fallback";
  const categoryCanonical = canonicalCategoryOpenCount(biData?.by_event_type || {});
  const categoryRpcOnly = Number(biData?.by_event_type?.category_open) || 0;
  const categoryNavGap = categoryCanonical - categoryRpcOnly;

  return {
    missing_event_ratio_pct: missingEventRatio,
    sparse_hour_buckets_ratio: Math.round(sparseHourBuckets * 100) / 100,
    populated_hour_buckets: populated,
    expected_hour_buckets: expectedBuckets,
    branch_imbalance: branchBalance.imbalanced,
    branch_imbalance_ratio: branchBalance.ratio,
    branch_distribution: branchDist,
    rpc_vs_fallback_divergence: rpcFallbackDivergence,
    data_source: dataSource,
    review_menu_sync: reviewMenuSync,
    category_nav_gap: categoryNavGap,
    sufficiency_sparse: Boolean(sufficiency?.sparse),
    tracking_ok: ok,
    tracking_fail: fail,
  };
}
