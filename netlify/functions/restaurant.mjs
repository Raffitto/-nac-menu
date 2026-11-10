import { handleWebRequest } from "../../scripts/local-restaurant/server.mjs";

function setting(name) {
  const env = globalThis.Netlify?.env;
  const value = env?.get?.(name) || process.env[name] || "";
  return String(value);
}

function closed(status, reason) {
  return Response.json({
    ok: false,
    reason,
    production: false,
    restaurantPilot: false,
    guestOrdering: false,
    guestPayments: false,
    paymentCaptured: false,
  }, { status });
}

export default async (req) => {
  const databaseUrl = setting("RESTAURANT_DATABASE_URL");
  const supabaseUrl = setting("SUPABASE_URL");
  const anonKey = setting("SUPABASE_ANON_KEY");
  if (!databaseUrl || !supabaseUrl || !anonKey) return closed(503, "service_unavailable");
  process.env.RESTAURANT_AUTH_MODE = "supabase";
  process.env.RESTAURANT_DATABASE_URL = databaseUrl;
  process.env.SUPABASE_URL = supabaseUrl;
  process.env.SUPABASE_ANON_KEY = anonKey;
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve(closed(503, "timeout")), 20000);
  });
  try {
    return await Promise.race([handleWebRequest(req), timeout]);
  } catch {
    return closed(503, "service_unavailable");
  }
};

export const config = {
  path: ["/api/restaurant", "/api/restaurant/*"],
};
