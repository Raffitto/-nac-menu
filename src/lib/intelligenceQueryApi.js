import { MONTH_HOURS } from "../dashboard/utils/rangeState";
import {
  normalizeBiDashboardPayload,
  isBiTotalsEmpty,
  biTopItemsNeedsRefresh,
} from "./biDashboardNormalize";
import {
  fetchBiFromMenuEvents,
  fetchBiItemDetailFromMenuEvents,
  normalizeBranchForRpc,
} from "./menuEventsBiFallback";
import {
  normalizeBranchId,
  buildCanonicalBranchComparison,
} from "../dashboard/utils/branchIdentity";
import { appendOpsNote, partitionBiNotes } from "./biOpsNotes";
import { devLog } from "./devLog";
import { isTimeoutError } from "../dashboard/utils/supabaseResilience";
import { mergeBiPayload, applySessionQualityPatch } from "./biPayloadPatches";
import { recordPipelineFetch } from "./pipelineDiagnostics";
import { recordRpcRefresh } from "../platform/engines/dataFreshnessEngine";
import { assessMenuBiSufficiency } from "../platform/contracts/dataSufficiency";
import { isMonthRangeHours, hydrateMonthToDateHybrid } from "./mtdHybridMerge";
import { hoursToRange, rangeToSince } from "../dashboard/utils/rangeState";

export { isTimeoutError };

/**
 * Wide-range timeout handling — never substitute Today as Month.
 */
