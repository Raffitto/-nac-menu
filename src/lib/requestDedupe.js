/**
 * Shared request coalescing for identical in-flight Supabase RPC/loaders.
 * Superseded generations should not apply results (callers bump gen).
 */

const inflight = new Map();

export function dedupeInflight(key, loader) {
  if (!key) return Promise.resolve().then(() => loader());
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = Promise.resolve()
    .then(() => loader())
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

export function clearInflight(prefix = "") {
  if (!prefix) {
    inflight.clear();
    return;
  }
  [...inflight.keys()].forEach((k) => {
    if (k.startsWith(prefix)) inflight.delete(k);
  });
}

export function inflightSize() {
  return inflight.size;
}
