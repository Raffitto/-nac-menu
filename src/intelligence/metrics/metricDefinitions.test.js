import {
  METRIC_IDS,
  getMetricDefinition,
  getMetricLabel,
  getMetricTooltip,
  getMetricWarning,
  resolveIntelligenceStatusBanner,
  listMetricDefinitions,
} from "./metricDefinitions";

describe("metricDefinitions", () => {
  test("defines all canonical metric ids", () => {
    const ids = listMetricDefinitions().map((d) => d.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        METRIC_IDS.MENU_QR_SCAN,
        METRIC_IDS.REVIEW_QR_SCAN,
        METRIC_IDS.SESSION,
        METRIC_IDS.GOOGLE_REDIRECT,
        METRIC_IDS.GOOGLE_REVIEW,
        METRIC_IDS.PARTIAL_LIVE,
      ]),
    );
    expect(ids.length).toBe(13);
  });

  test("getMetricLabel resolves aliases", () => {
    expect(getMetricLabel("menu_qr_scan")).toBe("Menu QR Scans");
    expect(getMetricLabel("qr_scans")).toBe("Menu QR Scans");
    expect(getMetricLabel("google_redirect")).toBe("Google Redirects");
  });

  test("getMetricTooltip includes source", () => {
    expect(getMetricTooltip(METRIC_IDS.SESSION)).toMatch(/menu_events/i);
  });

  test("getMetricWarning surfaces partial copy", () => {
    expect(getMetricWarning(METRIC_IDS.MENU_QR_SCAN, { partial: true })).toMatch(/rollup/i);
    expect(getMetricWarning(METRIC_IDS.AVG_SPEND_PER_GUEST, { unavailable: true })).toMatch(
      /Phase J/i,
    );
  });

  test("resolveIntelligenceStatusBanner prioritizes updating state", () => {
    expect(
      resolveIntelligenceStatusBanner({ loading: true, hasExistingData: true })?.kind,
    ).toBe("updating");
    expect(
      resolveIntelligenceStatusBanner({ liveFallback: true })?.message,
    ).toMatch(/Live fallback/i);
  });
});
