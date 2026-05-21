/**
 * Canonical review funnel math — single source for KPIs, staff rows, and exports.
 * tap-to-Google = google_redirects / card_taps (qr_scans)
 */

export const REVIEW_GENERATED_TYPES = new Set(["review_generate", "review_regenerate"]);
export const REVIEW_GOOGLE_TYPES = new Set(["google_redirect", "review_google_click"]);
export const REVIEW_PAGE_OPEN_TYPES = new Set(["review_page_open", "review_open"]);

/** Display-safe percentage (0–100); raw ratios can exceed 100 when multiple events per tap. */
export function clampDisplayPct(value, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(0, Math.round(n)));
}

export function pct(num, den) {
  if (!den || den === 0) return 0;
  return clampDisplayPct((num / den) * 100);
}

/** Card tap → Google redirect (network KPI) */
export function tapToGooglePct(googleRedirects, cardTaps) {
  return pct(googleRedirects, cardTaps);
}

/** Review interaction → Google redirect (staff coaching) */
export function interactionToGooglePct(googleRedirects, interactions) {
  return pct(googleRedirects, interactions);
}

/** Card tap → review interaction */
export function cardToReviewPct(interactions, cardTaps) {
  return pct(interactions, cardTaps);
}
