import {
  clearSessionIntelligenceCaches,
  peekCachedIntelligence,
  setCachedIntelligence,
  cacheKey,
} from "../utils/intelligenceCache";

describe("menu BI cache key / session clear", () => {
  beforeEach(() => {
    clearSessionIntelligenceCaches();
  });

  test("stores package under scoped key for instant revisit", () => {
    const key = cacheKey(["menu-bi", "khobar", 24, "today", "khobar"]);
    setCachedIntelligence(
      key,
      {
        normalized: { total_sessions: 12 },
        truth: null,
        partial: false,
        note: null,
        opsNotes: [],
        liveFallback: false,
        menuDataEmpty: false,
        operationalTrust: null,
        truthValidation: null,
      },
      60_000,
    );
    expect(peekCachedIntelligence(key)?.normalized?.total_sessions).toBe(12);
  });

  test("sign-out clears BI packages so accounts cannot share cache", () => {
    setCachedIntelligence("menu-bi:network:24:today:all", { normalized: { x: 1 } }, 60_000);
    clearSessionIntelligenceCaches();
    expect(peekCachedIntelligence("menu-bi:network:24:today:all")).toBeNull();
  });
});
