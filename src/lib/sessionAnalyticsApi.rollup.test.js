import { fetchSessionAnalytics, loadCachedSessionAnalytics } from "./sessionAnalyticsApi";
import { sessionAnalyticsQueryCache } from "./branchQueryCache";

test("session analytics reads the rollup and does not scan menu_events", async () => {
  const calls = [];
  const supabase = {
    rpc(name) {
      calls.push(name);
      if (name === "get_session_analytics") {
        return Promise.resolve({ data: null, error: { message: "raw scan" } });
      }
      return Promise.resolve({ data: [{ total_events: 4, aggregation_note: "rollup" }], error: null });
    },
  };
  const result = await fetchSessionAnalytics(
    supabase,
    { branch: "khobar", selectedRange: "today" },
    { skipFeed: true, skipLiveQuality: true },
  );
  expect(calls).toContain("get_session_analytics_from_rollup");
  expect(calls).not.toContain("get_session_analytics");
  expect(result.aggregates).toBeTruthy();
});

test("session analytics cache stays on the branch and a refresh loads again", async () => {
  sessionAnalyticsQueryCache.invalidate("khobar");
  sessionAnalyticsQueryCache.invalidate("riyadh");
  let calls = 0;
  const supabase = {
    rpc() {
      calls += 1;
      return Promise.resolve({ data: [{ total_events: 4, aggregation_note: "rollup" }], error: null });
    },
  };
  const filters = { branch: "khobar", selectedRange: "today" };
  const first = await loadCachedSessionAnalytics(supabase, filters, { ttlMs: 60000, skipFeed: true, skipLiveQuality: true });
  const second = await loadCachedSessionAnalytics(supabase, filters, { ttlMs: 60000, skipFeed: true, skipLiveQuality: true });
  await loadCachedSessionAnalytics(supabase, { branch: "riyadh", selectedRange: "today" }, { ttlMs: 60000, skipFeed: true, skipLiveQuality: true });
  const refreshed = await loadCachedSessionAnalytics(supabase, filters, { invalidate: true, ttlMs: 60000, skipFeed: true, skipLiveQuality: true });
  expect(first.fromCache).toBe(false);
  expect(second.fromCache).toBe(true);
  expect(second.updatedAt).toBe(first.updatedAt);
  expect(refreshed.fromCache).toBe(false);
  expect(calls).toBe(3);
});
