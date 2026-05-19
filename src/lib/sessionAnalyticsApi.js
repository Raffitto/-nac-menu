import { rangeToHours } from "../dashboard/utils/rangeState";
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
  return {
    p_branch: filters?.branch || null,
    p_hours: filters?.timeRangeHours ?? rangeToHours(selectedRange),
    p_language: filters?.language || "all",
    p_event_type: filters?.eventType || "all",
    p_shift: filters?.shift || "all",
    p_day_type: filters?.dayType || "all",
    p_role: filters?.role || "all",
    p_feed_limit: 45,
    p_light: null,
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

/**
 * RPC-first Session Analytics — never bulk-scans menu_events in the browser.
 */
export async function fetchSessionAnalytics(supabase, filters) {
  const baseParams = rpcParamsFromFilters(filters);

  const runRpc = (params) => supabase.rpc("get_session_analytics", params);

  let { data, error } = await runRpc(baseParams);

  if (error && isTimeoutError(error)) {
    const fallback = {
      ...baseParams,
      p_light: true,
      p_hours: baseParams.p_hours >= 168 ? 168 : baseParams.p_hours,
    };
    const retry = await runRpc(fallback);
    data = retry.data;
    error = retry.error;

    if (!error && data) {
      return {
        aggregates: mapBiToSessionAggregates(data),
        topAddons: mapBiTopAddons(data),
        feed: (data.recent_feed || []).map(normalizeFeedRow),
        byRole: data.by_role || {},
        byBranch: data.by_branch || {},
        partial: true,
        note:
          data.aggregation_note ||
          "Query timed out — showing 7-day aggregated snapshot. Narrow branch or range for full detail.",
      };
    }

    const bi = await supabase.rpc("get_bi_dashboard", {
      p_branch: baseParams.p_branch,
      p_hours: 168,
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
      note: "Showing last 7 days (fallback). Run session_analytics_optimization.sql for full month support.",
    };
  }

  if (error) throw error;

  const payload = Array.isArray(data) ? data[0] : data;
  return {
    aggregates: mapBiToSessionAggregates(payload),
    topAddons: mapBiTopAddons(payload),
    feed: (payload?.recent_feed || []).map(normalizeFeedRow),
    byRole: payload?.by_role || {},
    byBranch: payload?.by_branch || {},
    partial: Boolean(payload?.partial_mode),
    note: payload?.aggregation_note || null,
  };
}
