/**
 * Shared BI payload patches (session quality, item detail).
 */

import {
  normalizeBiDashboardPayload,
  biSessionQualityNeedsRefresh,
} from "./biDashboardNormalize";
import { fetchBiSessionQualityFromMenuEvents } from "./menuEventsBiFallback";
import {
  sessionQualityIsEmpty,
  sessionQualityTierSum,
} from "./sessionQualityAggregate";
import { MAX_CREDIBLE_AVG_TIME_SPENT_SEC } from "./sessionMetricsConfig";
import { MONTH_HOURS } from "../dashboard/utils/rangeState";
import {
  applyCanonicalMenuSessionsToPayload,
  enforceMenuFunnelIntegrity,
} from "./customerFacingAnalytics";

export function mergeBiPayload(base, patch) {
  if (!patch) return base;
  const merged = {
    ...base,
    ...patch,
    by_language: { ...(base?.by_language || {}), ...(patch.by_language || {}) },
    by_event_type: { ...(base?.by_event_type || {}), ...(patch.by_event_type || {}) },
    funnel: { ...(base?.funnel || {}), ...(patch.funnel || {}) },
    session_quality: {
      ...(base?.session_quality || {}),
      ...(patch.session_quality || {}),
    },
    session_diagnostics: patch.session_diagnostics || base?.session_diagnostics,
  };
  return normalizeBiDashboardPayload(merged);
}

function sessionMetricsNeedLiveRefresh(aggregates) {
  if (!aggregates) return true;
  if (sessionQualityIsEmpty(aggregates)) return true;
  const avg = Number(aggregates.avg_time_spent) || 0;
  if (avg > MAX_CREDIBLE_AVG_TIME_SPENT_SEC) return true;
  const sessions = Number(aggregates.total_sessions) || 0;
  const funnelQr = Number(aggregates.funnel?.qr_scans) || 0;
  if (sessions > 10 && funnelQr > 0 && funnelQr < sessions * 0.5) return true;
  if (sessions > 10 && funnelQr < 20 && sessions > 50) return true;
  return biSessionQualityNeedsRefresh(aggregates);
}

/**
 * Patch session-quality tiers from live menu_events when rollup/RPC omitted them.
 * @returns {{ payload, patched: boolean, opsNote: string|null }}
 */
export async function applySessionQualityPatch(supabase, { branch, hours }, payload) {
  if (!payload || !biSessionQualityNeedsRefresh(payload)) {
    return { payload, patched: false, opsNote: null };
  }
  const patch = await fetchBiSessionQualityFromMenuEvents(supabase, { branch, hours });
  if (!patch || sessionQualityTierSum(patch.session_quality) <= 0) {
    return { payload, patched: false, opsNote: null };
  }
  return {
    payload: mergeBiPayload(payload, patch),
    patched: true,
    opsNote:
      "Session quality tiers computed from live menu_events (rollup lacks session metrics).",
  };
}

/** Recompute session metrics from live menu_events (funnel, duration, quality). */
export async function applySessionQualityToAggregates(supabase, params, aggregates) {
  if (!supabase || !params) return aggregates;

  const hours = Number(params.p_hours);
  const shouldRefresh =
    sessionMetricsNeedLiveRefresh(aggregates) ||
    hours <= 168 ||
    hours === MONTH_HOURS;

  if (!shouldRefresh) return aggregates;

  const patch = await fetchBiSessionQualityFromMenuEvents(supabase, {
    branch: params.p_branch,
    hours: params.p_hours,
  });
  if (!patch || sessionQualityIsEmpty(patch)) return aggregates;

  const patchSessions = Number(patch.total_sessions) || 0;
  const rollupSessions = Number(aggregates.total_sessions) || 0;
  const usePatchSessions =
    patchSessions > 0 &&
    (rollupSessions <= 0 || patchSessions <= rollupSessions * 1.05);

  const merged = applyCanonicalMenuSessionsToPayload({
    ...aggregates,
    session_quality: patch.session_quality,
    bounce_sessions: patch.bounce_sessions,
    deep_sessions: patch.deep_sessions,
    avg_time_spent: patch.avg_time_spent,
    avg_items_per_session: patch.avg_items_per_session,
    total_sessions: usePatchSessions ? patchSessions : rollupSessions,
    funnel: enforceMenuFunnelIntegrity(patch.funnel || aggregates.funnel || {}),
    _sessionFunnel: patch.funnel || aggregates.funnel,
    session_diagnostics: patch.session_diagnostics,
    top_categories:
      (patch.top_categories || []).length > 0
        ? patch.top_categories
        : aggregates.top_categories,
  });

  return merged;
}
