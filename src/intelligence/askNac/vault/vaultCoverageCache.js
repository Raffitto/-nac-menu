/**
 * Short-lived in-process cache for stable vault coverage metadata.
 * Reduces repeated ask_nac_data_coverage scans within a session.
 */

const TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function buildKey({ branch, startDate, endDate, reportType, slim }) {
  return [
    branch || "network",
    startDate || "",
    endDate || "",
    reportType || "",
    slim ? "slim" : "full",
  ].join("|");
}

export function getCachedVaultCoverage(keyParts) {
  const key = buildKey(keyParts);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function setCachedVaultCoverage(keyParts, value) {
  const key = buildKey(keyParts);
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
}

export function clearVaultCoverageCache() {
  cache.clear();
}

/** @internal test helper */
export function vaultCoverageCacheSize() {
  return cache.size;
}
