import { rangeToHours, MONTH_HOURS } from "../dashboard/utils/rangeState";
import { mapBiToSessionAggregates, mapBiTopAddons } from "../dashboard/utils/sessionAnalyticsMap";

function isTimeoutError(error) {
  const msg = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("canceling statement") ||
    msg.includes("statement timeout") ||
    error?.code === "57014"
  );
}

function rpcParamsFromFilters(filters) {
  const selectedRange = filters?.selectedRange || "today";
  const hours = filters?.timeRangeHours ?? rangeToHours(selectedRange);
  return {
    p_branch: filters?.branch || null,
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

function mergePayload(summary, feedRows) {
  const data = summary || {};
  return {
    aggregates: mapBiToSessionAggregates(data),
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
    const result = mergePayload(summary, feed);
    if (!result.aggregates?.total_events && params.p_hours >= MONTH_HOURS) {
      result.note =
        (result.note ? `${result.note} ` : "") +
        "Daily rollup may be empty — run refresh_menu_events_daily_rollup(45) in Supabase.";
      result.partial = true;
    }
    return result;
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
  const result = mergePayload(summary, feed);
  delete summary?.recent_feed;
  return result;
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
    return {
      ...mergePayload(summary, feed),
      partial: true,
      note: "Showing last 7 days (aggregated). Narrow branch or run session_analytics_rollup.sql.",
    };
  }

  const bi = await supabase.rpc("get_bi_dashboard", {
    p_branch: params.p_branch,
    p_hours: fallbackHours,
  });
  if (bi.error) throw bi.error;
  const biPayload = Array.isArray(bi.data) ? bi.data[0] : bi.data;
  return {
    aggregates: mapBiToSessionAggregates(biPayload),
    topAddons: mapBiTopAddons(biPayload),
    feed: [],
    byRole: {},
    byBranch: {},
    partial: true,
    note: "Showing last 7 days (fallback). Run session_analytics_rollup.sql in Supabase.",
  };
}
