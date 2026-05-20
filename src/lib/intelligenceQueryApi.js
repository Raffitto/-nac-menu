import { MONTH_HOURS } from "../dashboard/utils/rangeState";

export function isTimeoutError(error) {
  const msg = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("canceling statement") ||
    msg.includes("statement timeout") ||
    error?.code === "57014"
  );
}

export function biRollupForHours(hours) {
  const h = Number(hours);
  return h >= 168 || h === MONTH_HOURS;
}

export const EMPTY_BI_DASHBOARD = {
  partial_mode: true,
  total_events: 0,
  total_sessions: 0,
  by_language: {},
  by_event_type: {},
  top_items: [],
  top_categories: [],
  by_hour: [],
  top_searches: [],
  top_addon_pairs: [],
  dead_zones: [],
  lost_searches: [],
  session_quality: {},
  lang_behavior: {},
  bounce_sessions: 0,
  deep_sessions: 0,
  avg_time_spent: 0,
  avg_items_per_session: 0,
  returning_sessions: 0,
  today_unique_sessions: 0,
  today_qr_sessions: 0,
  funnel: {},
  strongest_hour: null,
  top_converting_category: {},
  placement_stats: [],
  modal_engagement_events: 0,
};

function normalizeRpcPayload(data) {
  if (data == null) return null;
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

/**
 * BI dashboard with rollup routing, timeout fallbacks, and partial payloads.
 */
export async function fetchBiDashboard(supabase, { branch = null, hours = 24 } = {}) {
  if (!supabase) {
    return { data: EMPTY_BI_DASHBOARD, partial: true, note: "Supabase not configured" };
  }

  const pHours = Number(hours) || 24;
  const params = { p_branch: branch || null, p_hours: pHours };
  const rollup = biRollupForHours(pHours);
  const rpcName = rollup ? "get_bi_dashboard_from_rollup" : "get_bi_dashboard";

  const { data, error } = await supabase.rpc(rpcName, params);

  if (!error) {
    const payload = normalizeRpcPayload(data);
    if (payload && typeof payload === "object") {
      return {
        data: payload,
        partial: Boolean(payload.partial_mode),
        note: payload.aggregation_note || null,
      };
    }
  }

  if (error && isTimeoutError(error) && !rollup) {
    const rollupRes = await supabase.rpc("get_bi_dashboard_from_rollup", params);
    if (!rollupRes.error && rollupRes.data) {
      const payload = normalizeRpcPayload(rollupRes.data);
      return {
        data: payload,
        partial: true,
        note: "Loaded from daily rollup after timeout. Item-level charts may be limited.",
      };
    }
  }

  if (error && isTimeoutError(error) && pHours > 24) {
    const todayRes = await supabase.rpc("get_bi_dashboard", {
      p_branch: branch || null,
      p_hours: 24,
    });
    if (!todayRes.error && todayRes.data) {
      const payload = normalizeRpcPayload(todayRes.data);
      return {
        data: payload,
        partial: true,
        note: "Showing today only — wider range timed out. Run intelligence_query_optimization.sql.",
      };
    }
  }

  if (error && !isTimeoutError(error)) {
    throw error;
  }

  return {
    data: { ...EMPTY_BI_DASHBOARD, aggregation_note: "Query timed out" },
    partial: true,
    note: "Analytics temporarily unavailable. Try Today or a single branch.",
  };
}

/**
 * Branch comparison — rollup for 7D / month.
 */
export async function fetchBranchComparisonSafe(supabase, hours = 24) {
  if (!supabase) return { data: [], partial: false, note: null };

  const pHours = Number(hours) || 24;
  const rpcName = biRollupForHours(pHours)
    ? "get_branch_comparison_from_rollup"
    : "get_branch_comparison";

  const { data, error } = await supabase.rpc(rpcName, { p_hours: pHours });

  if (!error) {
    const rows = Array.isArray(data) ? data : [];
    return { data: rows, partial: biRollupForHours(pHours), note: null };
  }

  if (isTimeoutError(error) && !biRollupForHours(pHours)) {
    const rollup = await supabase.rpc("get_branch_comparison_from_rollup", { p_hours: pHours });
    if (!rollup.error) {
      return {
        data: Array.isArray(rollup.data) ? rollup.data : [],
        partial: true,
        note: "Branch comparison from rollup after timeout.",
      };
    }
  }

  if (isTimeoutError(error)) {
    return { data: [], partial: true, note: "Branch comparison timed out." };
  }

  throw error;
}

/**
 * Server-side review_events aggregates — avoids 5k row client scans.
 */
export async function fetchReviewEventsSummary(supabase, { branch = null, hours = 24 } = {}) {
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("get_review_events_summary", {
    p_branch: branch || null,
    p_hours: Number(hours) || 24,
  });

  if (error && isTimeoutError(error) && Number(hours) > 24) {
    const fallback = await supabase.rpc("get_review_events_summary", {
      p_branch: branch || null,
      p_hours: 24,
    });
    if (!fallback.error) {
      return {
        ...normalizeRpcPayload(fallback.data),
        _partial: true,
        _note: "Review stats for today only (timeout).",
      };
    }
    return null;
  }

  if (error) {
    const msg = `${error.message || ""}`.toLowerCase();
    if (msg.includes("function") && msg.includes("does not exist")) {
      return null;
    }
    throw error;
  }
  return normalizeRpcPayload(data);
}
