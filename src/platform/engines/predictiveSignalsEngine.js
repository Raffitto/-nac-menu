/**
 * Predictive signal foundations — extensible hooks for forecasting layers.
 * Current implementations delegate to existing engines; expand without breaking views.
 */

import { tapToGooglePct } from "./funnelAnalyticsEngine";
import { computeReviewMomentum } from "../../dashboard/engines/reviewMomentumEngine";

/** Demand / traffic proxy from menu sessions (placeholder for time-series model). */
export function estimateDemandSignal({ dailyTrend = [], sessions = 0 } = {}) {
  const points = dailyTrend || [];
  if (points.length < 3) {
    return { level: "unknown", trend: "stable", confidence: "low", sessions };
  }
  const last = points.slice(-3).map((p) => Number(p.scans ?? p.sessions ?? p.events) || 0);
  const avg = last.reduce((a, b) => a + b, 0) / last.length;
  const prev = points.slice(-6, -3).map((p) => Number(p.scans ?? p.sessions ?? p.events) || 0);
  const prevAvg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : avg;
  const delta = prevAvg > 0 ? ((avg - prevAvg) / prevAvg) * 100 : 0;

  return {
    level: avg >= 50 ? "high" : avg >= 15 ? "moderate" : "low",
    trend: delta > 8 ? "rising" : delta < -8 ? "falling" : "stable",
    deltaPct: Math.round(delta),
    confidence: points.length >= 7 ? "medium" : "low",
  };
}

/** Branch operational score input bundle (for predictiveIntelligenceEngine). */
export function branchOperationalSignal(branchRow, staff = [], googleMovement = null) {
  const scans = Number(branchRow?.qr_scans) || 0;
  const conversion = tapToGooglePct(branchRow?.google_redirects, scans);
  const activeStaff = (staff || []).filter((s) => (s.scans || 0) >= 2).length;

  return {
    branch_id: branchRow?.branch_id,
    volume: scans,
    conversion,
    activeStaff,
    momentum: computeReviewMomentum({
      kpis: branchRow,
      googleMovement,
      selectedRange: "7d",
      rangeDays: 7,
    }),
  };
}

/** Review momentum forecast stub — returns current momentum + confidence. */
export function reviewMomentumForecast(momentum) {
  if (!momentum || momentum.insufficient_data) {
    return { outlook: "insufficient", confidence: "low" };
  }
  const map = { Rising: "positive", Declining: "negative", Stable: "neutral" };
  return {
    outlook: map[momentum.momentum] || "neutral",
    confidence: momentum.confidence || "medium",
    redirectPace: momentum.redirect_pace_vs_last_week,
  };
}

/** Guest engagement score 0–100 from session quality tiers. */
export function guestEngagementScore(sessionQuality) {
  const tiers = sessionQuality?.tiers || sessionQuality;
  if (!tiers || typeof tiers !== "object") return { score: null, confidence: "low" };
  const deep = Number(tiers.deep) || 0;
  const engaged = Number(tiers.engaged) || 0;
  const bounce = Number(tiers.bounce) || 0;
  const total = deep + engaged + bounce + (Number(tiers.glance) || 0);
  if (total < 5) return { score: null, confidence: "low" };
  const score = Math.round(((deep * 1 + engaged * 0.6) / total) * 100);
  return { score: Math.min(100, score), confidence: total >= 30 ? "high" : "medium" };
}

/** Hidden-item opportunity — high impressions, low opens. */
export function hiddenItemOpportunityScore(item) {
  const imp = Number(item?.impressions) || 0;
  const opens = Number(item?.opens ?? item?.modal_opens) || 0;
  if (imp < 10) return { opportunity: 0, confidence: "low" };
  const rate = opens / imp;
  const opportunity = Math.round((1 - rate) * imp);
  return {
    opportunity,
    confidence: imp >= 40 ? "high" : "medium",
    label: rate < 0.08 ? "high" : rate < 0.15 ? "moderate" : "low",
  };
}
