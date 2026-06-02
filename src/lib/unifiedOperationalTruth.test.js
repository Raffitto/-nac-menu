import {
  reconcileTopCategories,
  reconcileSessionCounts,
  visibilityEngagementScore,
} from "./unifiedOperationalTruth";

describe("unifiedOperationalTruth", () => {
  it("does not inject synthetic category rows when rollup detail lags", () => {
    const bi = {
      funnel: { category_opens: 627 },
      top_categories: [{ id: "evening", opens: 19 }],
      by_event_type: { category_open: 627 },
    };
    const cats = reconcileTopCategories(bi);
    expect(cats.some((c) => String(c.id).startsWith("__"))).toBe(false);
    expect(cats).toHaveLength(1);
    expect(cats[0].opens).toBe(19);
  });

  it("does not force menu QR scans to equal total sessions", () => {
    const { qrScans, sessions } = reconcileSessionCounts({
      total_sessions: 280,
      funnel: { qr_scans: 275, category_opens: 200, item_opens: 120 },
    });
    expect(sessions).toBe(280);
    expect(qrScans).toBe(275);
  });

  it("enforces item_opens <= category_opens <= qr_scans", () => {
    const { funnel } = reconcileSessionCounts({
      total_sessions: 100,
      funnel: { qr_scans: 50, category_opens: 80, item_opens: 90 },
    });
    expect(funnel.item_opens).toBeLessThanOrEqual(funnel.category_opens);
    expect(funnel.category_opens).toBeLessThanOrEqual(funnel.qr_scans);
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
