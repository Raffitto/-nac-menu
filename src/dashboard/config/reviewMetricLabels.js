/**
 * Executive review funnel labels — UI uses arrows; PDF uses ASCII-safe copies.
 */

import { paintExportText, setExportFont } from "../engines/pdfVisualTheme";
import { getMetricLabel, METRIC_IDS } from "../../intelligence/metrics/metricDefinitions";

export const REVIEW_FUNNEL_SUBTITLE =
  "Card tap → Review interaction → Google redirect";

/** PDF / Helvetica-safe funnel subtitle */
export const REVIEW_FUNNEL_SUBTITLE_PDF =
  "Card tap to Review interaction to Google redirect";

export const REVIEW_METRIC = {
  cardTaps: "Review QR scans",
  reviewInteractions: "Review interactions",
  googleRedirects: getMetricLabel(METRIC_IDS.GOOGLE_REDIRECT),
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
  "Review QR scans",
  "Interactions",
  "Google Redirects",
  "To Google %",
  "Card→Review %",
  "Profile",
  "Status",
  "Action",
  "Shift",
];

/** Landscape operational-review PDF — short headers to avoid mid-word wraps. */
export const STAFF_AUDIT_TABLE_HEAD_PDF = [
  "Staff",
  "Role",
  "Taps",
  "Interactions",
  "Google",
  "To Google %",
  "Review %",
  "Profile",
  "Status",
  "Action",
  "Shift",
];

/** Column widths for staff audit export (sum ≈ landscape A4 content width). */
export const STAFF_AUDIT_EXPORT_COLUMN_STYLES = {
  0: { cellWidth: 86 },
  1: { cellWidth: 46 },
  2: { cellWidth: 38, halign: "right" },
  3: { cellWidth: 60, halign: "right" },
  4: { cellWidth: 44, halign: "right", fontStyle: "bold" },
  5: { cellWidth: 52, halign: "right", fontStyle: "bold" },
  6: { cellWidth: 48, halign: "right", fontStyle: "bold" },
  7: { cellWidth: 64 },
  8: { cellWidth: 70 },
  9: { cellWidth: 186 },
  10: { cellWidth: 46, overflow: "hidden" },
};

/** Staff summary table (summary PDF / exports). */
export const STAFF_SUMMARY_TABLE_HEAD = [
  "Staff",
  "Role",
  "Review QR scans",
  "Interactions",
  "Google Redirects",
  "To Google %",
];

export const BRANCH_BENCHMARK_TABLE_HEAD = [
  "Branch",
  "Review QR scans",
  "Interactions",
  "Google Redirects",
  "To Google %",
];

export const STAFF_AUDIT_LEGEND_LINES = [
  "Review QR scans = review portal QR / NFC entry (not menu QR)",
  "Interactions = generated review pages (not published Google reviews)",
  "Google = Google Redirects to the public review page",
  "To Google % = tap-to-Google redirect conversion",
  "Card→Review % = review QR scans converted into review interactions",
];

export const STAFF_AUDIT_LEGEND_LINES_PDF = [
  "Card taps = QR/NFC card taps",
  "Interactions = generated review pages (not published Google reviews)",
  "Google = redirected to Google review page",
  "To Google % = tap-to-Google redirect conversion",
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
