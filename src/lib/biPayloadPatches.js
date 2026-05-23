/**
 * Shared BI payload patches (session quality, item detail).
 */

import { normalizeBiDashboardPayload, biSessionQualityNeedsRefresh } from "./biDashboardNormalize";
import { fetchBiSessionQualityFromMenuEvents } from "./menuEventsBiFallback";
import {
  sessionQualityIsEmpty,
  sessionQualityTierSum,
} from "./sessionQualityAggregate";

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
  };
  return normalizeBiDashboardPayload(merged);
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

/** Map session-quality patch onto session analytics aggregates shape. */
export async function applySessionQualityToAggregates(supabase, params, aggregates) {
  if (!aggregates || !sessionQualityIsEmpty(aggregates)) return aggregates;
  const patch = await fetchBiSessionQualityFromMenuEvents(supabase, {
    branch: params.p_branch,
    hours: params.p_hours,
  });
  if (!patch || sessionQualityIsEmpty(patch)) return aggregates;
  return {
    ...aggregates,
    session_quality: patch.session_quality,
    bounce_sessions: patch.bounce_sessions,
    deep_sessions: patch.deep_sessions,
    avg_time_spent: patch.avg_time_spent,
    avg_items_per_session: patch.avg_items_per_session,
    total_sessions: Math.max(aggregates.total_sessions || 0, patch.total_sessions || 0),
  };
}
