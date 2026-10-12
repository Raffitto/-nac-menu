import { cachedBranchLoad, createBranchQueryCache } from "./branchQueryCache";

test("a Khobar cache entry is not returned for Riyadh", async () => {
  const cache = createBranchQueryCache();
  await cachedBranchLoad(cache, "khobar", "ingredients", async () => ["milk"]);
  const riyadh = await cachedBranchLoad(cache, "riyadh", "ingredients", async () => ["flour"]);
  expect(riyadh.data).toEqual(["flour"]);
  expect(cache.peek("khobar", "ingredients").data).toEqual(["milk"]);
});

test("invalidation forces the next read to load again", async () => {
  const cache = createBranchQueryCache();
  let calls = 0;
  const loader = async () => {
    calls += 1;
    return calls;
  };
  const first = await cachedBranchLoad(cache, "khobar", "ingredients", loader, { ttlMs: 60000 });
  const second = await cachedBranchLoad(cache, "khobar", "ingredients", loader, { ttlMs: 60000 });
  expect(second.fromCache).toBe(true);
  expect(second.data).toBe(first.data);
  cache.invalidate("khobar", "ingredients");
  const third = await cachedBranchLoad(cache, "khobar", "ingredients", loader, { ttlMs: 60000 });
  expect(third.data).toBe(2);
  expect(calls).toBe(2);
});
