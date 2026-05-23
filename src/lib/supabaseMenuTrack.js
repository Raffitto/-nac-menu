import { createClient } from "@supabase/supabase-js";

const url = process.env.REACT_APP_SUPABASE_URL;
const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

/**
 * Public menu tracking client — always uses the anon JWT.
 * Does NOT persist dashboard Auth sessions (separate from nac-menu-supabase-auth).
 * Use only for menu_events INSERT from the guest menu.
 */
export const supabaseMenuTrack =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      })
    : null;

export function isMenuTrackConfigured() {
  return Boolean(supabaseMenuTrack);
}
