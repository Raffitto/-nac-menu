import { staffFromReviewSummary } from "./reviewSummaryMap";
import { aggregateStaffReviewStats } from "./staffReviewStats";
import { buildBranchReviewComparison, computeReviewKpis } from "./reviewEventMetrics";

describe("review staff attribution", () => {
  test("keeps same-name employees in different restaurants separate", () => {
    const rows = aggregateStaffReviewStats([
      { branch_id: "riyadh", employee_name: "Ali", event_type: "qr_scan" },
      { branch_id: "hettin", employee_name: "Ali", event_type: "qr_scan" },
      { branch_id: "hettin", employee_name: "Ali", event_type: "google_redirect" },
    ]);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Ali", branch: "riyadh", scans: 1, google: 0 }),
      expect.objectContaining({ name: "Ali", branch: "hettin", scans: 1, google: 1 }),
    ]));
    expect(rows).toHaveLength(2);
  });

  test("does not infer synthetic status from an RPC staff name", () => {
    const staff = staffFromReviewSummary({ staff: [
      { branch_id: "riyadh", name: "TEST", scans: 5, google: 0 },
      { branch_id: "hettin", name: "Testa", scans: 2, google: 1 },
      { branch_id: "riyadh", name: "Ali", scans: 1, google: 1 },
    ] });
    expect(staff.map((row) => `${row.branch}::${row.name}`)).toEqual([
      "riyadh::TEST", "hettin::Testa", "riyadh::Ali",
    ]);
  });

  test("raw review metrics exclude only marked self-test events and keep totals aligned", () => {
    const rows = [
      { branch_id: "riyadh", employee_name: "TEST", event_type: "qr_scan", metadata: { self_test: true } },
      { branch_id: "khobar", employee_name: "Ali", event_type: "qr_scan", metadata: { self_test: true } },
      { branch_id: "khobar", employee_name: "Ali", event_type: "qr_scan", metadata: { self_test: "true" } },
      { branch_id: "hettin", employee_name: "Testa", event_type: "qr_scan", metadata: {} },
      { branch_id: "jeddah", employee_name: "TEST", event_type: "qr_scan", metadata: {} },
    ];
    expect(computeReviewKpis(rows).qr_scans).toBe(2);
    expect(buildBranchReviewComparison(rows).find((row) => row.branch_id === "hettin").qr_scans).toBe(1);
    expect(buildBranchReviewComparison(rows).find((row) => row.branch_id === "riyadh").qr_scans).toBe(0);
    expect(buildBranchReviewComparison(rows).find((row) => row.branch_id === "jeddah").qr_scans).toBe(1);
    expect(aggregateStaffReviewStats(rows).map((row) => `${row.branch}::${row.name}`)).toEqual(expect.arrayContaining([
      "hettin::Testa", "jeddah::Test",
    ]));
  });
});