export function resolveWideRangeTimeout({ error, payload, isEmpty, hours }) {
  if (!error || !isTimeoutError(error) || Number(hours) <= 24) {
    return { throwError: error, partial: false, note: null };
  }

  const note = isMonthRangeHours(hours)
    ? "Month-to-date query timed out — showing partial data only. Retry or narrow branch filter."
    : "Wide-range query timed out — data is partial. Run intelligence_query_optimization.sql.";

  if (isEmpty(payload)) {
    return { throwError: error, partial: true, note };
  }

  return { throwError: null, partial: true, note };
}

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

  const rpcStarted = Date.now();
  let { payload, error } = await rpcBiDashboard(supabase, primaryRpc, params);
  let rpcTimingsMs = Date.now() - rpcStarted;
  const primaryRpcEmpty = isBiTotalsEmpty(payload);

  let partial = Boolean(payload?.partial_mode);
  let note = payload?.aggregation_note || null;
  let opsNotes = [];
  let usedFallback = false;
  let dataSource = primaryRpcEmpty
    ? null
    : useRollup
      ? "rollup"
      : "rpc";

  if (useRollup && payload && !isBiTotalsEmpty(payload) && !error && isMonthRangeHours(pHours)) {
    const hybridRes = await hydrateMonthToDateHybrid(
      payload,
      async () => {
        const todayRes = await rpcBiDashboard(supabase, "get_bi_dashboard", {
          p_branch: pBranch,
          p_hours: 24,
        });
        if (todayRes.error || !todayRes.payload || isBiTotalsEmpty(todayRes.payload)) {
          return null;
        }
        return todayRes.payload;
      },
    );
    if (hybridRes?.payload) {
      payload = hybridRes.payload;
      partial = partial || hybridRes.partial;
      dataSource = "hybrid";
      if (hybridRes.note) note = hybridRes.note;
      opsNotes = [...opsNotes, ...(hybridRes.opsNotes || [])];
      usedFallback = true;
    }
  } else if (useRollup && payload && !isBiTotalsEmpty(payload) && !error && pHours >= 168) {
    try {
      const since = rangeToSince(hoursToRange(pHours));
      let countQ = supabase
        .from("menu_events")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since)
        .lte("created_at", new Date().toISOString());
      if (pBranch) countQ = countQ.eq("branch_id", pBranch);
      const { count: liveCount } = await countQ;
      const rollupEvents = Number(payload.total_events) || 0;
      if (
        liveCount != null &&
        liveCount > 0 &&
        rollupEvents > 0 &&
        liveCount > rollupEvents * 1.15 &&
        liveCount - rollupEvents >= 15
      ) {
        const clientPayload = await fetchBiFromMenuEvents(supabase, {
          branch: pBranch,
          hours: pHours,
        });
        if (clientPayload && !isBiTotalsEmpty(clientPayload)) {
          payload = mergeBiPayload(clientPayload, payload);
          partial = true;
          usedFallback = true;
          dataSource = "client_fallback";
          note =
            "Rollup totals look stale for this range — merged live menu_events for accurate month/7D intelligence.";
          opsNotes = appendOpsNote(opsNotes, note);
        }
      }
    } catch {
      /* non-blocking freshness probe */
    }
  }

  if (useRollup && (error || primaryRpcEmpty)) {
    devLog("[fetchBiDashboard]", { phase: "rollup_empty_fallback", error: error?.message });
    const direct = await rpcBiDashboard(supabase, "get_bi_dashboard", params);
    if (!direct.error && direct.payload && !isBiTotalsEmpty(direct.payload)) {
      const t1 = Date.now();
      payload = direct.payload;
      rpcTimingsMs += Date.now() - t1;
      partial = true;
      usedFallback = true;
      dataSource = "rpc";
      note =
        "Loaded from menu_events (rollup empty or stale). Run refresh_menu_events_daily_rollup(45) in Supabase.";
      error = null;
    } else if (!error) {
      error = direct.error;
    }
  }

  if (error && isTimeoutError(error) && pHours > 24) {
    const timeoutRes = resolveWideRangeTimeout({
      error,
      payload,
      isEmpty: isBiTotalsEmpty,
      hours: pHours,
    });
    partial = partial || timeoutRes.partial;
    usedFallback = true;
    if (timeoutRes.note) note = timeoutRes.note;
    if (timeoutRes.throwError) {
      throw timeoutRes.throwError;
    }
    error = null;
  } else if (error && isTimeoutError(error) && !useRollup) {
    const rollupRes = await rpcBiDashboard(supabase, "get_bi_dashboard_from_rollup", params);
    if (rollupRes.payload && !isBiTotalsEmpty(rollupRes.payload)) {
      payload = rollupRes.payload;
      partial = true;
      note = "Loaded from daily rollup after timeout. Item-level charts may be limited.";
      error = null;
    }
  }

  if (error && !isTimeoutError(error)) {
    throw error;
  }

  if (isBiTotalsEmpty(payload)) {
    const clientStarted = Date.now();
    const clientPayload = await fetchBiFromMenuEvents(supabase, { branch: pBranch, hours: pHours });
    rpcTimingsMs += Date.now() - clientStarted;
    if (clientPayload && !isBiTotalsEmpty(clientPayload)) {
      payload = { ...clientPayload, data_source: "client_fallback" };
      partial = true;
      usedFallback = true;
      dataSource = "client_fallback";
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

  if (payload) {
    const sessionRes = await applySessionQualityPatch(supabase, {
      branch: pBranch,
      hours: pHours,
    }, payload);
    if (sessionRes.patched) {
      payload = sessionRes.payload;
      partial = true;
      usedFallback = true;
      opsNotes = appendOpsNote(opsNotes, sessionRes.opsNote);
    }
  }

  let normalized = normalizeBiDashboardPayload(payload, { hours: pHours });
  let menuDataEmpty = isBiTotalsEmpty(normalized);

  if (menuDataEmpty) {
    try {
      const { data: legacy, error: legacyErr } = await supabase.rpc("get_dashboard_aggregates");
      if (!legacyErr && legacy && !isBiTotalsEmpty(legacy)) {
        normalized = normalizeBiDashboardPayload(legacy, { hours: pHours });
        menuDataEmpty = false;
        partial = true;
        usedFallback = true;
        opsNotes = appendOpsNote(
          opsNotes,
          "Loaded from legacy get_dashboard_aggregates RPC.",
        );
      }
    } catch {
      /* optional legacy RPC */
    }
  }

  const liveFallback = dataSource === "client_fallback";

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
      opsNotes: [],
      dataSource: dataSource || "empty",
      error: null,
    };
  }

  const { userNote, opsNotes: noteOps } = partitionBiNotes(note, { partial, useRollup });
  const mergedOps = [...noteOps, ...opsNotes];

  const rangeMeta = hoursToRange(pHours);
  const sufficiency = assessMenuBiSufficiency(normalized, { id: rangeMeta });
  const hourlyBucketCounts = (normalized.by_hour || []).map((r) => Number(r.count) || 0);

  if (dataSource && !normalized.data_source) {
    normalized = { ...normalized, data_source: dataSource };
  }

  recordRpcRefresh({ dataSource });

  recordPipelineFetch({
    dataSource,
    primaryRpc,
    liveFallback,
    partial,
    rpcTimingsMs,
    totalEvents: normalized.total_events,
    totalSessions: normalized.total_sessions,
    aggregationNote: normalized.aggregation_note,
    sufficiency,
    hourlyBucketCounts,
    branch: pBranch,
    hours: pHours,
    primaryRpcEmpty,
    usedServerPatch: usedFallback,
    byHourRaw: payload?.by_hour,
    byHourNormalized: normalized.by_hour,
    chartRows: normalized.by_hour,
  });

  devLog("[fetchBiDashboard]", {
    phase: "done",
    events: normalized.total_events,
    sessions: normalized.total_sessions,
    liveFallback,
    dataSource,
    sessionQuality: normalized.session_quality,
  });

  return {
    data: normalized,
    partial,
    note: userNote,
    opsNotes: mergedOps,
    liveFallback,
    menuDataEmpty: false,
    dataSource,
    rpcTimingsMs,
    sufficiency,
    error: null,
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
