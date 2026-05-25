import {
  aggregateSessionQualityFromRows,
  buildSessionFunnelFromMap,
  buildSessionMap,
} from "./sessionQualityAggregate";

describe("sessionQualityAggregate", () => {
  test("funnel uses unique sessions not raw event counts", () => {
    const sid = "session-abc";
    const rows = [
      { session_id: sid, event_type: "qr_session_start", created_at: "2026-01-01T10:00:00Z" },
      { session_id: sid, event_type: "category_open", created_at: "2026-01-01T10:01:00Z" },
      { session_id: sid, event_type: "item_open", created_at: "2026-01-01T10:02:00Z" },
      { session_id: sid, event_type: "item_open", created_at: "2026-01-01T10:03:00Z" },
      { session_id: sid, event_type: "item_impression", created_at: "2026-01-01T10:04:00Z" },
      { session_id: sid, event_type: "item_impression", created_at: "2026-01-01T10:05:00Z" },
      { session_id: "session-xyz", event_type: "qr_session_start", created_at: "2026-01-01T11:00:00Z" },
      { session_id: "session-xyz", event_type: "item_impression", created_at: "2026-01-01T11:01:00Z" },
    ];

    const agg = aggregateSessionQualityFromRows(rows);
    expect(agg.total_sessions).toBe(2);
    expect(agg.funnel.qr_scans).toBe(2);
    expect(agg.funnel.item_opens).toBe(1);
    expect(agg.funnel.category_opens).toBe(1);
  });

  test("passive-only sessions classify as bounce", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      session_id: "passive-1",
      event_type: "item_impression",
      created_at: `2026-01-01T10:0${i}:00Z`,
    }));
    const agg = aggregateSessionQualityFromRows(rows);
    expect(agg.session_quality.bounce).toBeGreaterThanOrEqual(1);
    expect(agg.session_quality.power).toBe(0);
  });

  test("duration capped under 20 minutes", () => {
    const rows = [
      {
        session_id: "long-1",
        event_type: "item_open",
        created_at: "2026-01-01T10:00:00Z",
      },
      {
        session_id: "long-1",
        event_type: "item_open",
        created_at: "2026-01-01T12:00:00Z",
      },
    ];
    const { map } = buildSessionMap(rows);
    const funnel = buildSessionFunnelFromMap(map);
    const agg = aggregateSessionQualityFromRows(rows);
    expect(agg.avg_time_spent).toBeLessThanOrEqual(20 * 60);
    expect(funnel.total_sessions).toBe(1);
  });
});
