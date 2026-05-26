/**
 * Supabase Auth password recovery — redirect URLs and session hydration.
 * RBAC is email-based only; password reset does not change roles or branch scope.
 */

import { supabase } from "./supabase";

const DEFAULT_LOCAL_RESET = "http://localhost:3000/reset-password";

/** Canonical production reset page — must match Supabase Auth → Redirect URLs. */
export const PRODUCTION_PASSWORD_RESET_URL = "https://nac-os.netlify.app/reset-password";

/** Production Netlify sites that should be allowlisted in Supabase Auth → URL Configuration. */
export const SUPABASE_AUTH_REDIRECT_ALLOWLIST = [
  "http://localhost:3000/reset-password",
  "http://127.0.0.1:3000/reset-password",
  PRODUCTION_PASSWORD_RESET_URL,
  "https://nacmenu.netlify.app/reset-password",
  "https://nac-khobar-reviews.netlify.app/reset-password",
  "https://nacriyadh.netlify.app/reset-password",
  "https://nac-jeddah.netlify.app/reset-password",
  "https://nacos.netlify.app/reset-password",
];

function isLocalDevOrigin(origin = "") {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(String(origin).trim());
}

export function getPasswordResetRedirectUrl() {
  const explicit = process.env.REACT_APP_AUTH_RESET_URL;
  if (explicit && String(explicit).trim()) {
    return String(explicit).trim().replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    const origin = window.location.origin.replace(/\/$/, "");
    if (isLocalDevOrigin(origin)) {
      return `${origin}/reset-password`;
    }
    return PRODUCTION_PASSWORD_RESET_URL;
  }
  return process.env.NODE_ENV === "development" ? DEFAULT_LOCAL_RESET : PRODUCTION_PASSWORD_RESET_URL;
}

export async function requestPasswordResetEmail(supabase, email) {
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured." };
  }
  const trimmed = String(email || "").trim().toLowerCase();
  if (!trimmed) {
    return { ok: false, error: "Enter your email address." };
  }
  const redirectTo = getPasswordResetRedirectUrl();
  const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
    redirectTo,
  });
  if (error) {
    return { ok: false, error: error.message || "Could not send reset email." };
  }
  return { ok: true };
}

/** Forgot-password UI entry — logs result for debugging submit flow. */
export async function sendPasswordRecovery(email) {
  const trimmed = String(email || "").trim().toLowerCase();
  console.log("Sending reset email to:", trimmed);
  const result = await requestPasswordResetEmail(supabase, trimmed);
  console.log("Password reset result:", result);
  return result;
}

export async function hydrateRecoverySession(supabase) {
  if (!supabase) {
    return { ok: false, reason: "no_client" };
  }

  try {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        window.history.replaceState({}, document.title, url.pathname);
        return { ok: true, mode: "recovery" };
      }
      return { ok: false, reason: "exchange_failed", error: error.message };
    }

    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash);
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      const type = params.get("type");
      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (!error) {
          window.history.replaceState({}, document.title, window.location.pathname);
          return { ok: true, mode: type || "recovery" };
        }
        return { ok: false, reason: "session_failed", error: error.message };
      }
    }

    const { data, error } = await supabase.auth.getSession();
    if (error) {
      return { ok: false, reason: "session_failed", error: error.message };
    }
    if (data.session) {
      return { ok: true, mode: "session" };
    }
    return { ok: false, reason: "missing_recovery" };
  } catch (e) {
    return { ok: false, reason: "unexpected", error: e?.message || "Recovery link invalid." };
  }
}

export async function updatePasswordFromRecovery(supabase, password) {
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured." };
  }
  const next = String(password || "");
  if (next.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    return { ok: false, error: error.message || "Could not update password." };
  }
  return { ok: true };
}

export function passwordsMatch(password, confirm) {
  return String(password || "") === String(confirm || "") && String(password || "").length > 0;
}
