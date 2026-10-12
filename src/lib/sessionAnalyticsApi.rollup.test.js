import { fetchSessionAnalytics } from "./sessionAnalyticsApi";

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
