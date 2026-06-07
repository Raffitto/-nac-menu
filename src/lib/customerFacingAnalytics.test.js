import {
  enforceMenuFunnelIntegrity,
  filterCustomerFacingCategories,
  resolveCanonicalMenuSessions,
  resolveSessionQualityDenominator,
  isSyntheticCategoryId,
} from "./customerFacingAnalytics";

describe("customerFacingAnalytics", () => {
  it("filters synthetic category ids", () => {
    const rows = filterCustomerFacingCategories([
      { id: "__nav_aggregate__", opens: 200 },
      { id: "evening", opens: 40 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("evening");
    expect(isSyntheticCategoryId("__nav_aggregate__")).toBe(true);
  });

  it("enforces monotonic menu funnel", () => {
    const f = enforceMenuFunnelIntegrity({
      qr_scans: 10,
      category_opens: 50,
      item_opens: 40,
      addon_clicks: 99,
    });
    expect(f.category_opens).toBe(10);
    expect(f.item_opens).toBe(10);
    expect(f.addon_clicks).toBe(10);
  });

  it("uses qr_session_start funnel for sessions when SQL counted all event sessions", () => {
    const canon = resolveCanonicalMenuSessions({
      total_sessions: 224,
      funnel: { qr_scans: 4, category_opens: 3, item_opens: 2 },
    });
    expect(canon.menuSessions).toBe(4);
    expect(canon.menuQrScans).toBe(4);
    expect(canon.allSessionIdsWithEvents).toBe(224);
  });

  it("aligns today sessions and menu QR from funnel", () => {
    const canon = resolveCanonicalMenuSessions({
      total_sessions: 11,
      funnel: { qr_scans: 5 },
      by_event_type: { qr_session_start: 5 },
    });
    expect(canon.menuSessions).toBe(5);
    expect(canon.menuQrScans).toBe(5);
  });

  it("does not treat all event sessions as menu QR when qr_session_start missing", () => {
    const canon = resolveCanonicalMenuSessions({
      total_sessions: 224,
      funnel: {},
    });
    expect(canon.menuSessions).toBe(0);
    expect(canon._missingQrSessionStart).toBe(true);
  });

  it("prefers primary funnel over denser _sessionFunnel when both present", () => {
    const canon = resolveCanonicalMenuSessions({
      total_sessions: 223,
      funnel: { qr_scans: 16 },
      _sessionFunnel: { qr_scans: 223 },
    });
    expect(canon.menuSessions).toBe(16);
    expect(canon.menuQrScans).toBe(16);
  });

  it("uses classified session count as denominator when partial", () => {
    const d = resolveSessionQualityDenominator(
      { casual: 3, engaged: 2, bounce: 0, deep: 0, power: 0 },
      38195,
    );
    expect(d.isPartial).toBe(true);
    expect(d.denominator).toBe(5);
    expect(d.classifiedCount).toBe(5);
  });
});
