import { getBusinessDayRange } from "../dashboard/utils/businessDay";
import { hourInRiyadh } from "../dashboard/utils/hourlyBucketLabels";
import { isNacDebugEnabled } from "./nacDebug";
import { recordClientTrackAt } from "../platform/engines/dataFreshnessEngine";

const STORAGE_KEY = "nac_menu_track_diag_v2";
const MAX_LAST_ERRORS = 8;
const MAX_RECENT_EVENTS = 20;

function readState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    return {
      ok: Number(parsed.ok) || 0,
      fail: Number(parsed.fail) || 0,
      lastOk: parsed.lastOk || null,
      errors: Array.isArray(parsed.errors) ? parsed.errors : [],
      by_event_type:
        parsed.by_event_type && typeof parsed.by_event_type === "object"
          ? parsed.by_event_type
          : {},
      recent_events: Array.isArray(parsed.recent_events) ? parsed.recent_events : [],
    };
  } catch {
    return emptyState();
  }
}

function emptyState() {
  return {
    ok: 0,
    fail: 0,
    lastOk: null,
    errors: [],
    by_event_type: {},
    recent_events: [],
  };
}

function writeState(state) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota */
  }
}

function pushRecentEvent(state, eventType, branchId) {
  const at = new Date().toISOString();
  state.recent_events = [
    { event_type: eventType, branch_id: branchId || null, at },
    ...(state.recent_events || []),
  ].slice(0, MAX_RECENT_EVENTS);
  const key = String(eventType || "unknown");
  state.by_event_type = state.by_event_type || {};
  state.by_event_type[key] = (Number(state.by_event_type[key]) || 0) + 1;
}

function buildDistributions(recentEvents = []) {
  const hourly_distribution = {};
  const branch_distribution = {};
  for (const ev of recentEvents) {
    const h = hourInRiyadh(ev.at);
    if (h != null) hourly_distribution[h] = (hourly_distribution[h] || 0) + 1;
    const b = ev.branch_id || "unknown";
    branch_distribution[b] = (branch_distribution[b] || 0) + 1;
  }
  return { hourly_distribution, branch_distribution };
}

/** Production-safe counters (sessionStorage). Inspect in DevTools → Application. */
export function recordMenuTrackSuccess(eventType, branchId) {
  const state = readState();
  state.ok += 1;
  state.lastOk = { event_type: eventType, at: new Date().toISOString() };
  pushRecentEvent(state, eventType, branchId);
  writeState(state);
  recordClientTrackAt(state.lastOk?.at);
  if (typeof window !== "undefined") {
    window.__NAC_MENU_TRACK_DIAG__ = getMenuTrackingDiagnostics();
  }
  if (
    process.env.NODE_ENV === "development" ||
    isNacDebugEnabled() ||
    process.env.REACT_APP_MENU_TRACK_DEBUG === "1"
  ) {
    const { hourly_distribution, branch_distribution } = buildDistributions(state.recent_events);
    // eslint-disable-next-line no-console
    console.info("[menu_events track]", {
      event_type: eventType,
      counts_by_type: state.by_event_type,
      hourly_distribution,
      branch_distribution,
    });
  }
}

export function recordMenuTrackFailure(eventType, error) {
  const state = readState();
  state.fail += 1;
  const entry = {
    event_type: eventType,
    at: new Date().toISOString(),
    code: error?.code || null,
    message: error?.message || String(error || "unknown"),
    details: error?.details || null,
    hint: error?.hint || null,
  };
  state.errors = [entry, ...state.errors].slice(0, MAX_LAST_ERRORS);
  writeState(state);
  if (typeof window !== "undefined") {
    window.__NAC_MENU_TRACK_DIAG__ = getMenuTrackingDiagnostics();
  }

  if (
    process.env.NODE_ENV === "development" ||
    process.env.REACT_APP_MENU_TRACK_DEBUG === "1"
  ) {
    // eslint-disable-next-line no-console
    console.warn("[menu_events] insert FAILED", entry);
  }
}

export function getMenuTrackingDiagnostics() {
  const state = readState();
  const { hourly_distribution, branch_distribution } = buildDistributions(state.recent_events);
  return {
    ...state,
    hourly_distribution,
    branch_distribution,
    configured: Boolean(process.env.REACT_APP_SUPABASE_URL && process.env.REACT_APP_SUPABASE_ANON_KEY),
    business_day: getBusinessDayRange(),
  };
}

export function clearMenuTrackingDiagnostics() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
  if (typeof window !== "undefined") {
    delete window.__NAC_MENU_TRACK_DIAG__;
  }
}
