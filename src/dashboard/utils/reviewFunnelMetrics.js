/**
 * Canonical review funnel math — single source for KPIs, staff rows, and exports.
 * Visit conversion uses converted qualifying visits / qualifying QR visits.
 */

export const REVIEW_GENERATED_TYPES = new Set(["review_generate", "review_regenerate"]);
export const REVIEW_GOOGLE_TYPES = new Set(["google_redirect", "review_google_click"]);
export const REVIEW_PAGE_OPEN_TYPES = new Set(["review_page_open", "review_open"]);

/**
 * Bound a score to 0–100. Reported review rates do not use this:
 * several Google events can belong to one card tap, and that ratio is kept.
 */
export function clampDisplayPct(value, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(0, Math.round(n)));
}

/** Rounded rate. Returns 0 when the denominator is missing. Does not cap the result. */
export function pct(num, den) {
  const denominator = Number(den);
  const numerator = Number(num);
  if (!denominator) return 0;
  const rate = (numerator / denominator) * 100;
  if (!Number.isFinite(rate)) return 0;
  return Math.round(rate);
}

/** Card tap → Google redirect (network KPI) */
export function tapToGooglePct(googleRedirects, cardTaps) {
  return visitConversionPct(googleRedirects, cardTaps);
}

/** Review interaction → Google redirect (staff coaching) */
export function interactionToGooglePct(googleRedirects, interactions) {
  return pct(googleRedirects, interactions);
}

/** Card tap → review interaction */
export function cardToReviewPct(interactions, cardTaps) {
  return pct(interactions, cardTaps);
}

/** Qualifying visit conversion. Invalid or incomplete inputs are unavailable. */
export function visitConversionPct(converted, visits, unidentifiable = 0) {
  if (unidentifiable > 0 || converted == null || visits == null) return null;
  const n = Number(converted), d = Number(visits);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0 || n < 0 || n > d) return null;
  return Math.round(100 * n / d);
}
