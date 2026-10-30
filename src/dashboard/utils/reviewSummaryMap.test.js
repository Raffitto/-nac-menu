import { branchComparisonFromReviewSummary, kpisFromReviewSummary, staffFromReviewSummary } from "./reviewSummaryMap";
import { aggregateStaffReviewStats } from "./staffReviewStats";
import { buildBranchReviewComparison, computeReviewKpis } from "./reviewEventMetrics";

describe("review staff attribution", () => {
  test("standard-period RPC counts remain raw while display conversion matches Team", () => {
    const summary = {
      qr_scans: 1, reviews_generated: 2, google_redirects: 2, conversion_pct: 200,
      staff: [{ branch_id: "riyadh", name: "Atik", scans: 1, generated: 2, google: 2, conversion_pct: 200 }],
    };
    expect(kpisFromReviewSummary(summary)).toMatchObject({
      qr_scans: 1, reviews_generated: 2, google_redirects: 2, conversion_pct: 100,
    });
    expect(staffFromReviewSummary(summary)[0]).toMatchObject({
      branch: "riyadh", scans: 1, generated: 2, google: 2, conversion_pct: 100,
    });
    expect(summary.staff[0].conversion_pct).toBe(200); // Source evidence is never rewritten.
  });

  test("all four branch export rows preserve counts and derive the dashboard metric", () => {
    const inputs = [
      ["khobar", 355, 617, 265],
      ["riyadh", 94, 199, 48],
      ["jeddah", 333, 453, 300],
      ["hettin", 1, 1, 2],
    ];
    const rows = branchComparisonFromReviewSummary({ by_branch: inputs.map(([branch_id, qr_scans, reviews_generated, google_redirects]) => ({
      branch_id, qr_scans, reviews_generated, google_redirects, conversion_pct: 200,
    })) });
    for (const [id, scans, interactions, redirects] of inputs) {
      expect(rows.find((row) => row.branch_id === id)).toMatchObject({
        qr_scans: scans, reviews_generated: interactions, google_redirects: redirects,
      });
    }
    expect(rows.find((row) => row.branch_id === "hettin").conversion_pct).toBe(100);
    expect(rows.find((row) => row.branch_id === "riyadh").conversion_pct).toBe(51);
  });
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
