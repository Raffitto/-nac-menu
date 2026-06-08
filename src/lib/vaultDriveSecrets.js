/**
 * Client-side Drive API response sanitization.
 * Never surface OAuth tokens in UI, console, or stored state.
 */

const SENSITIVE_KEYS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "authorization",
  "client_secret",
  "token",
]);

export function maskToken(value) {
  if (!value || typeof value !== "string") return "[redacted]";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

export function stripSensitiveFields(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripSensitiveFields);
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
    out[key] = stripSensitiveFields(value);
  }
  return out;
}

export function sanitizeDriveApiResponse(data) {
  return stripSensitiveFields(data);
}
