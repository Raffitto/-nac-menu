import { createClient } from "@supabase/supabase-js";
import { fetchWithDeadline } from "./fetchDeadline";

/**
 * Safari does not reliably abort navigator.locks.request, so a stuck tab can
 * hold lock:nac-menu-supabase-auth and every later query waits forever.
 * Promise.race is independent of AbortSignal.
 */
async function nacAuthLock(name, acquireTimeout, fn) {
  if (typeof navigator === "undefined" || !navigator.locks?.request) return fn();
  const timeoutMs = Math.min(Math.max(Number(acquireTimeout) || 4000, 2000), 6000);
  let timer;
  try {
    return await Promise.race([
      navigator.locks.request(name, () => fn()),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(Object.assign(new Error("Auth lock timed out"), { code: "NAC_LOCK_TIMEOUT" }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const url = process.env.REACT_APP_SUPABASE_URL;
const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  // eslint-disable-next-line no-console
  console.info("[supabase]", url ? "configured" : "missing REACT_APP_SUPABASE_URL");
}

/**
 * Single browser client: anonymous guests (no sign-in) use the anon JWT for inserts.
 * Staff open Analytics, sign in with Supabase Auth (authenticated JWT) for SELECT on menu_events.
 * Session is persisted so the analytics dashboard stays signed in across refresh.
 */
export const supabase =
  url && anonKey
    ? createClient(url, anonKey, {
        global: { fetch: fetchWithDeadline },
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: "nac-menu-supabase-auth",
          lock: nacAuthLock,
        },
      })
    : null;

export function isSupabaseConfigured() {
  return Boolean(supabase);
}
