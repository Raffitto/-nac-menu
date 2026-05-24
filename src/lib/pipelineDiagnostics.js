/**
 * BI pipeline diagnostics — dev + window.NAC_DEBUG.
 */

import { getMenuTrackingDiagnostics } from "./menuTrackingDiagnostics";
import { isNacDebugEnabled } from "./nacDebug";
import { getTruthValidation } from "./truthValidationRegistry";
import { buildHourlyDebugPayload } from "../dashboard/utils/hourlyPipeline";

const MAX_FETCH_HISTORY = 5;

let lastFetch = null;
const fetchHistory = [];

function shouldExpose() {
  return (
    isNacDebugEnabled() ||
    process.env.NODE_ENV === "development" ||
    process.env.REACT_APP_MENU_TRACK_DEBUG === "1"
  );
}

export function recordPipelineFetch(meta = {}) {
  const hourlyDebug =
    meta.hourlyDebug ||
    (meta.byHourRaw || meta.byHourNormalized
      ? buildHourlyDebugPayload({
          hours: meta.hours,
          selectedRange: meta.selectedRange,
          branch: meta.branch,
          source: meta.dataSource || meta.primaryRpc,
          byHourRaw: meta.byHourRaw,
          byHourNormalized: meta.byHourNormalized,
          chartRows: meta.chartRows,
        })
      : null);

  const entry = {
    ...(lastFetch || {}),
    at: new Date().toISOString(),
    ...meta,
    hourlyDebug,
  };
  lastFetch = entry;
  fetchHistory.unshift(entry);
  if (fetchHistory.length > MAX_FETCH_HISTORY) fetchHistory.length = MAX_FETCH_HISTORY;

  if (shouldExpose()) {
    const diagnostics = getPipelineDiagnostics();
    window.__NAC_PIPELINE_DEBUG__ = diagnostics;
    if (hourlyDebug) {
      window.__NAC_PIPELINE_DEBUG__.hourly = hourlyDebug;
    }
    if (isNacDebugEnabled()) {
      // eslint-disable-next-line no-console
      console.info("[NAC pipeline]", entry);
    }
  }
}

export function getPipelineDiagnostics() {
  const tracking = getMenuTrackingDiagnostics();
  const hourlyBuckets = (lastFetch?.hourlyBucketCounts || []).filter((c) => c > 0).length;

  return {
    lastFetch,
    fetchHistory: [...fetchHistory],
    tracking: {
      ok: tracking.ok,
      fail: tracking.fail,
      by_event_type: tracking.by_event_type || {},
      recent_events: tracking.recent_events || [],
      hourly_distribution: tracking.hourly_distribution || {},
      branch_distribution: tracking.branch_distribution || {},
    },
    rollupVsFallback: {
      dataSource: lastFetch?.dataSource || null,
      primaryRpc: lastFetch?.primaryRpc || null,
      liveFallback: Boolean(lastFetch?.liveFallback),
      aggregationNote: lastFetch?.aggregationNote || null,
    },
    rpcTimingsMs: lastFetch?.rpcTimingsMs || null,
    platformStatus: lastFetch?.platformStatus || null,
    sufficiency: lastFetch?.sufficiency || null,
    hourlyPopulatedBuckets: hourlyBuckets,
    hourly: lastFetch?.hourlyDebug || null,
    truthValidation: getTruthValidation(),
  };
}

export function clearPipelineDiagnostics() {
  lastFetch = null;
  fetchHistory.length = 0;
  if (typeof window !== "undefined") {
    delete window.__NAC_PIPELINE_DEBUG__;
  }
}
