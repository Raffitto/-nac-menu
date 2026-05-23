/**
 * Confidence scoring for menu BI, predictive, and executive signals.
 */

import { CONFIDENCE, minConfidence } from "../contracts/dataConfidence";
import { assessMenuBiSufficiency } from "../contracts/dataSufficiency";

function scoreToConfidence(score) {
  if (score >= 75) return CONFIDENCE.HIGH;
  if (score >= 45) return CONFIDENCE.MEDIUM;
  return CONFIDENCE.LOW;
}

/**
 * Menu BI confidence from volume, RPC path, and hourly coverage.
 */
export function assessMenuBiConfidence({
  data = null,
  rangeContract = {},
  dataSource = null,
  liveFallback = false,
  partial = false,
  sufficiency = null,
  tracking = null,
} = {}) {
  const suff = sufficiency || assessMenuBiSufficiency(data, rangeContract);
  const events = suff.events;
  const sessions = suff.sessions;
  const reasons = [];

  let score = 50;

  if (suff.sufficient) score += 25;
  else if (suff.sparse) score -= 20;

  if (dataSource === "rpc" || dataSource === "rollup") score += 15;
  if (liveFallback || dataSource === "client_fallback") {
    score -= 25;
    reasons.push("client_fallback_active");
  }
  if (partial) {
    score -= 8;
    reasons.push("partial_payload");
  }
  if (suff.insufficientHourly) {
    score -= 12;
    reasons.push("sparse_hourly_buckets");
  }

  const fail = Number(tracking?.fail) || 0;
  const ok = Number(tracking?.ok) || 0;
  if (ok + fail > 0) {
    const failRate = fail / (ok + fail);
    if (failRate > 0.15) {
      score -= 20;
      reasons.push("elevated_track_failures");
    } else if (failRate < 0.02 && ok >= 10) {
      score += 8;
    }
  }

  if (events >= 80 && sessions >= 25) score += 10;
  if (rangeContract?.isRollupRange && dataSource !== "rollup") {
    score -= 10;
    reasons.push("rollup_range_non_rollup_source");
  }

  score = Math.max(0, Math.min(100, score));
  const level = scoreToConfidence(score);

  return {
    level,
    score,
    label: level,
    reasons,
    provisional: level !== CONFIDENCE.HIGH,
    events,
    sessions,
  };
}

export function assessPredictiveConfidence({
  pkg = null,
  reviewKpis = null,
  selectedRange = "today",
} = {}) {
  const reasons = [];
  let score = 40;

  const scans = Number(reviewKpis?.qr_scans) || 0;
  const branches = (pkg?.branchScores || []).filter((b) => b.score != null).length;

  if (pkg?.networkScoreBuilding) {
    score -= 15;
    reasons.push("network_baseline_building");
  }
  if (pkg?.momentum?.insufficient_data) {
    score -= 25;
    reasons.push("momentum_insufficient");
  } else {
    score += 20;
  }
  if (scans >= 20) score += 15;
  if (scans >= 50) score += 10;
  if (branches >= 2) score += 10;
  if (selectedRange === "today" && scans < 8) {
    score -= 15;
    reasons.push("thin_today_review_sample");
  }

  const mom = pkg?.momentum;
  if (mom?.snapshot_days != null && mom.snapshot_days < 3) {
    score -= 10;
    reasons.push("shallow_trend_depth");
  }

  score = Math.max(0, Math.min(100, score));
  const level = scoreToConfidence(score);

  return {
    level,
    score,
    reasons,
    provisional: level !== CONFIDENCE.HIGH,
  };
}

export function attachConfidenceToMomentum(momentum, confidence) {
  if (!momentum || typeof momentum !== "object") return momentum;
  const conf = confidence?.level || CONFIDENCE.LOW;
  return {
    ...momentum,
    confidence: conf,
    confidence_score: confidence?.score ?? 0,
    provisional: conf !== CONFIDENCE.HIGH || Boolean(momentum.insufficient_data),
  };
}

export function mergeConfidences(...assessments) {
  const levels = assessments.map((a) => a?.level).filter(Boolean);
  const level = minConfidence(...levels);
  const score = Math.round(
    assessments.reduce((s, a) => s + (Number(a?.score) || 0), 0) /
      Math.max(1, assessments.length),
  );
  return {
    level,
    score,
    provisional: level !== CONFIDENCE.HIGH,
    reasons: assessments.flatMap((a) => a?.reasons || []),
  };
}
