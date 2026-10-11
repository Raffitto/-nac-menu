/**
 * Internal (non-user) authorization helpers for Edge Functions deployed with verify_jwt = false.
 * Pure functions: no network, no Supabase client. Never decode or trust unverified JWT claims here.
 */

const encoder = new TextEncoder();

/** Constant-time string equality (length-independent: compares SHA-256 digests). */
export async function timingSafeEqualString(a: string, b: string): Promise<boolean> {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

export function extractBearer(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const match = String(authHeader).match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token ? token : null;
}

export type InternalAuthEnv = {
  serviceRoleKey?: string | null;
  scheduledSecret?: string | null;
};

export type InternalAuthResult =
  | { ok: true; via: "service_role_key" | "scheduled_secret" }
  | { ok: false; reason: "missing_token" | "not_configured" | "invalid_token" };

/**
 * Authorize an internal caller. Accepts ONLY an exact match (constant-time) against the configured
 * service-role key or the scheduled-ingest secret. JWT payloads are never decoded.
 */
export async function authorizeInternalCaller(
  authHeader: string | null | undefined,
  env: InternalAuthEnv,
  allow: { serviceRoleKey?: boolean; scheduledSecret?: boolean } = { serviceRoleKey: true, scheduledSecret: true },
): Promise<InternalAuthResult> {
  const token = extractBearer(authHeader);
  if (!token) return { ok: false, reason: "missing_token" };
  const serviceRoleKey = String(env.serviceRoleKey || "").trim();
  const scheduledSecret = String(env.scheduledSecret || "").trim();
  if ((!allow.serviceRoleKey || !serviceRoleKey) && (!allow.scheduledSecret || !scheduledSecret)) {
    return { ok: false, reason: "not_configured" };
  }
  // Evaluate both comparisons unconditionally so timing does not reveal which secret matched.
  const srMatch = allow.serviceRoleKey && serviceRoleKey ? await timingSafeEqualString(token, serviceRoleKey) : false;
  const schedMatch = allow.scheduledSecret && scheduledSecret ? await timingSafeEqualString(token, scheduledSecret) : false;
  if (srMatch) return { ok: true, via: "service_role_key" };
  if (schedMatch) return { ok: true, via: "scheduled_secret" };
  return { ok: false, reason: "invalid_token" };
}
