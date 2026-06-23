/**
 * Short-lived in-process cache for stable vault coverage metadata (Edge).
 */

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();

function buildKey(parts: Record<string, unknown>) {
  return [
    parts.branch || "network",
    parts.startDate || "",
    parts.endDate || "",
    parts.reportType || "",
    parts.slim ? "slim" : "full",
  ].join("|");
}

export function getCachedVaultCoverage(keyParts: Record<string, unknown>) {
  const key = buildKey(keyParts);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function setCachedVaultCoverage(keyParts: Record<string, unknown>, value: unknown) {
  cache.set(buildKey(keyParts), { value, expiresAt: Date.now() + TTL_MS });
}
