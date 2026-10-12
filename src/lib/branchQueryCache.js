/**
 * Branch-scoped stale-while-revalidate cache.
 * A key from one branch is never returned for another branch.
 */
export function createBranchQueryCache() {
  const rows = new Map();

  function storageKey(branchId, name) {
    return `${branchId || "none"}::${name}`;
  }

  return {
    peek(branchId, name) {
      const row = rows.get(storageKey(branchId, name));
      if (!row || row.branchId !== branchId) return null;
      return row;
    },
    put(branchId, name, data) {
      const row = { branchId, data, updatedAt: Date.now() };
      rows.set(storageKey(branchId, name), row);
      return row;
    },
    invalidate(branchId, name) {
      if (name) rows.delete(storageKey(branchId, name));
      else {
        for (const key of rows.keys()) {
          if (key.startsWith(`${branchId || "none"}::`)) rows.delete(key);
        }
      }
    },
  };
}

export const inventoryQueryCache = createBranchQueryCache();

export async function cachedBranchLoad(cache, branchId, name, loader, { ttlMs = 20000 } = {}) {
  const hit = cache.peek(branchId, name);
  const fresh = hit && Date.now() - hit.updatedAt < ttlMs;
  if (fresh) return { data: hit.data, updatedAt: hit.updatedAt, fromCache: true, refreshing: false };
  if (hit) {
    loader().then((data) => cache.put(branchId, name, data)).catch(() => {});
    return { data: hit.data, updatedAt: hit.updatedAt, fromCache: true, refreshing: true };
  }
  const data = await loader();
  const row = cache.put(branchId, name, data);
  return { data, updatedAt: row.updatedAt, fromCache: false, refreshing: false };
}
