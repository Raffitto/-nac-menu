/**
 * NAC OS platform authentication helpers — session bootstrap, error copy, timeouts.
 * Does not replace Supabase Auth; wraps existing client behavior for production UX.
 */

import { supabase } from "./supabase";

const DEFAULT_SESSION_TIMEOUT_MS = 12_000;

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

  const emit = (session, extra = {}) => {
    if (cancelled) return;
    onChange({ session, checked: true, issue: null, ...extra });
  };

  (async () => {
    try {
      const { data, error } = await withTimeout(supabase.auth.getSession());
      if (cancelled) return;
      if (error) {
        emit(null, { issue: mapAuthError(error.message) });
        return;
      }
      emit(data?.session ?? null);
    } catch (e) {
      if (cancelled) return;
      const issue = e?.message === "timeout" ? "session_timeout" : "session_failed";
      emit(null, { issue });
    }
  })();

  const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      emit(null);
      return;
    }
    if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN" || event === "INITIAL_SESSION") {
      emit(session);
    }
  });

  return () => {
    cancelled = true;
    sub.subscription.unsubscribe();
  };
}

export async function signOutPlatform() {
  if (!supabase) return;
  await supabase.auth.signOut();
}
