/**
 * Executive review funnel labels — UI uses arrows; PDF uses ASCII-safe copies.
 */

import { paintExportText, setExportFont } from "../engines/pdfVisualTheme";

export const REVIEW_FUNNEL_SUBTITLE =
  "Card tap → Review interaction → Google redirect";

/** PDF / Helvetica-safe funnel subtitle */
export const REVIEW_FUNNEL_SUBTITLE_PDF =
  "Card tap to Review interaction to Google redirect";

export const REVIEW_METRIC = {
  cardTaps: "Card taps",
  reviewInteractions: "Review interactions",
  googleRedirects: "Google redirects",
  toGooglePct: "To Google %",
  cardToReviewPct: "Card→Review %",
  tapToGooglePct: "Tap→Google %",
};

/** PDF-safe metric labels (no unicode arrows or separators) */
export const REVIEW_METRIC_PDF = {
  cardTaps: "Card taps",
  reviewInteractions: "Review interactions",
  googleRedirects: "Google redirects",
  toGooglePct: "To Google %",
  cardToReviewPct: "Card to Review %",
  tapToGooglePct: "tap-to-Google",
};

/** Compact staff audit table (branch operational PDF). */
export const STAFF_AUDIT_TABLE_HEAD = [
  "Staff",
  "Role",
  "Card taps",
  "Interactions",
  "Google",
  "To Google %",
  "Card→Review %",
  "Profile",
  "Status",
  "Action",
  "Shift",
];

export const STAFF_AUDIT_TABLE_HEAD_PDF = [
  "Staff",
  "Role",
  "Card taps",
  "Interactions",
  "Google",
  "To Google %",
  "Card to Review %",
  "Profile",
  "Status",
  "Action",
  "Shift",
];

/** Staff summary table (summary PDF / exports). */
export const STAFF_SUMMARY_TABLE_HEAD = [
  "Staff",
  "Role",
  "Card taps",
  "Interactions",
  "Google",
  "To Google %",
];

export const BRANCH_BENCHMARK_TABLE_HEAD = [
  "Branch",
  "Card taps",
  "Interactions",
  "Google",
  "To Google %",
];

export const STAFF_AUDIT_LEGEND_LINES = [
  "Card taps = QR/NFC card taps",
  "Interactions = generated review pages (not published Google reviews)",
  "Google = redirected to Google review page",
  "To Google % = review-to-Google redirect conversion",
  "Card→Review % = taps converted into review interactions",
];

export const STAFF_AUDIT_LEGEND_LINES_PDF = [
  "Card taps = QR/NFC card taps",
  "Interactions = generated review pages (not published Google reviews)",
  "Google = redirected to Google review page",
  "To Google % = review-to-Google redirect conversion",
  "Card to Review % = taps converted into review interactions",
];

/** @param {import('jspdf').jsPDF} doc */
export function drawStaffAuditTableLegend(doc, margin, y) {
  setExportFont(doc, 500, 6.5);
  STAFF_AUDIT_LEGEND_LINES_PDF.forEach((line, i) => {
    paintExportText(doc, line, margin, y + i * 9, { tier: "muted", shadow: true });
  });
  return y + STAFF_AUDIT_LEGEND_LINES_PDF.length * 9 + 6;
}
