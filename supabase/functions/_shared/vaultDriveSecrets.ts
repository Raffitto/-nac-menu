/**
 * Drive OAuth secret handling — never log or return raw tokens.
 * Future edits: keep tokens server-side only; use these helpers for errors and diagnostics.
 */

const SENSITIVE_KEYS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "authorization",
  "client_secret",
  "token",
]);

/** Mask a token for rare diagnostics (e.g. gho_****1234). Never use in API responses. */
export function maskToken(value: string | null | undefined): string {
  if (!value || typeof value !== "string") return "[redacted]";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

/** Strip token-like substrings from user-facing error messages. */
export function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || "Drive sync failed");
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/ya29\.[A-Za-z0-9._-]+/gi, "[google_access_token]")
    .replace(/1\/[A-Za-z0-9._-]+/gi, "[google_refresh_token]")
    .replace(/access_token[=:]\s*\S+/gi, "access_token=[redacted]")
    .replace(/refresh_token[=:]\s*\S+/gi, "refresh_token=[redacted]")
    .slice(0, 240);
}

/** Remove credential fields from plain objects before logging or returning. */
export function stripSensitiveFields<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = stripSensitiveFields(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out as Partial<T>;
}
