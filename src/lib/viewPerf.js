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
  slowestInternalMs = null,
  timeout = false,
  failed = false,
} = {}) {
  const buf = store();
  if (!buf) return null;
  const event = {
    at: new Date().toISOString(),
    view,
    branch,
    firstUsefulMs,
    coreSettleMs,
    slowestInternalMs,
    timeout: Boolean(timeout),
    failed: Boolean(failed),
  };
  buf.events = [event, ...buf.events].slice(0, MAX_EVENTS);
  const worst = Math.max(firstUsefulMs || 0, coreSettleMs || 0, slowestInternalMs || 0);
  if (worst >= SEVERE_MS || timeout) buf.severe = [event, ...buf.severe].slice(0, 12);
  else if (worst >= SLOW_MS) buf.slow = [event, ...buf.slow].slice(0, 12);
  return event;
}

export function recentViewPerf() {
  return store();
}
