import {
  extractQrScanKpis,
  filterRankedTopItems,
  resolveSessionLanguageStats,
  buildMenuFunnelStageMetrics,
  buildReviewFunnelStageMetrics,
  resolveScanChartBuckets,
  insightPassesConfidence,
  filterDisplayInsights,
} from "./operationalMetricsIntegrity";

describe("extractQrScanKpis", () => {
  it("separates menu and review QR scans", () => {
    const kpis = extractQrScanKpis({
      funnel: { qr_scans: 100 },
      review_kpis: { review_qr_scans: 12 },
    });
    expect(kpis.menu_qr_scans).toBe(100);
    expect(kpis.review_qr_scans).toBe(12);
    expect(kpis.total_qr_scans).toBe(112);
  });

  it("uses QR funnel not inflated all-event session count when QR is present", () => {
    const kpis = extractQrScanKpis({
      total_sessions: 500,
      funnel: { qr_scans: 12 },
      by_event_type: {},
    });
    expect(kpis.menu_qr_scans).toBe(12);
  });
});

describe("filterRankedTopItems", () => {
  it("excludes zero-open items from rankings", () => {
    const ranked = filterRankedTopItems([
      { name: "A", opens: 0, impressions: 50 },
      { name: "B", opens: 3, impressions: 1 },
      { name: "C", opens: 0, impressions: 0 },
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].name).toBe("B");
  });
});

describe("resolveSessionLanguageStats", () => {
  it("uses lang_behavior session counts not event counts", () => {
    const stats = resolveSessionLanguageStats({
      lang_behavior: { en: { sessions: 40 }, ar: { sessions: 60 } },
      by_language: { en: 500, ar: 800 },
    });
    expect(stats.total_sessions).toBe(100);
    expect(stats.english_pct).toBe(40);
    expect(stats.arabic_pct).toBe(60);
    expect(stats.source).toBe("lang_behavior");
  });
});

describe("funnel stage metrics", () => {
  it("never produces negative drop percentages for review overflow", () => {
    const review = buildReviewFunnelStageMetrics({
      qr_scans: 50,
      review_redirect: 25,
      google_review_open: 8,
    });
    const redirect = review.find((s) => s.key === "review_redirect");
    expect(redirect.convPct).toBeGreaterThanOrEqual(0);
    expect(redirect.convPct).toBeLessThanOrEqual(100);
  });

  it("builds menu stages separately from review", () => {
    const menu = buildMenuFunnelStageMetrics({
      qr_scans: 50,
      category_opens: 40,
      item_opens: 30,
      addon_clicks: 10,
    });
    expect(menu).toHaveLength(4);
    expect(menu[0].key).toBe("qr_scans");
  });
});

describe("resolveScanChartBuckets", () => {
  it("uses customer-friendly empty message", () => {
    const chart = resolveScanChartBuckets({ by_hour_qr: [] }, 24);
    expect(chart.usesQrEventsOnly).toBe(false);
    expect(chart.emptyReason).toMatch(/isn't available/i);
    expect(chart.emptyReason).not.toMatch(/\.sql/i);
  });
});

describe("insight confidence", () => {
  it("suppresses insights without source or with em dash", () => {
    expect(
      insightPassesConfidence({
        text: "Peak menu activity around —",
        confidence: 0.9,
        source: "x",
        value: 1,
      }),
    ).toBe(false);
    expect(
      filterDisplayInsights([
        {
          text: "Valid insight",
          confidence: 0.8,
          source: "funnel",
          value: 10,
          type: "neutral",
        },
      ]),
    ).toHaveLength(1);
  });
});
