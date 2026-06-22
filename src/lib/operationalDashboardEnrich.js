/**
 * Enrich canonical menu BI payload with review_events funnel stages and KPIs.
 */

import { kpisFromReviewSummary } from "../dashboard/utils/reviewSummaryMap";

export const OPERATIONAL_FUNNEL_KEYS = [
  "qr_scans",
  "category_opens",
  "item_opens",
  "addon_clicks",
  "review_redirect",
  "google_review_open",
];

export function reviewCountsFromSummary(summary) {
  const kpis = kpisFromReviewSummary(summary) || {};
  return {
    // review_redirect funnel key = Google Redirects (clicks to Google review URL)
    review_redirect: Number(kpis.google_redirects) || 0,
    // google_review_open funnel key = review portal page opens (pre-redirect step)
    google_review_open: Number(kpis.review_page_opens) || 0,
    review_qr_scans: Number(kpis.qr_scans) || 0,
    reviews_generated: Number(kpis.reviews_generated) || 0,
    review_conversion_pct: Number(kpis.conversion_pct) || 0,
  };
}

/**
 * Merge review funnel stages onto menu BI payload (client-side; no SQL change required).
 */
export function mergeReviewIntoOperationalPayload(biPayload, reviewSummary) {
  if (!biPayload || typeof biPayload !== "object") return biPayload;
  const review = reviewCountsFromSummary(reviewSummary);
  const funnel = {
    ...(biPayload.funnel || {}),
    review_redirect: review.review_redirect,
    google_review_open: review.google_review_open,
  };

  return {
    ...biPayload,
    funnel,
    review_kpis: review,
    review_summary: reviewSummary || null,
  };
}
