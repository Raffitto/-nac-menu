import { dedupeInflight } from "./requestDedupe";
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
import { isMonthRangeHours } from "./mtdHybridMerge";
import { hoursToRange } from "../dashboard/utils/rangeState";

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

async function rpcBiDashboard(supabase, rpcName, params, { softTimeoutMs = 0 } = {}) {
  const rpcPromise = supabase.rpc(rpcName, params).then(({ data, error }) => {
    if (error) return { payload: null, error };
    const payload = normalizeRpcPayload(data);
    if (!payload || typeof payload !== "object") return { payload: null, error: null };
    return { payload, error: null };
  });

  if (!(Number(softTimeoutMs) > 0)) {
    return rpcPromise;
  }

  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          payload: null,
          error: {
            message: "statement timeout",
            code: "57014",
            softTimeout: true,
          },
        }),
      softTimeoutMs,
    );
  });

  try {
    return await Promise.race([rpcPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Today BI RPC often scans raw menu_events for ~8s then statement-timeouts. Fail soft sooner. */
export const BI_TODAY_SOFT_TIMEOUT_MS = 2200;

/**
 * BI dashboard with rollup routing, false-zero fallbacks, and client menu_events aggregation.
 * @returns {{ data, partial, note, liveFallback, menuDataEmpty }}
 */
export async function fetchBiDashboard(
  supabase,
  { branch = null, hours = 24, softTimeoutMs, deferClientPatches = false, skipLiveBi = false, forceLiveBi = false } = {},
) {
  const pHours = Number(hours) || 24;
  const pBranch = normalizeBranchForRpc(branch);
  const dedupeKey = [
    "bi",
    pBranch || "all",
    pHours,
    forceLiveBi ? "live" : "rollup",
    deferClientPatches ? "defer" : "full",
  ].join(":");

  return dedupeInflight(dedupeKey, () =>
    fetchBiDashboardOnce(supabase, {
      branch: pBranch,
      hours: pHours,
      softTimeoutMs,
      deferClientPatches,
      skipLiveBi,
      forceLiveBi,
    }),
  );
}

async function fetchBiDashboardOnce(
  supabase,
  { branch = null, hours = 24, softTimeoutMs, deferClientPatches = false, skipLiveBi = false, forceLiveBi = false } = {},
) {
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
  const pBranch = branch;
  const params = { p_branch: pBranch, p_hours: pHours };
  // Emergency recovery: raw get_bi_dashboard statement-timeouts at 8s.
  // Ordinary loads stay on the rollup, including Refresh. Stale rollup is shown as-is.
  void skipLiveBi;
  void forceLiveBi;
  const useRollup = true;
  const primaryRpc = "get_bi_dashboard_from_rollup";
  if (typeof window !== "undefined") {
    window.__NAC_OVERVIEW_PERF__ = {
      ...(window.__NAC_OVERVIEW_PERF__ || {}),
      liveBiCalled: false,
    };
  }
  const resolvedSoftTimeout = softTimeoutMs != null ? softTimeoutMs : 8000;

  devLog("[fetchBiDashboard]", {
    phase: "rpc_start",
    rpc: primaryRpc,
    params,
    useRollup,
    softTimeoutMs: resolvedSoftTimeout,
  });

  const rpcStarted = Date.now();
  let { payload, error } = await rpcBiDashboard(supabase, primaryRpc, params, {
    softTimeoutMs: resolvedSoftTimeout,
  });
  let rpcTimingsMs = Date.now() - rpcStarted;
  const primaryRpcEmpty = isBiTotalsEmpty(payload);

  let partial = Boolean(payload?.partial_mode);
  let note = payload?.aggregation_note || null;
  let opsNotes = [];
  let usedFallback = false;
  let dataSource = primaryRpcEmpty
    ? null
    : primaryRpc === "get_bi_dashboard_from_rollup"
      ? "rollup"
      : "rpc";

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
  } else if (
    error &&
    isTimeoutError(error) &&
    !useRollup &&
    primaryRpc !== "get_bi_dashboard_from_rollup"
  ) {
    const rollupStarted = Date.now();
    const rollupRes = await rpcBiDashboard(supabase, "get_bi_dashboard_from_rollup", params, {
      softTimeoutMs: 8000,
    });
    rpcTimingsMs += Date.now() - rollupStarted;
    if (rollupRes.payload && !isBiTotalsEmpty(rollupRes.payload)) {
      payload = rollupRes.payload;
      partial = true;
      usedFallback = true;
      dataSource = "rollup";
      note = error?.softTimeout
        ? "Loaded from daily rollup (live BI slow). Item-level charts may be limited."
        : "Loaded from daily rollup after timeout. Item-level charts may be limited.";
      error = null;
    }
  }

  if (error && isTimeoutError(error) && isBiTotalsEmpty(payload)) {
    throw Object.assign(new Error(error.message || "Operational data timed out"), {
      code: error.code || "57014",
      softTimeout: Boolean(error.softTimeout),
    });
  }

  if (error && !isTimeoutError(error)) {
    throw error;
  }

  // Client menu_events scans are Tier-2 emergency only — forceLiveBi required.
  // Ordinary interactive loads must stay on rollup (never approach 8s statement timeout).
  if (forceLiveBi && !deferClientPatches && isBiTotalsEmpty(payload)) {
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

  if (forceLiveBi && !deferClientPatches && payload && biTopItemsNeedsRefresh(payload)) {
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

  if (forceLiveBi && !deferClientPatches && payload) {
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

function mapBranchComparisonRows(data) {
  return buildCanonicalBranchComparison(
    (Array.isArray(data) ? data : []).map((row) => ({
      branch_id: normalizeBranchId(row.branch_id),
      sessions: Number(row.sessions) || 0,
      impressions: Number(row.impressions) || 0,
      opens: Number(row.opens) || 0,
      unique_visitors: Number(row.unique_visitors) || 0,
    })),
    { sessions: 0, impressions: 0, opens: 0, unique_visitors: 0 },
  );
}

/**
 * Branch comparison. Always the rollup — live get_branch_comparison scans menu_events and hits the 8s timeout.
 */
export async function fetchBranchComparisonSafe(supabase, hours = 24) {
  if (!supabase) return { data: [], partial: false, note: null };

  const pHours = Number(hours) || 24;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(
      () => resolve({ data: null, error: { message: "statement timeout", code: "57014" } }),
      8000,
    );
  });
  const { data, error } = await Promise.race([
    supabase.rpc("get_branch_comparison_from_rollup", { p_hours: pHours }),
    timeout,
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });

  if (!error) {
    return { data: mapBranchComparisonRows(data), partial: false, note: null };
  }

  if (isTimeoutError(error)) {
    return { data: [], partial: true, note: "Branch comparison timed out." };
  }

  throw error;
}

/**
 * Server-side review_events aggregates — avoids 5k row client scans.
 */
async function withSoftTimeout(promise, ms, fallback) {
  if (!(Number(ms) > 0)) return promise;
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchReviewEventsSummary(supabase, { branch = null, hours = 24 } = {}) {
  if (!supabase) return null;
  const pBranch = normalizeBranchForRpc(branch);
  const pHours = Number(hours) || 24;
  return dedupeInflight(`review-summary:${pBranch || "all"}:${pHours}`, () =>
    fetchReviewEventsSummaryOnce(supabase, { pBranch, pHours }),
  );
}

async function fetchReviewEventsSummaryOnce(supabase, { pBranch, pHours }) {

  const { data, error } = await withSoftTimeout(
    supabase.rpc("get_review_events_summary", {
      p_branch: pBranch,
      p_hours: pHours,
    }),
    10000,
    { data: null, error: { message: "statement timeout", code: "57014", softTimeout: true } },
  );

  if (error && isTimeoutError(error) && pHours > 24) {
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
