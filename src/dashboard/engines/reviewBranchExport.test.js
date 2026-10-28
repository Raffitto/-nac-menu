import * as XLSX from "xlsx";
import { buildEmployeePerformance } from "./employeePerformanceEngine";
import { exportReviewIntelligenceReport } from "./exportEngine";

test("same-named staff retain separate branch classifications", () => {
  const rows = buildEmployeePerformance([
    { name: "Sam", branch: "hettin", opens: 12, generated: 10, google_clicks: 5 },
    { name: "Sam", branch: "riyadh", opens: 1, generated: 0, google_clicks: 0 },
  ]);
  expect(rows.map((row) => row.branch)).toEqual(["hettin", "riyadh"]);
  expect(rows[0].classification.label).not.toBe(rows[1].classification.label);
});

test("network review export labels each staff row with its actual branch", () => {
  const write = jest.spyOn(XLSX, "writeFile").mockImplementation(() => {});
  try {
    exportReviewIntelligenceReport({
      branch: "All branches",
      selectedRange: "7d",
      rangeLabel: "7D",
      review: { qr_scans: 3, reviews_generated: 2, google_clicks: 1, conversion_pct: 33 },
      staffStats: [
        { name: "Sam", branch: "hettin", scans: 2, generated: 1, google: 1, conversion_pct: 50 },
        { name: "Sam", branch: "riyadh", scans: 1, generated: 1, google: 0, conversion_pct: 0 },
      ],
      comparison: [
        { branch_id: "hettin", qr_scans: 2, reviews_generated: 1, google_redirects: 1, conversion_pct: 50 },
        { branch_id: "riyadh", qr_scans: 1, reviews_generated: 1, google_redirects: 0, conversion_pct: 0 },
      ],
    });
    const workbook = write.mock.calls[0][0];
    const staff = XLSX.utils.sheet_to_json(workbook.Sheets.Staff);
    expect(staff.map((row) => row.Branch)).toEqual(["Hettin", "Laysen Valley"]);
  } finally {
    write.mockRestore();
  }
});
