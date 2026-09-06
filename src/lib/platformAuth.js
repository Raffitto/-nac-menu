/**
 * NAC OS platform authentication helpers — session bootstrap, error copy, timeouts.
 * Does not replace Supabase Auth; wraps existing client behavior for production UX.
 */

import { supabase } from "./supabase";

const DEFAULT_SESSION_TIMEOUT_MS = 12_000;
export const AUTH_STORAGE_KEY = "nac-menu-supabase-auth";

export function isBrowserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** User-facing Supabase configuration message (no dev file paths in production). */
export function formatSupabaseSetupMessage() {
  if (process.env.NODE_ENV === "production") {
    return "Platform authentication is temporarily unavailable. Contact your NAC administrator.";
  }
  return "Add REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY to your local environment configuration.";
}

/** Map Supabase / network errors to executive-friendly copy. */
export function mapAuthError(raw) {
  if (isBrowserOffline()) {
    return "You appear to be offline. Reconnect and try again.";
  }
  const msg = String(raw || "").trim();
  const lower = msg.toLowerCase();
  if (!msg) return "Unable to sign in. Try again.";
  if (lower.includes("invalid login") || lower.includes("invalid credentials")) {
    return "Email or password is incorrect.";
  }
  if (lower.includes("email not confirmed")) {
    return "Confirm your email address before signing in.";
  }
  if (lower.includes("too many requests") || lower.includes("rate limit")) {
    return "Too many attempts. Wait a moment and try again.";
  }
  if (lower.includes("jwt expired") || lower.includes("session has expired")) {
    return "Your session expired. Sign in again.";
  }
  if (lower.includes("user not found")) {
    return "No account found for this email.";
  }
  if (
    lower.includes("fetch") ||
    lower.includes("network") ||
    lower.includes("failed to fetch") ||
    lower.includes("timeout")
  ) {
    return "Connection issue. Check your network and try again.";
  }
  return msg;
}

/**
 * Read the locally persisted Supabase session without a network round-trip.
 * A timeout on getSession is not proof this session is invalid.
 */
export function readPersistedAuthSession(storageKey = AUTH_STORAGE_KEY) {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const session = parsed?.currentSession && parsed.currentSession.access_token
      ? parsed.currentSession
      : parsed;
    if (!session?.access_token || !session?.user) return null;
    const expMs = Number(session.expires_at) > 1e12
      ? Number(session.expires_at)
      : Number(session.expires_at) * 1000;
    if (Number.isFinite(expMs) && expMs < Date.now() - 24 * 60 * 60 * 1000 && !session.refresh_token) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function withTimeout(promise, ms = DEFAULT_SESSION_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/** Validate REACT_APP_RBAC_USERS JSON without throwing at import time. */
export function validateRbacUsersEnv() {
  try {
    const raw = process.env.REACT_APP_RBAC_USERS;
    if (!raw || !String(raw).trim()) return { ok: true };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { ok: false, reason: "malformed" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

/**
 * Bootstrap session + subscribe to auth changes.
 * @param {(state: { session: object|null, checked: boolean, issue?: string|null }) => void} onChange
 * @returns {() => void} unsubscribe
 */
export function subscribePlatformSession(onChange) {
  if (!supabase) {
    onChange({ session: null, checked: true, issue: "not_configured" });
    return () => {};
  }

  let cancelled = false;
  const persisted = readPersistedAuthSession();
  const bootAt = typeof performance !== "undefined" ? performance.now() : 0;

  const emit = (session, extra = {}) => {
    if (cancelled) return;
    onChange({ session, checked: true, issue: null, ...extra });
  };

  if (persisted) {
    emit(persisted, { source: "persisted" });
  }

  (async () => {
    const started = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      const { data, error } = await withTimeout(supabase.auth.getSession());
      const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - started);
      if (typeof window !== "undefined") {
        window.__NAC_AUTH_BOOT__ = {
          persisted: Boolean(persisted),
          getSessionMs: ms,
          issue: error?.message || null,
          fromBootMs: Math.round((typeof performance !== "undefined" ? performance.now() : 0) - bootAt),
        };
      }
      if (cancelled) return;
      if (error) {
        if (persisted) {
          emit(persisted, { issue: "verification_degraded", source: "persisted" });
          return;
        }
        emit(null, { issue: mapAuthError(error.message) });
        return;
      }
      emit(data?.session ?? persisted ?? null, { source: "getSession" });
    } catch (e) {
      if (cancelled) return;
      const timedOut = e?.message === "timeout";
      if (persisted) {
        emit(persisted, {
          issue: timedOut ? "verification_degraded" : "verification_degraded",
          source: "persisted",
        });
        if (typeof window !== "undefined") {
          window.__NAC_AUTH_BOOT__ = {
            ...(window.__NAC_AUTH_BOOT__ || {}),
            persisted: true,
            getSessionMs: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - started),
            issue: timedOut ? "verification_degraded" : "session_failed",
          };
        }
        return;
      }
      emit(null, { issue: timedOut ? "session_timeout" : "session_failed" });
    }
  })();

  const authSub = supabase.auth.onAuthStateChange((event, nextSession) => {
    if (event === "SIGNED_OUT") {
      emit(null);
      return;
    }
    if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN" || event === "INITIAL_SESSION") {
      if (nextSession) {
        emit(nextSession, { source: event });
        return;
      }
      const keep = readPersistedAuthSession();
      if (keep) {
        emit(keep, { issue: "verification_degraded", source: "persisted" });
      }
    }
  });

  return () => {
    cancelled = true;
    authSub?.data?.subscription?.unsubscribe?.();
  };
}

export async function signOutPlatform() {
  if (!supabase) return;
  try {
    const { clearSessionIntelligenceCaches } = await import(
      "../dashboard/utils/intelligenceCache"
    );
    clearSessionIntelligenceCaches();
  } catch {
    /* cache clear is best-effort */
  }
  await supabase.auth.signOut();
}
