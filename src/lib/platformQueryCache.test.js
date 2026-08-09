import {
  cacheKey,
  clearSessionIntelligenceCaches,
  getCachedIntelligence,
  invalidateIntelligenceCache,
  peekCachedIntelligence,
  setCachedIntelligence,
  swrIntelligence,
} from "../dashboard/utils/intelligenceCache";

describe("platform intelligence cache / SWR", () => {
  beforeEach(() => {
    clearSessionIntelligenceCaches();
  });

  test("peek and set round-trip", () => {
    setCachedIntelligence("menu-bi:network:24", { ok: true }, 60_000);
    expect(peekCachedIntelligence("menu-bi:network:24")).toEqual({ ok: true });
  });

  test("dedupes concurrent loaders", async () => {
    let calls = 0;
    const loader = () => {
      calls += 1;
      return Promise.resolve({ n: calls });
    };
    const [a, b] = await Promise.all([
      getCachedIntelligence("dup", loader, 60_000),
      getCachedIntelligence("dup", loader, 60_000),
    ]);
    expect(a).toEqual(b);
    expect(calls).toBe(1);
  });

  test("swr returns cache immediately then refreshes", async () => {
    setCachedIntelligence("swr-key", { v: 1 }, 60_000);
    let loads = 0;
    let resolveLoad;
    const loadPromise = new Promise((r) => {
      resolveLoad = r;
    });
    const first = await swrIntelligence("swr-key", async () => {
      loads += 1;
      await loadPromise;
      return { v: 2 };
    });
    expect(first.fromCache).toBe(true);
    expect(first.data).toEqual({ v: 1 });
    expect(loads).toBe(1);
    resolveLoad();
    await new Promise((r) => setTimeout(r, 0));
    expect(peekCachedIntelligence("swr-key")).toEqual({ v: 2 });
  });

  test("sign-out clears session caches", () => {
    setCachedIntelligence("menu-bi:khobar", { x: 1 }, 60_000);
    clearSessionIntelligenceCaches();
    expect(peekCachedIntelligence("menu-bi:khobar")).toBeNull();
  });

  test("invalidate by prefix", () => {
    setCachedIntelligence("menu-bi:a", 1, 60_000);
    setCachedIntelligence("reviews:a", 2, 60_000);
    invalidateIntelligenceCache("menu-bi:");
    expect(peekCachedIntelligence("menu-bi:a")).toBeNull();
    expect(peekCachedIntelligence("reviews:a")).toBe(2);
  });

  test("cacheKey joins segments", () => {
    expect(cacheKey(["menu-bi", "network", 24])).toBe("menu-bi:network:24");
  });
});
