import { resolveReviewScope, assertReviewDataIntegrity } from "./unifiedReviewTruth";

const ceoProfile = {
  authenticated: true,
  allBranches: true,
  branchScope: null,
};

const gmProfile = {
  authenticated: true,
  allBranches: false,
  branchScope: "khobar",
};

describe("unifiedReviewTruth", () => {
  it("CEO with no branch filter uses network scope", () => {
    const scope = resolveReviewScope(ceoProfile, null);
    expect(scope.networkWide).toBe(true);
    expect(scope.queryBranch).toBeNull();
  });

  it("CEO with explicit branch filter uses branch scope", () => {
    const scope = resolveReviewScope(ceoProfile, "riyadh");
    expect(scope.networkWide).toBe(false);
    expect(scope.queryBranch).toBe("riyadh");
  });

  it("branch GM is always scoped", () => {
    const scope = resolveReviewScope(gmProfile, null);
    expect(scope.networkWide).toBe(false);
    expect(scope.queryBranch).toBe("khobar");
  });

  it("flags insight vs table mismatch", () => {
    const result = assertReviewDataIntegrity({
      networkWide: true,
      branchComparison: [{ branch_id: "riyadh", qr_scans: 0, google_redirects: 0 }],
      staffMerged: [{ branch: "riyadh", name: "Sopon", scans: 12, google: 8 }],
      staffInsights: [{ branch_id: "riyadh", text: "Riyadh relies heavily on Sopon" }],
    });
    expect(result.ok).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
