/**
 * Bounded client performance buffer for primary OS views.
 * No payload contents. Admin/devtools only: window.__NAC_VIEW_PERF__
 */

const MAX_EVENTS = 40;
const SLOW_MS = 3000;
const SEVERE_MS = 10000;

function store() {
  if (typeof window === "undefined") return null;
  if (!window.__NAC_VIEW_PERF__) {
    window.__NAC_VIEW_PERF__ = { events: [], slow: [], severe: [] };
  }
  return window.__NAC_VIEW_PERF__;
}

export function recordViewPerf({
  view,
  branch = null,
  firstUsefulMs = null,
  coreSettleMs = null,
  slowestRequestName = null,
  slowestRequestMs = null,
  slowestInternalMs = null,
  timeoutCount = 0,
  errorCount = 0,
  timeout = false,
  failed = false,
} = {}) {
  const buf = store();
  if (!buf) return null;
  const event = {
    view,
    branch,
    navigationAt: new Date().toISOString(),
    firstUsefulMs,
    coreSettleMs,
    slowestRequestName: slowestRequestName || null,
    slowestRequestMs: slowestRequestMs != null ? slowestRequestMs : slowestInternalMs,
    timeoutCount: Number(timeoutCount) || (timeout ? 1 : 0),
    errorCount: Number(errorCount) || (failed ? 1 : 0),
  };
  buf.events = [event, ...buf.events].slice(0, MAX_EVENTS);
  const worst = Math.max(firstUsefulMs || 0, coreSettleMs || 0, event.slowestRequestMs || 0);
  if (worst >= SEVERE_MS || event.timeoutCount > 0) buf.severe = [event, ...buf.severe].slice(0, 12);
  else if (worst >= SLOW_MS) buf.slow = [event, ...buf.slow].slice(0, 12);
  return event;
}

export function recentViewPerf() {
  return store();
}

export function exportViewPerfJson() {
  const buf = store();
  return JSON.stringify(buf || { events: [], slow: [], severe: [] }, null, 2);
}
