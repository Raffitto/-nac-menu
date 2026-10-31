import * as XLSX from "xlsx";
import { buildEmployeePerformance } from "./employeePerformanceEngine";
import { exportReviewIntelligenceReport } from "./exportEngine";
import { exportCSV } from "../utils/formatters";
import { staffFromReviewSummary } from "../utils/reviewSummaryMap";

import { buildBranchOperationalReportFromSummary } from "./branchOperationalReviewEngine";

jest.mock("../utils/formatters", () => {
  const actual = jest.requireActual("../utils/formatters");
  return { ...actual, exportCSV: jest.fn() };
});

test("same-named staff retain separate branch classifications", () => {
  const rows = buildEmployeePerformance([
    { name: "Sam", branch: "hettin", opens: 12, qr_visits: 12, converted_visits: 5, generated: 10, google_clicks: 5 },
    { name: "Sam", branch: "riyadh", opens: 1, qr_visits: 1, converted_visits: 0, generated: 0, google_clicks: 0 },
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

test("XLSX, CSV, coaching and branch audit preserve visit conversion and raw diagnostics", () => {
  const summary = { qr_visits: 37, converted_visits: 15, qr_scans: 37, google_redirects: 19, staff: [
    { branch_id: "riyadh", name: "Atik", scans: 1, google: 2, qr_visits: 1, converted_visits: 1, unmatched_redirects: 1 },
    { branch_id: "riyadh", name: "Eusuf", scans: 36, generated: 76, google: 17, qr_visits: 36, converted_visits: 14 },
  ] };
  const staffStats = staffFromReviewSummary(summary);
  const employees = buildEmployeePerformance(staffStats.map(s => ({...s, opens:s.scans, google_clicks:s.google})));
  const write = jest.spyOn(XLSX, "writeFile").mockImplementation(() => {});
  const ctx = { branch:"NAC Laysen Valley", selectedRange:"month", rangeLabel:"October", review:summary, staffStats, employees };
  try {
    exportReviewIntelligenceReport(ctx);
    const wb = write.mock.calls[0][0];
    const staff = XLSX.utils.sheet_to_json(wb.Sheets.Staff);
    const coaching = XLSX.utils.sheet_to_json(wb.Sheets.Classifications);
    for (const rows of [staff,coaching]) {
      expect(rows[0]["Visit conversion %"]).toBe(100);
      expect(rows[1]["Visit conversion %"]).toBe(39);
    }
    expect(staff[0]["Raw Google redirect events"]).toBe(2);
    exportReviewIntelligenceReport({...ctx,format:"csv"});
    const [,headers,rows] = exportCSV.mock.calls.at(-1);
    expect(rows[0][headers.indexOf("Visit conversion %")]).toBe(100);
    const audit = buildBranchOperationalReportFromSummary(summary,"riyadh");
    expect(audit.staffRows.find(s=>s.name==="Eusuf").reviewConv).toBe(39);
  } finally { write.mockRestore(); }
});

 test("legacy counts cannot establish visit conversion", () => {
   const staff = staffFromReviewSummary({staff:[{name:"Atik",branch_id:"riyadh",scans:1,google:2}]});
   expect(staff[0].conversion_pct).toBeNull();
 });
