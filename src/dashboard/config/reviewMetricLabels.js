/**
 * Executive review funnel labels — shared across UI, PDF, and XLSX.
 * Funnel: Card tap → Review interaction → Google redirect
 */

export const REVIEW_FUNNEL_SUBTITLE =
  "Card tap → Review interaction → Google redirect";

export const REVIEW_METRIC = {
  cardTaps: "Card taps",
  reviewInteractions: "Review interactions",
  googleRedirects: "Google redirects",
  toGooglePct: "To Google %",
  cardToReviewPct: "Card→Review %",
  tapToGooglePct: "Tap→Google %",
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

/** @param {import('jspdf').jsPDF} doc */
export function drawStaffAuditTableLegend(doc, margin, y) {
  doc.setFontSize(6);
  doc.setTextColor(130, 130, 130);
  STAFF_AUDIT_LEGEND_LINES.forEach((line, i) => {
    doc.text(line, margin, y + i * 8);
  });
  return y + STAFF_AUDIT_LEGEND_LINES.length * 8 + 6;
}
