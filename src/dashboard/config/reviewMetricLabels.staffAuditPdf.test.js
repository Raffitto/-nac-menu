import {
  STAFF_AUDIT_TABLE_HEAD,
  STAFF_AUDIT_TABLE_HEAD_PDF,
  STAFF_AUDIT_EXPORT_COLUMN_STYLES,
} from "./reviewMetricLabels";

const EXPECTED_PDF_HEADERS = [
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

/** Landscape A4 content width (pt) — margin 36 each side. */
const LANDSCAPE_CONTENT_W = 841.89 - 72;

describe("staff audit PDF export headers", () => {
  it("uses short export-safe labels distinct from dashboard headers", () => {
    expect(STAFF_AUDIT_TABLE_HEAD_PDF).toEqual(EXPECTED_PDF_HEADERS);
    expect(STAFF_AUDIT_TABLE_HEAD).not.toEqual(STAFF_AUDIT_TABLE_HEAD_PDF);
    expect(STAFF_AUDIT_TABLE_HEAD).toContain("Card taps");
    expect(STAFF_AUDIT_TABLE_HEAD_PDF).not.toContain("Card taps");
  });

  it("allocates column widths within landscape page content", () => {
    const total = Object.values(STAFF_AUDIT_EXPORT_COLUMN_STYLES).reduce(
      (sum, col) => sum + col.cellWidth,
      0,
    );
    expect(total).toBeLessThanOrEqual(LANDSCAPE_CONTENT_W);
    expect(total).toBeGreaterThan(700);
  });

});
