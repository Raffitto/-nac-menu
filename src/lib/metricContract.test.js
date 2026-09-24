import { executiveHeadline, formatExecutiveCount } from "./metricContract";

test("timeout payload is not a verified zero", () => {
  const headline = executiveHeadline({
    _availability: "unavailable",
    funnel: { qr_scans: 0 },
    total_sessions: 0,
    _reviewAvailability: "unavailable",
    review_kpis: { qr_scans: 0, google_redirects: 0 },
  });
  expect(headline.menuQr).toBeNull();
  expect(headline.sessions).toBeNull();
  expect(headline.reviewQr).toBeNull();
  expect(headline.googleRedirects).toBeNull();
  expect(formatExecutiveCount(headline.menuQr)).toBe("—");
});

test("successful review QR uses the enriched field name", () => {
  const headline = executiveHeadline({
    _availability: "success",
    _reviewAvailability: "success",
    review_kpis: { review_qr_scans: 21, review_redirect: 1 },
    funnel: { review_redirect: 1 },
  });
  expect(headline.reviewQr).toBe(21);
  expect(formatExecutiveCount(headline.reviewQr)).toBe("21");
});

test("stale keeps the last successful value", () => {
  const headline = executiveHeadline({
    _availability: "stale",
    _staleAt: "2026-09-24T17:00:00.000Z",
    _loadedAt: "2026-09-24T16:00:00.000Z",
    menu_qr_scans: 244,
    total_sessions: 244,
    _reviewAvailability: "stale",
    review_kpis: { review_qr_scans: 23, review_redirect: 1 },
    funnel: { review_redirect: 1 },
  });
  expect(headline.menuState).toBe("stale");
  expect(headline.menuQr).toBe(244);
  expect(headline.reviewQr).toBe(23);
  expect(headline.staleAt).toBe("2026-09-24T17:00:00.000Z");
  expect(formatExecutiveCount(headline.menuQr)).toBe("244");
});

test("a successful zero stays zero", () => {
  const headline = executiveHeadline({
    _availability: "success",
    funnel: { qr_scans: 0 },
    total_sessions: 0,
    _reviewAvailability: "success",
    review_kpis: { qr_scans: 0, google_redirects: 0 },
  });
  expect(headline.menuQr).toBe(0);
  expect(formatExecutiveCount(0)).toBe("0");
});
