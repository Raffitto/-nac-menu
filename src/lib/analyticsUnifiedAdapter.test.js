import {
  mergeSessionMasterWithBiRaw,
  resolveOperationalTrust,
  OPERATIONAL_TRUST,
  hourlyBucketsFromSessionAggregates,
} from "./analyticsUnifiedAdapter";

describe("analyticsUnifiedAdapter", () => {
  test("session master wins higher engagement totals", () => {
    const merged = mergeSessionMasterWithBiRaw(
      { total_events: 19, total_sessions: 16, by_hour: [{ hour: 10, count: 2 }] },
      {
        total_events: 26000,
        total_sessions: 223,
        by_event_type: { qr_session_start: 200, item_open: 400 },
        by_hour: [{ hour: 14, count: 120, granularity: "hour", label: "2 PM" }],
        bounce_sessions: 40,
        deep_sessions: 80,
        avg_time_spent: 180,
      },
      24,
    );
    expect(merged.total_events).toBe(26000);
    expect(merged.total_sessions).toBe(223);
    expect(merged.data_source).toBe("unified_session_master");
  });

  test("hourly buckets prefer session pipeline when denser", () => {
    const buckets = hourlyBucketsFromSessionAggregates(
      {
        by_hour: [
          { hour: 12, count: 5, granularity: "hour" },
          { hour: 13, count: 8, granularity: "hour" },
        ],
      },
      24,
    );
    expect(buckets.length).toBeGreaterThanOrEqual(2);
  });

  test("resolveOperationalTrust maps rollup recovery", () => {
    const trust = resolveOperationalTrust({
      dataSource: "client_fallback",
      note: "merged live menu_events",
      sessionEvents: 1000,
    });
    expect(trust.badge).toBe(OPERATIONAL_TRUST.ROLLUP_RECOVERED);
  });

  test("resolveOperationalTrust live verified when healthy", () => {
    const trust = resolveOperationalTrust({
      sessionEvents: 500,
      biEvents: 480,
    });
    expect(trust.badge).toBe(OPERATIONAL_TRUST.LIVE_VERIFIED);
  });
});
