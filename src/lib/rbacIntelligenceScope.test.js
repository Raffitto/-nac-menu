import { resolveRbacProfile, RBAC_ROLES } from "../dashboard/config/rbac";
import {
  filterCommandCenterPackage,
  filterExecutiveCommandInput,
  filterReviewIntelligenceInput,
  buildBranchComparisonForProfile,
  buildReviewBranchComparisonForProfile,
  commandCenterPulseTitle,
  rbacScopeCacheKey,
  operationalBranchIdsForProfile,
} from "./rbacIntelligenceScope";

describe("rbacIntelligenceScope", () => {
  const branchGm = resolveRbacProfile({ user: { email: "armel@nac.com" } });
  const ceo = resolveRbacProfile({ user: { email: "ahmad@nac.com" } });

  test("branch GM only sees assigned branch in command center package", () => {
    expect(branchGm.role).toBe(RBAC_ROLES.BRANCH_GM);
    const pkg = filterCommandCenterPackage(
      {
        branchStatus: [
          { branch_id: "riyadh", branch_name: "NAC" },
          { branch_id: "khobar", branch_name: "Riyadh" },
        ],
        alerts: [
          { id: "a1", branch_id: "khobar", severity: "risk", text: "Riyadh alert" },
          { id: "a2", branch_id: "riyadh", severity: "info", text: "Khobar ok" },
        ],
        rankings: [
          { branch_id: "riyadh", operational_score: 80 },
          { branch_id: "jeddah", operational_score: 60 },
        ],
        heatmap: { rows: [{ branch_id: "jeddah" }, { branch_id: "riyadh" }] },
      },
      branchGm,
    );
    expect(pkg.branchStatus).toHaveLength(1);
    expect(pkg.branchStatus[0].branch_id).toBe("riyadh");
    expect(pkg.alerts).toHaveLength(1);
    expect(pkg.alerts[0].branch_id).toBe("riyadh");
    expect(pkg.rankings).toHaveLength(1);
    expect(pkg.heatmap.rows).toHaveLength(1);
  });

  test("CEO retains network visibility", () => {
    expect(ceo.allBranches).toBe(true);
    expect(operationalBranchIdsForProfile(ceo).length).toBeGreaterThan(1);
  });

  test("filterExecutiveCommandInput strips foreign branches before package build", () => {
    const input = filterExecutiveCommandInput(
      {
        branchComparison: [
          { branch_id: "riyadh" },
          { branch_id: "jeddah" },
        ],
        staffByBranch: { riyadh: [], jeddah: [] },
      },
      branchGm,
    );
    expect(input.branchComparison).toHaveLength(1);
    expect(input.branchComparison[0].branch_id).toBe("riyadh");
    expect(Object.keys(input.staffByBranch)).toEqual(["riyadh"]);
  });

  test("commandCenterPulseTitle is branch-scoped for GM", () => {
    expect(commandCenterPulseTitle(branchGm)).toMatch(/operational pulse/i);
    expect(commandCenterPulseTitle(ceo)).toBe("Network operational pulse");
  });

  test("buildBranchComparisonForProfile omits hidden zero branches for GM", () => {
    const rows = buildBranchComparisonForProfile(branchGm, [
      { branch_id: "riyadh", qr_scans: 40, google_redirects: 10 },
      { branch_id: "jeddah", qr_scans: 0, google_redirects: 0 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].branch_id).toBe("riyadh");
  });

  test("reviews-only capability retains network review rows without widening operations", () => {
    const rows = [
      { branch_id: "riyadh", qr_scans: 40 },
      { branch_id: "khobar", qr_scans: 2 },
      { branch_id: "jeddah", qr_scans: 21 },
    ];
    expect(buildBranchComparisonForProfile(branchGm, rows)).toHaveLength(1);
    expect(buildReviewBranchComparisonForProfile(branchGm, rows)).toHaveLength(3);

    const reviewInput = filterReviewIntelligenceInput(
      {
        branchComparison: rows,
        staffByBranch: { khobar: [], riyadh: [], jeddah: [] },
      },
      branchGm,
    );
    expect(reviewInput.networkWide).toBe(true);
    expect(Object.keys(reviewInput.staffByBranch)).toEqual([
      "khobar",
      "riyadh",
      "jeddah",
    ]);
  });

  test("filterCommandCenterPackage removes network alerts and timeline for GM", () => {
    const pkg = filterCommandCenterPackage(
      {
        branchStatus: [{ branch_id: "riyadh", branch_name: "NAC", momentum: "Stable", google_redirects: 5, participation_breadth: 50, operational_score: 70, health: { id: "healthy", label: "Healthy" } }],
        branchScores: [{ branch_id: "riyadh", score: 70 }],
        scoreByBranch: { riyadh: { score: 70 } },
        alerts: [
          { id: "net", severity: "info", text: "Network review redirect momentum is rising." },
          { id: "jed", severity: "risk", text: "Jeddah alert", branch_id: "jeddah" },
          { id: "kho", severity: "info", text: "Khobar ok", branch_id: "riyadh" },
        ],
        timeline: [
          { time: "00:00", text: "Network handoff pulse", kind: "pulse" },
          { time: "00:15", text: "Khobar spike", kind: "spike", branch_id: "riyadh" },
        ],
        heatmap: { rows: [{ branch_id: "riyadh" }, { branch_id: "jeddah" }] },
      },
      branchGm,
    );
    expect(pkg.alerts.every((a) => a.branch_id === "khobar")).toBe(true);
    expect(pkg.timeline.every((t) => t.kind !== "network")).toBe(true);
    expect(pkg.heatmap.mode).toBe("single");
    expect(rbacScopeCacheKey(branchGm)).toBe("riyadh");
    expect(rbacScopeCacheKey(ceo)).toBe("network");
  });
});
