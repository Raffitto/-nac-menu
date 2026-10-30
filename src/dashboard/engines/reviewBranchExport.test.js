import * as XLSX from "xlsx";
import { buildEmployeePerformance } from "./employeePerformanceEngine";
import { exportReviewIntelligenceReport } from "./exportEngine";
import { staffFromReviewSummary, kpisFromReviewSummary, branchComparisonFromReviewSummary } from "../utils/reviewSummaryMap";
import { aggregateStaffReviewStats } from "../utils/staffReviewStats";
import { resolveExportRange } from "../utils/exportRangeState";
import { resolveReviewScope } from "../../lib/unifiedReviewTruth";
import { buildBranchOperationalReportFromSummary, buildBranchOperationalReport } from "./branchOperationalReviewEngine";
import { reviewExportBranchForScope } from "../reviews/useReviewExports";

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

test("standard-period exports keep Atik's raw 1 scan and 2 redirects while matching dashboard conversion", () => {
  const summary = {
    qr_scans: 1, reviews_generated: 2, google_redirects: 2, conversion_pct: 200,
    staff: [{ name: "Atik", role: "waiter", branch_id: "riyadh", scans: 1, generated: 2, google: 2, conversion_pct: 200 }],
    by_branch: [{ branch_id: "riyadh", qr_scans: 1, reviews_generated: 2, google_redirects: 2, conversion_pct: 200 }],
  };
  const staffStats = staffFromReviewSummary(summary);
  const employees = buildEmployeePerformance(staffStats.map((s) => ({
    name: s.name, branch: s.branch, opens: s.scans, generated: s.generated, google_clicks: s.google,
  })));
  const write = jest.spyOn(XLSX, "writeFile").mockImplementation(() => {});
  try {
    exportReviewIntelligenceReport({
      branch: "NAC Laysen Valley", selectedRange: "month", rangeLabel: "Month-to-date",
      review: { qr_scans: 1, reviews_generated: 2, google_clicks: 2, conversion_pct: kpisFromReviewSummary(summary).conversion_pct },
      staffStats, employees, comparison: branchComparisonFromReviewSummary(summary),
    });
    const workbook = write.mock.calls[0][0];
    const staff = XLSX.utils.sheet_to_json(workbook.Sheets.Staff);
    const coaching = XLSX.utils.sheet_to_json(workbook.Sheets.Classifications);
    expect(staff[0]).toMatchObject({ "Review QR scans": 1, "Google Redirects": 2, "To Google %": 100 });
    expect(coaching[0]).toMatchObject({ "Review interactions": 2, "To Google %": 100 });
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Summary, { header: 1 })).toContainEqual(["Google Redirects", 2]);
  } finally {
    write.mockRestore();
  }
});

test("Eusuf coaching uses card taps, not interactions, and custom raw-event export agrees", () => {
  const eusuf = buildEmployeePerformance([{ name: "Eusuf", branch: "riyadh", opens: 36, generated: 76, google_clicks: 17 }])[0];
  expect(eusuf.metrics).toMatchObject({ scans_generated: 36, reviews_generated: 76, google_clicks: 17, review_conversion_pct: 47 });
  const rows = aggregateStaffReviewStats([
    { branch_id: "riyadh", employee_name: "Atik", event_type: "qr_scan" },
    { branch_id: "riyadh", employee_name: "Atik", event_type: "google_redirect" },
    { branch_id: "riyadh", employee_name: "Atik", event_type: "google_redirect" },
    { branch_id: "riyadh", employee_name: "Atik", event_type: "qr_scan", metadata: { self_test: true } },
  ]);
  expect(rows[0]).toMatchObject({ scans: 1, google: 2, conversion_pct: 100 });
  expect(resolveExportRange({ preset: "month" }).useRpc).toBe(true);
  expect(resolveExportRange({ preset: "custom", startDate: "2026-10-01", endDate: "2026-10-30" }).useRpc).toBe(false);
});

test("branch audit PDF model uses the Team metric for standard and custom periods", () => {
  const summary = {
    qr_scans: 36, reviews_generated: 76, google_redirects: 17,
    staff: [{ branch_id: "riyadh", name: "Eusuf", scans: 36, generated: 76, google: 17, conversion_pct: 22 }],
  };
  const standard = buildBranchOperationalReportFromSummary(summary, "riyadh");
  expect(standard.staffRows[0]).toMatchObject({ scans: 36, generated: 76, google: 17, reviewConv: 47 });

  const customEvents = [
    ...Array.from({ length: 36 }, () => ({ branch_id: "riyadh", employee_name: "Eusuf", event_type: "qr_scan" })),
    ...Array.from({ length: 76 }, () => ({ branch_id: "riyadh", employee_name: "Eusuf", event_type: "review_generate" })),
    ...Array.from({ length: 17 }, () => ({ branch_id: "riyadh", employee_name: "Eusuf", event_type: "google_redirect" })),
  ];
  const custom = buildBranchOperationalReport(customEvents, "riyadh");
  expect(custom.staffRows[0]).toMatchObject({ scans: 36, generated: 76, google: 17, reviewConv: 47 });
});

test.each(["khobar", "riyadh", "jeddah", "hettin"])("branch-restricted exports cannot use another restaurant's scope: %s", (branch) => {
  const scope = resolveReviewScope({ authenticated: true, allBranches: false, branchScope: branch }, "hettin");
  expect(scope.networkWide).toBe(false);
  expect(scope.queryBranch).toBe(branch);
  expect(reviewExportBranchForScope(scope)).toBe(branch);
});
