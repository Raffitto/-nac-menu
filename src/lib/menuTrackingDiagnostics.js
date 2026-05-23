import { getBusinessDayRange } from "../dashboard/utils/businessDay";

const STORAGE_KEY = "nac_menu_track_diag_v1";
const MAX_LAST_ERRORS = 8;

function readState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { ok: 0, fail: 0, lastOk: null, errors: [] };
    const parsed = JSON.parse(raw);
    return {
      ok: Number(parsed.ok) || 0,
      fail: Number(parsed.fail) || 0,
      lastOk: parsed.lastOk || null,
      errors: Array.isArray(parsed.errors) ? parsed.errors : [],
    };
  } catch {
    return { ok: 0, fail: 0, lastOk: null, errors: [] };
  }
}

function writeState(state) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota */
  }
}

/** Production-safe counters (sessionStorage). Inspect in DevTools → Application. */
export function recordMenuTrackSuccess(eventType) {
  const state = readState();
  state.ok += 1;
  state.lastOk = { event_type: eventType, at: new Date().toISOString() };
  writeState(state);
  if (typeof window !== "undefined") {
    window.__NAC_MENU_TRACK_DIAG__ = getMenuTrackingDiagnostics();
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
  return {
    ...state,
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
