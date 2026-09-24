import { createClient } from "@supabase/supabase-js";
import { nacAuthLock } from "./authLock";
import { fetchWithDeadline } from "./fetchDeadline";

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
