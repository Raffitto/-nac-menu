import {
  reconcileTopCategories,
  reconcileSessionCounts,
  visibilityEngagementScore,
} from "./unifiedOperationalTruth";

describe("unifiedOperationalTruth", () => {
  it("reconciles category opens when rollup rows lag funnel", () => {
    const bi = {
      funnel: { category_opens: 627 },
      top_categories: [{ id: "evening", opens: 19 }],
      by_event_type: { category_open: 627 },
    };
    const cats = reconcileTopCategories(bi);
    const sum = cats.reduce((s, c) => s + c.opens, 0);
    expect(sum).toBeGreaterThanOrEqual(500);
  });

  it("aligns qr scans with sessions", () => {
    const { qrScans, sessions } = reconcileSessionCounts({
      total_sessions: 280,
      funnel: { qr_scans: 275 },
    });
    expect(qrScans).toBe(280);
    expect(sessions).toBe(280);
  });

  it("uses canonical visibility formula", () => {
    const score = visibilityEngagementScore({
      impressions: 100,
      opens: 10,
      avg_visible_duration_ms: 4000,
    });
    expect(score).toBeGreaterThan(40);
  });
});
