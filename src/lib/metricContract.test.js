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
