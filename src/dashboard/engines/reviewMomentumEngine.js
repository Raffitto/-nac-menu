/**
 * Lightweight review funnel forecasting — rules + rolling averages only.
 */

import { clampDisplayPct } from "../utils/reviewFunnelMetrics";
import { CONFIDENCE } from "../../platform/contracts/dataConfidence";

const INSUFFICIENT_MSG = "Insufficient historical data";

function avgDaily(values = []) {
  const nums = values.map((v) => Number(v) || 0).filter((n) => n >= 0);
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function momentumLabel(delta) {
  if (delta == null || !Number.isFinite(delta)) return "Stable";
  if (delta > 2) return "Rising";
  if (delta < -2) return "Declining";
  return "Stable";
}

function paceVsWeekPct(currentGoogle, previousGoogle) {
  if (!previousGoogle || previousGoogle <= 0) return null;
  return Math.round(((currentGoogle - previousGoogle) / previousGoogle) * 100);
}

/**
 * @param {object} input
 */
export function computeReviewMomentum(input = {}) {
  const kpis = input.kpis || {};
  const dailyTrend = input.dailyTrend || [];
  const googleMovement = input.googleMovement || null;
  const previousKpis = input.previousKpis || null;

  const scans = Number(kpis.qr_scans) || 0;
  const google = Number(kpis.google_redirects) || 0;
  const conv = Number(kpis.conversion_pct) || 0;

  if (scans < 5 && !googleMovement?.tracking_start_date) {
    return {
      insufficient_data: true,
      message: INSUFFICIENT_MSG,
      momentum: "Stable",
      confidence: CONFIDENCE.LOW,
      provisional: true,
      tonight_redirects: null,
      monthly_review_gain: null,
      redirect_pace_vs_last_week: null,
      projected_monthly_scans: null,
    };
  }

  const trendScans = dailyTrend.map((d) => d.scans);
  const days = Math.max(trendScans.length, 1);
  const avgScans = avgDaily(trendScans);
  const avgGoogle = days > 0 ? google / days : google;

  const tonightBase = Math.max(avgGoogle, google > 0 ? google * 0.15 : 0);
  const tonightLow = Math.max(0, Math.round(tonightBase * 0.85));
  const tonightHigh = Math.max(tonightLow, Math.round(tonightBase * 1.35));

  const monthDelta =
    googleMovement?.month_delta ??
    googleMovement?.period_delta ??
    googleMovement?.week_delta ??
    null;

  const monthlyGain =
    monthDelta != null && Number.isFinite(monthDelta)
      ? monthDelta
      : Math.round(avgGoogle * days * 0.3);

  const prevGoogle = previousKpis?.google_redirects;
  const pacePct = paceVsWeekPct(google, prevGoogle);

  const weekDelta = googleMovement?.week_delta;
  const momentum = momentumLabel(weekDelta ?? monthDelta);

  const rangeDays = input.rangeDays || days || 7;
  const projectedMonthlyScans = Math.round(avgScans * Math.min(30, rangeDays * 4.3));

  const confidence =
    days >= 7 && scans >= 25
      ? CONFIDENCE.HIGH
      : days >= 3 && scans >= 10
        ? CONFIDENCE.MEDIUM
        : CONFIDENCE.LOW;

  return {
    insufficient_data: false,
    message: null,
    momentum,
    confidence,
    provisional: confidence !== CONFIDENCE.HIGH,
    tonight_redirects: { low: tonightLow, high: tonightHigh },
    monthly_review_gain: monthlyGain,
    redirect_pace_vs_last_week: pacePct,
    projected_monthly_scans: projectedMonthlyScans,
    target_pace_pct: clampDisplayPct(Math.min(conv + 8, 92)),
    snapshot_days: days,
  };
}
