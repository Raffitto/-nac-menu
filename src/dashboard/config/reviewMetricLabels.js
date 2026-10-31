/**
 * Executive review funnel labels — UI uses arrows; PDF uses ASCII-safe copies.
 */

import { paintExportText, setExportFont } from "../engines/pdfVisualTheme";

export const REVIEW_FUNNEL_SUBTITLE =
  "QR visits → Converted visits (Google step)";

/** PDF / Helvetica-safe funnel subtitle */
export const REVIEW_FUNNEL_SUBTITLE_PDF =
  "QR visits to Converted visits (Google step)";

export const REVIEW_METRIC = {
  cardTaps: "QR visits",
  reviewInteractions: "Review interactions",
  googleRedirects: "Converted visits",
  toGooglePct: "Visit conversion %",
  cardToReviewPct: "Interactions /100 visits",
  tapToGooglePct: "Visit conversion %",
};

/** PDF-safe metric labels (no unicode arrows or separators) */
export const REVIEW_METRIC_PDF = {
  cardTaps: "QR visits",
  reviewInteractions: "Review interactions",
  googleRedirects: "Converted visits",
  toGooglePct: "Visit conversion %",
  cardToReviewPct: "Interactions /100 visits",
  tapToGooglePct: "Visit conversion %",
};

/** Compact staff audit table (branch operational PDF). */
export const STAFF_AUDIT_TABLE_HEAD = [
  "Staff",
  "Role",
  "QR visits",
  "Interactions",
  "Converted visits",
  "Visit conversion %",
  "Interactions /100 visits",
  "Profile",
  "Status",
  "Action",
  "Shift",
];

/** Landscape operational-review PDF — short headers to avoid mid-word wraps. */
export const STAFF_AUDIT_TABLE_HEAD_PDF = [
  "Staff",
  "Role",
  "QR visits",
  "Interactions",
  "Converted",
  "Visit %",
  "Interactions/100",
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
  "QR visits",
  "Interactions",
  "Converted visits",
  "Visit conversion %",
];

export const BRANCH_BENCHMARK_TABLE_HEAD = [
  "Branch",
  "QR visits",
  "Interactions",
  "Converted visits",
  "Visit conversion %",
];

export const STAFF_AUDIT_LEGEND_LINES = [
  "QR visits = identifiable QR/NFC card-entry sessions; not unique people",
  "Interactions = generated review pages (not published Google reviews)",
  "Converted = qualifying visits reaching the Google step, counted once per visit",
  "Visit conversion = converted qualifying QR visits / qualifying QR visits; N/A when tracking is incomplete",
  "Interactions/100 = review interaction events per 100 qualifying visits; an activity ratio",
];

export const STAFF_AUDIT_LEGEND_LINES_PDF = [
  "QR visits = identifiable QR/NFC card-entry sessions; not unique people",
  "Interactions = generated review pages (not published Google reviews)",
  "Converted = qualifying visits reaching the Google step, counted once per visit",
  "Visit conversion = converted qualifying QR visits / qualifying QR visits; N/A when tracking is incomplete",
  "Interactions/100 = review interaction events per 100 qualifying visits; an activity ratio",
];

/** @param {import('jspdf').jsPDF} doc */
export function drawStaffAuditTableLegend(doc, margin, y) {
  setExportFont(doc, 500, 6.5);
  STAFF_AUDIT_LEGEND_LINES_PDF.forEach((line, i) => {
    paintExportText(doc, line, margin, y + i * 9, { tier: "muted", shadow: true });
  });
  return y + STAFF_AUDIT_LEGEND_LINES_PDF.length * 9 + 6;
}
