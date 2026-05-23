import { rangeToHours, MONTH_HOURS } from "../dashboard/utils/rangeState";
import { fetchBiDashboard } from "./intelligenceQueryApi";
import { isBiTotalsEmpty } from "./biDashboardNormalize";
import { normalizeBranchForRpc } from "./menuEventsBiFallback";
import { mapBiToSessionAggregates, mapBiTopAddons } from "../dashboard/utils/sessionAnalyticsMap";
import { fetchBiSessionQualityFromMenuEvents } from "./menuEventsBiFallback";
import { sessionQualityIsEmpty } from "./sessionQualityAggregate";
import { appendOpsNote, partitionBiNotes } from "./biOpsNotes";
import { isTimeoutError } from "../dashboard/utils/supabaseResilience";

function rpcParamsFromFilters(filters) {
  const selectedRange = filters?.selectedRange || "today";
  const hours = filters?.timeRangeHours ?? rangeToHours(selectedRange);
  return {
    p_branch: normalizeBranchForRpc(filters?.branch),
    p_hours: hours,
    p_language: filters?.language || "all",
    p_event_type: filters?.eventType || "all",
    p_shift: filters?.shift || "all",
    p_day_type: filters?.dayType || "all",
    p_role: filters?.role || "all",
    p_feed_limit: 45,
    p_light: hours >= 168,
  };
}

function normalizeFeedRow(row) {
  if (!row) return row;
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return {
    ...row,
    employee_role: row.employee_role || meta.employee_role || meta.role || null,
  };
}

async function patchSessionQualityAggregates(supabase, params, aggregates) {
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

async function mergePayload(supabase, params, summary, feedRows) {
  const data = summary || {};
  let aggregates = mapBiToSessionAggregates(data);
  if (supabase && params) {
    aggregates = await patchSessionQualityAggregates(supabase, params, aggregates);
  }
  return {
    aggregates,
    topAddons: mapBiTopAddons(data),
    feed: (feedRows || data.recent_feed || []).map(normalizeFeedRow),
    byRole: data.by_role || {},
    byBranch: data.by_branch || {},
    partial: Boolean(data.partial_mode),
    note: data.aggregation_note || null,
  };
}

async function fetchFeed(supabase, params) {
  const { data, error } = await supabase.rpc("get_session_analytics_feed", {
    p_branch: params.p_branch,
    p_hours: params.p_hours,
    p_limit: params.p_feed_limit,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/**
 * RPC-first Session Analytics — rollup for month, bounded feed query, no browser scans.
 */
export async function fetchSessionAnalytics(supabase, filters) {
  const params = rpcParamsFromFilters(filters);
  const useRollup = params.p_hours >= 168 || params.p_hours === MONTH_HOURS;

  if (useRollup) {
    const [rollupRes, feed] = await Promise.all([
      supabase.rpc("get_session_analytics_from_rollup", {
        p_branch: params.p_branch,
        p_hours: params.p_hours,
        p_language: params.p_language,
        p_event_type: params.p_event_type,
        p_shift: params.p_shift,
        p_day_type: params.p_day_type,
        p_role: params.p_role,
      }),
      fetchFeed(supabase, params).catch(() => []),
    ]);

    if (rollupRes.error && isTimeoutError(rollupRes.error)) {
      return fetchSessionAnalyticsFallback(supabase, params);
    }
    if (rollupRes.error) throw rollupRes.error;

    const summary = Array.isArray(rollupRes.data) ? rollupRes.data[0] : rollupRes.data;
    let result = await mergePayload(supabase, params, summary, feed);
    let opsNotes = [];
    if (!result.aggregates?.total_events) {
      const bi = await fetchBiDashboard(supabase, {
        branch: params.p_branch,
        hours: params.p_hours,
      });
      if (bi?.data && !isBiTotalsEmpty(bi.data)) {
        result = {
          ...(await mergePayload(supabase, params, bi.data, feed)),
          partial: true,
          note: bi.note || null,
          opsNotes: bi.opsNotes || [],
        };
      } else if (params.p_hours >= MONTH_HOURS) {
        opsNotes = appendOpsNote(
          opsNotes,
          "Daily rollup may be empty — run refresh_menu_events_daily_rollup(45) in Supabase.",
        );
        result.partial = true;
      }
    } else if (sessionQualityIsEmpty(result.aggregates)) {
      opsNotes = appendOpsNote(
        opsNotes,
        "Session quality computed from live menu_events.",
      );
    }
    const { userNote, opsNotes: noteOps } = partitionBiNotes(result.note, {
      partial: result.partial,
      useRollup: true,
    });
    return {
      ...result,
      note: userNote,
      opsNotes: [...noteOps, ...opsNotes, ...(result.opsNotes || [])],
    };
  }

  const [summaryRes, feed] = await Promise.all([
    supabase.rpc("get_session_analytics", {
      ...params,
      p_light: true,
    }),
    fetchFeed(supabase, params).catch(() => []),
  ]);

  if (summaryRes.error && isTimeoutError(summaryRes.error)) {
    return fetchSessionAnalyticsFallback(supabase, params);
  }
  if (summaryRes.error) throw summaryRes.error;

  const summary = Array.isArray(summaryRes.data) ? summaryRes.data[0] : summaryRes.data;
  const result = await mergePayload(supabase, params, summary, feed);
  delete summary?.recent_feed;
  const { userNote, opsNotes } = partitionBiNotes(result.note, { partial: result.partial });
  return { ...result, note: userNote, opsNotes };
}

async function fetchSessionAnalyticsFallback(supabase, params) {
  const fallbackHours = 168;
  const [rollupRes, feed] = await Promise.all([
    supabase.rpc("get_session_analytics_from_rollup", {
      p_branch: params.p_branch,
      p_hours: fallbackHours,
      p_language: params.p_language,
      p_event_type: params.p_event_type,
      p_shift: params.p_shift,
      p_day_type: params.p_day_type,
      p_role: params.p_role,
    }),
    fetchFeed(supabase, { ...params, p_hours: fallbackHours }).catch(() => []),
  ]);

  if (!rollupRes.error && rollupRes.data) {
    const summary = Array.isArray(rollupRes.data) ? rollupRes.data[0] : rollupRes.data;
    const merged = await mergePayload(supabase, { ...params, p_hours: fallbackHours }, summary, feed);
    const { userNote, opsNotes } = partitionBiNotes(
      "Showing last 7 days (aggregated). Narrow branch or run session_analytics_rollup.sql.",
      { partial: true, useRollup: true },
    );
    return {
      ...merged,
      partial: true,
      note: userNote,
      opsNotes,
    };
  }

  const biRes = await fetchBiDashboard(supabase, {
    branch: params.p_branch,
    hours: fallbackHours,
  });
  if (!biRes?.data) throw new Error("BI fallback empty");
  const merged = await mergePayload(supabase, { ...params, p_hours: fallbackHours }, biRes.data, []);
  const { userNote, opsNotes } = partitionBiNotes(
    "Showing last 7 days (fallback). Run session_analytics_rollup.sql in Supabase.",
    { partial: true },
  );
  return {
    aggregates: merged.aggregates,
    topAddons: merged.topAddons,
    feed: [],
    byRole: {},
    byBranch: {},
    partial: true,
    note: userNote,
    opsNotes,
  };
}
