import { MONTH_HOURS } from "../dashboard/utils/rangeState";
import {
  normalizeBiDashboardPayload,
  isBiTotalsEmpty,
  biTopItemsNeedsRefresh,
  biSessionQualityNeedsRefresh,
} from "./biDashboardNormalize";
import {
  fetchBiFromMenuEvents,
  fetchBiItemDetailFromMenuEvents,
  fetchBiSessionQualityFromMenuEvents,
  normalizeBranchForRpc,
} from "./menuEventsBiFallback";
import {
  normalizeBranchId,
  buildCanonicalBranchComparison,
} from "../dashboard/utils/branchIdentity";
import { appendOpsNote, partitionBiNotes } from "./biOpsNotes";
import { sessionQualityTierSum } from "./sessionQualityAggregate";
import { devLog } from "./devLog";
import { isTimeoutError } from "../dashboard/utils/supabaseResilience";

export { isTimeoutError };

export function biRollupForHours(hours) {
  const h = Number(hours);
  return h >= 168 || h === MONTH_HOURS;
}

export const EMPTY_BI_DASHBOARD = normalizeBiDashboardPayload({
  partial_mode: true,
  aggregation_note: "No menu_events in range",
});

function normalizeRpcPayload(data) {
  if (data == null) return null;
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

function mergeBiPayload(base, patch) {
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

async function rpcBiDashboard(supabase, rpcName, params) {
  const { data, error } = await supabase.rpc(rpcName, params);
  if (error) return { payload: null, error };
  const payload = normalizeRpcPayload(data);
  if (!payload || typeof payload !== "object") return { payload: null, error: null };
  return { payload, error: null };
}

/**
 * BI dashboard with rollup routing, false-zero fallbacks, and client menu_events aggregation.
 * @returns {{ data, partial, note, liveFallback, menuDataEmpty }}
 */
export async function fetchBiDashboard(supabase, { branch = null, hours = 24 } = {}) {
  if (!supabase) {
    return {
      data: EMPTY_BI_DASHBOARD,
      partial: true,
      note: "Supabase not configured",
      liveFallback: false,
      menuDataEmpty: true,
    };
  }

  const pHours = Number(hours) || 24;
  const pBranch = normalizeBranchForRpc(branch);
  const params = { p_branch: pBranch, p_hours: pHours };
  const useRollup = biRollupForHours(pHours);
  const primaryRpc = useRollup ? "get_bi_dashboard_from_rollup" : "get_bi_dashboard";

  devLog("[fetchBiDashboard]", { phase: "rpc_start", rpc: primaryRpc, params, useRollup });

  let { payload, error } = await rpcBiDashboard(supabase, primaryRpc, params);
  const primaryRpcEmpty = isBiTotalsEmpty(payload);

  let partial = Boolean(payload?.partial_mode);
  let note = payload?.aggregation_note || null;
  let opsNotes = [];
  let usedFallback = false;

  if (useRollup && (error || primaryRpcEmpty)) {
    devLog("[fetchBiDashboard]", { phase: "rollup_empty_fallback", error: error?.message });
    const direct = await rpcBiDashboard(supabase, "get_bi_dashboard", params);
    if (!direct.error && direct.payload && !isBiTotalsEmpty(direct.payload)) {
      payload = direct.payload;
      partial = true;
      usedFallback = true;
      note =
        "Loaded from menu_events (rollup empty or stale). Run refresh_menu_events_daily_rollup(45) in Supabase.";
      error = null;
    } else if (!error) {
      error = direct.error;
    }
  }

  if (error && isTimeoutError(error) && !useRollup) {
    const rollupRes = await rpcBiDashboard(supabase, "get_bi_dashboard_from_rollup", params);
    if (rollupRes.payload && !isBiTotalsEmpty(rollupRes.payload)) {
      payload = rollupRes.payload;
      partial = true;
      note = "Loaded from daily rollup after timeout. Item-level charts may be limited.";
      error = null;
    }
  }

  if (error && isTimeoutError(error) && pHours > 24) {
    const todayRes = await rpcBiDashboard(supabase, "get_bi_dashboard", {
      p_branch: pBranch,
      p_hours: 24,
    });
    if (todayRes.payload && !isBiTotalsEmpty(todayRes.payload)) {
      payload = todayRes.payload;
      partial = true;
      usedFallback = true;
      note = "Showing today only — wider range timed out. Run intelligence_query_optimization.sql.";
      error = null;
    }
  }

  if (error && !isTimeoutError(error)) {
    throw error;
  }

  if (isBiTotalsEmpty(payload)) {
    const clientPayload = await fetchBiFromMenuEvents(supabase, { branch: pBranch, hours: pHours });
    if (clientPayload && !isBiTotalsEmpty(clientPayload)) {
      payload = clientPayload;
      partial = true;
      usedFallback = true;
      note = clientPayload.aggregation_note || "Loaded from menu_events (client fallback).";
      devLog("[fetchBiDashboard]", {
        phase: "client_fallback_ok",
        events: clientPayload.total_events,
      });
    }
  }

  if (payload && biTopItemsNeedsRefresh(payload)) {
    const detail = await fetchBiItemDetailFromMenuEvents(supabase, {
      branch: pBranch,
      hours: pHours,
    });
    if (
      detail?.top_items?.length ||
      detail?.top_categories?.length
    ) {
      payload = mergeBiPayload(payload, detail);
      partial = true;
      usedFallback = true;
      opsNotes = appendOpsNote(
        opsNotes,
        "Item and category charts filled from live menu_events (rollup lacks item detail).",
      );
    }
  }

  if (payload && biSessionQualityNeedsRefresh(payload)) {
    const sessionPatch = await fetchBiSessionQualityFromMenuEvents(supabase, {
      branch: pBranch,
      hours: pHours,
    });
    if (sessionPatch && sessionQualityTierSum(sessionPatch.session_quality) > 0) {
      payload = mergeBiPayload(payload, sessionPatch);
      partial = true;
      usedFallback = true;
      opsNotes = appendOpsNote(
        opsNotes,
        "Session quality tiers computed from live menu_events (rollup lacks session metrics).",
      );
    }
  }

  const normalized = normalizeBiDashboardPayload(payload);
  const menuDataEmpty = isBiTotalsEmpty(normalized);
  const liveFallback = primaryRpcEmpty && !menuDataEmpty && (usedFallback || !isBiTotalsEmpty(payload));

  if (menuDataEmpty) {
    return {
      data: {
        ...EMPTY_BI_DASHBOARD,
        aggregation_note: note || "No menu_events in range",
      },
      partial: true,
      note: note || "No menu activity in this period. Open the public menu to generate events.",
      liveFallback: false,
      menuDataEmpty: true,
    };
  }

  const { userNote, opsNotes: noteOps } = partitionBiNotes(note, { partial, useRollup });
  const mergedOps = [...noteOps, ...opsNotes];

  devLog("[fetchBiDashboard]", {
    phase: "done",
    events: normalized.total_events,
    sessions: normalized.total_sessions,
    liveFallback,
    sessionQuality: normalized.session_quality,
  });

  return {
    data: normalized,
    partial,
    note: userNote,
    opsNotes: mergedOps,
    liveFallback,
    menuDataEmpty: false,
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
    const rows = buildCanonicalBranchComparison(
      (Array.isArray(data) ? data : []).map((row) => ({
        branch_id: normalizeBranchId(row.branch_id),
        sessions: Number(row.sessions) || 0,
        impressions: Number(row.impressions) || 0,
        opens: Number(row.opens) || 0,
        unique_visitors: Number(row.unique_visitors) || 0,
      })),
      { sessions: 0, impressions: 0, opens: 0, unique_visitors: 0 },
    );
    return { data: rows, partial: biRollupForHours(pHours), note: null };
  }

  if (isTimeoutError(error) && !biRollupForHours(pHours)) {
    const rollup = await supabase.rpc("get_branch_comparison_from_rollup", { p_hours: pHours });
    if (!rollup.error) {
      const rows = buildCanonicalBranchComparison(
        (Array.isArray(rollup.data) ? rollup.data : []).map((row) => ({
          branch_id: normalizeBranchId(row.branch_id),
          sessions: Number(row.sessions) || 0,
          impressions: Number(row.impressions) || 0,
          opens: Number(row.opens) || 0,
          unique_visitors: Number(row.unique_visitors) || 0,
        })),
        { sessions: 0, impressions: 0, opens: 0, unique_visitors: 0 },
      );
      return {
        data: rows,
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

  const pBranch = normalizeBranchForRpc(branch);

  const { data, error } = await supabase.rpc("get_review_events_summary", {
    p_branch: pBranch,
    p_hours: Number(hours) || 24,
  });

  if (error && isTimeoutError(error) && Number(hours) > 24) {
    const fallback = await supabase.rpc("get_review_events_summary", {
      p_branch: pBranch,
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
