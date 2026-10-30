import * as XLSX from "xlsx";
import { buildEmployeePerformance } from "./employeePerformanceEngine";
import { exportReviewIntelligenceReport } from "./exportEngine";
import { exportCSV } from "../utils/formatters";
import { staffFromReviewSummary } from "../utils/reviewSummaryMap";
import { tapToGooglePct } from "../utils/reviewFunnelMetrics";
import { buildBranchOperationalReportFromSummary } from "./branchOperationalReviewEngine";

jest.mock("../utils/formatters", () => {
  const actual = jest.requireActual("../utils/formatters");
  return { ...actual, exportCSV: jest.fn() };
});

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
    expect(staff.map((row) => row.Branch)).toEqual(["NAC Hettin", "NAC Laysen Valley"]);
  } finally {
    write.mockRestore();
  }
});

test("Laysen month-to-date rates use card taps as the denominator in XLSX, CSV, and coaching rows", () => {
  expect(tapToGooglePct(2, 1)).toBe(200);
  expect(tapToGooglePct(17, 36)).toBe(47);

  const summaryStaff = staffFromReviewSummary({
    staff: [
      { branch_id: "riyadh", name: "Atik", role: "waiter", scans: 1, generated: 2, google: 2, conversion_pct: 100 },
      { branch_id: "riyadh", name: "Eusuf", role: "waiter", scans: 36, generated: 76, google: 17, conversion_pct: 47 },
    ],
  });
  expect(summaryStaff.find((row) => row.name === "Atik").conversion_pct).toBe(200);
  expect(summaryStaff.find((row) => row.name === "Eusuf").conversion_pct).toBe(47);

  const write = jest.spyOn(XLSX, "writeFile").mockImplementation(() => {});
  const laysen = {
    branch: "NAC Laysen Valley",
    selectedRange: "month",
    rangeLabel: "1 October 2026 – 30 October 2026",
    review: { qr_scans: 94, reviews_generated: 199, google_clicks: 48, conversion_pct: 100 },
    staffStats: summaryStaff,
    employees: [
      {
        name: "Atik",
        classification: { label: "Underutilized Staff", reason: "Insufficient data — monitor before acting." },
        metrics: { scans_generated: 1, reviews_generated: 2, google_clicks: 2, review_conversion_pct: 100 },
      },
      {
        name: "Eusuf",
        classification: { label: "Underutilized Staff", reason: "Present review card more often before guest disengages." },
        metrics: { scans_generated: 36, reviews_generated: 76, google_clicks: 17, review_conversion_pct: 22 },
      },
    ],
    comparison: [
      { branch_id: "riyadh", qr_scans: 94, reviews_generated: 199, google_redirects: 48, conversion_pct: 51 },
    ],
  };
  try {
    exportReviewIntelligenceReport(laysen);
    const workbook = write.mock.calls[0][0];
    const staff = XLSX.utils.sheet_to_json(workbook.Sheets.Staff);
    const coaching = XLSX.utils.sheet_to_json(workbook.Sheets.Classifications);
    expect(staff.find((row) => row.Staff === "Atik")["To Google %"]).toBe(200);
    expect(staff.find((row) => row.Staff === "Eusuf")["To Google %"]).toBe(47);
    expect(coaching.find((row) => row.Employee === "Atik")["To Google %"]).toBe(200);
    expect(coaching.find((row) => row.Employee === "Eusuf")["To Google %"]).toBe(47);
    expect(coaching.find((row) => row.Employee === "Eusuf")["Google Redirects"]).toBe(17);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Summary, { header: 1 })).toEqual(
      expect.arrayContaining([["Tap→Google %", 51]]),
    );

    exportCSV.mockClear();
    exportReviewIntelligenceReport({ ...laysen, format: "csv" });
    const [, headers, rows] = exportCSV.mock.calls[0];
    const toGoogle = headers.indexOf("To Google %");
    const name = headers.indexOf("Staff");
    expect(rows.find((row) => row[name] === "Atik")[toGoogle]).toBe(200);
    expect(rows.find((row) => row[name] === "Eusuf")[toGoogle]).toBe(47);
  } finally {
    write.mockRestore();
  }

  const audit = buildBranchOperationalReportFromSummary({
    qr_scans: 94,
    reviews_generated: 199,
    google_redirects: 48,
    staff: [
      { name: "Atik", role: "waiter", scans: 1, generated: 2, google: 2, conversion_pct: 100 },
      { name: "Eusuf", role: "waiter", scans: 36, generated: 76, google: 17, conversion_pct: 47 },
    ],
  }, "riyadh");
  expect(audit.staffRows.find((row) => row.name === "Atik").reviewConv).toBe(200);
  expect(audit.staffRows.find((row) => row.name === "Eusuf").reviewConv).toBe(47);
});
