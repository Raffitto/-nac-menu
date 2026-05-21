/**
 * In-memory BI cache — faster tab switching, fewer duplicate RPCs.
 */

const store = new Map();

const DEFAULT_TTL_MS = 90 * 1000;

function entryValid(entry) {
  if (!entry) return false;
  return Date.now() < entry.expires;
}

export function cacheKey(parts = []) {
  return parts.filter(Boolean).join(":");
}

export function getCachedIntelligence(key, loader, ttlMs = DEFAULT_TTL_MS) {
  const hit = store.get(key);
  if (entryValid(hit)) {
    return Promise.resolve(hit.data);
  }
  if (hit?.promise) {
    return hit.promise;
  }

  const promise = Promise.resolve()
    .then(() => loader())
    .then((data) => {
      store.set(key, {
        data,
        expires: Date.now() + ttlMs,
        promise: null,
      });
      return data;
    })
    .catch((err) => {
      store.delete(key);
      throw err;
    });

  store.set(key, { data: null, expires: 0, promise });
  return promise;
}

export function peekCachedIntelligence(key) {
  const hit = store.get(key);
  return entryValid(hit) ? hit.data : null;
}

export function setCachedIntelligence(key, data, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, {
    data,
    expires: Date.now() + ttlMs,
    promise: null,
  });
}

export function invalidateIntelligenceCache(prefix = "") {
  if (!prefix) {
    store.clear();
    return;
  }
  [...store.keys()].forEach((k) => {
    if (k.startsWith(prefix)) store.delete(k);
  });
}
