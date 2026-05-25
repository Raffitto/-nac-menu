import {
  normalizeSessionDurationSeconds,
  normalizeAvgTimeSpent,
  MAX_GUEST_SESSION_DURATION_SEC,
  MAX_CREDIBLE_AVG_TIME_SPENT_SEC,
} from "./sessionMetricsConfig";
import { aggregateSessionQualityFromRows } from "./sessionQualityAggregate";

describe("sessionMetricsConfig", () => {
  test("caps unrealistic session durations", () => {
    expect(normalizeSessionDurationSeconds(120000)).toBe(MAX_GUEST_SESSION_DURATION_SEC);
    expect(normalizeSessionDurationSeconds(600)).toBe(600);
  });

  test("rejects unbelievable averages from rollup", () => {
    expect(normalizeAvgTimeSpent(2500 * 60)).toBe(0);
    expect(normalizeAvgTimeSpent(12 * 60)).toBe(12 * 60);
    expect(normalizeAvgTimeSpent(MAX_CREDIBLE_AVG_TIME_SPENT_SEC)).toBe(
      MAX_CREDIBLE_AVG_TIME_SPENT_SEC,
    );
  });

  test("aggregateSessionQuality caps idle tab sessions", () => {
    const rows = [
      {
        session_id: "s1",
        event_type: "time_spent",
        metadata: { duration_seconds: 80000 },
        created_at: new Date().toISOString(),
      },
      {
        session_id: "s2",
        event_type: "item_open",
        created_at: new Date().toISOString(),
      },
    ];
    const agg = aggregateSessionQualityFromRows(rows);
    expect(agg.avg_time_spent).toBeLessThanOrEqual(MAX_CREDIBLE_AVG_TIME_SPENT_SEC);
    expect(agg.avg_time_spent).toBe(MAX_GUEST_SESSION_DURATION_SEC);
  });
});
