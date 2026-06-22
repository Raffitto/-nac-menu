import { mergeReviewIntoOperationalPayload } from "./operationalDashboardEnrich";

describe("mergeReviewIntoOperationalPayload", () => {
  test("adds review funnel stages from summary", () => {
    const out = mergeReviewIntoOperationalPayload(
      { funnel: { qr_scans: 10, category_opens: 8 } },
      { review_page_opens: 5, google_redirects: 3, qr_scans: 5 },
    );
    expect(out.funnel.review_redirect).toBe(3);
    expect(out.funnel.google_review_open).toBe(5);
    expect(out.review_kpis.review_conversion_pct).toBeDefined();
  });
});
