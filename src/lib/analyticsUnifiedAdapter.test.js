import { MONTH_HOURS } from "../dashboard/utils/rangeState";
import {
  mergeSessionMasterWithBiRaw,
  pickFunnelForOperationalMerge,
  resolveOperationalTrust,
  OPERATIONAL_TRUST,
  hourlyBucketsFromSessionAggregates,
} from "./analyticsUnifiedAdapter";

describe("analyticsUnifiedAdapter", () => {
  test("session master does not inflate BI today sessions with denser session sample", () => {
    const merged = mergeSessionMasterWithBiRaw(
      {
        total_events: 19,
        total_sessions: 16,
        funnel: { qr_scans: 16 },
        by_hour: [{ hour: 10, count: 2 }],
      },
      {
        total_events: 26000,
        total_sessions: 223,
        funnel: { qr_scans: 223, category_opens: 180, item_opens: 120 },
        by_event_type: { qr_session_start: 200, item_open: 400 },
        by_hour: [{ hour: 14, count: 120, granularity: "hour", label: "2 PM" }],
        bounce_sessions: 40,
        deep_sessions: 80,
        avg_time_spent: 180,
      },
      24,
    );
    expect(merged.total_events).toBe(26000);
    expect(merged.total_sessions).toBe(16);
    expect(merged.funnel.qr_scans).toBe(16);
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

  test("month merge keeps rollup QR sessions over truncated live patch funnel", () => {
    const biRaw = {
      total_sessions: 200,
      funnel: { qr_scans: 200, category_opens: 150, item_opens: 80 },
    };
    const aggregates = {
      total_sessions: 10,
      funnel: { qr_scans: 10, category_opens: 8, item_opens: 5 },
      _sessionMetricsFromLivePatch: true,
      session_quality: { bounce: 2, casual: 3, engaged: 4, deep: 1, power: 0 },
    };

    expect(pickFunnelForOperationalMerge(biRaw, aggregates, MONTH_HOURS).qr_scans).toBe(200);

    const merged = mergeSessionMasterWithBiRaw(biRaw, aggregates, MONTH_HOURS);
    expect(merged.total_sessions).toBe(200);
    expect(merged.funnel.qr_scans).toBe(200);
    expect(merged.menu_qr_scans).toBe(200);
    expect(merged.session_quality.engaged).toBe(4);
  });

  test("today merge prefers live BI canonical sessions over denser session funnel", () => {
    const merged = mergeSessionMasterWithBiRaw(
      { total_sessions: 5, funnel: { qr_scans: 5 } },
      {
        total_sessions: 11,
        funnel: { qr_scans: 11, category_opens: 9, item_opens: 6 },
        session_quality: { bounce: 1, casual: 2, engaged: 3, deep: 0, power: 0 },
      },
      24,
    );
    expect(merged.funnel.qr_scans).toBe(5);
    expect(merged.total_sessions).toBe(5);
  });
});
