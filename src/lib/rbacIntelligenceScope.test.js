import { resolveRbacProfile, RBAC_ROLES } from "../dashboard/config/rbac";
import {
  filterCommandCenterPackage,
  filterExecutiveCommandInput,
  buildBranchComparisonForProfile,
  commandCenterPulseTitle,
  rbacScopeCacheKey,
  operationalBranchIdsForProfile,
} from "./rbacIntelligenceScope";

describe("rbacIntelligenceScope", () => {
  const fady = resolveRbacProfile({ user: { email: "fady@nac.com" } });
  const ceo = resolveRbacProfile({ user: { email: "ahmad@nac.com" } });

  test("branch GM only sees assigned branch in command center package", () => {
    expect(fady.role).toBe(RBAC_ROLES.BRANCH_GM);
    const pkg = filterCommandCenterPackage(
      {
        branchStatus: [
          { branch_id: "khobar", branch_name: "NAC" },
          { branch_id: "riyadh", branch_name: "Riyadh" },
        ],
        alerts: [
          { id: "a1", branch_id: "riyadh", severity: "risk", text: "Riyadh alert" },
          { id: "a2", branch_id: "khobar", severity: "info", text: "Khobar ok" },
        ],
        rankings: [
          { branch_id: "khobar", operational_score: 80 },
          { branch_id: "jeddah", operational_score: 60 },
        ],
        heatmap: { rows: [{ branch_id: "jeddah" }, { branch_id: "khobar" }] },
      },
      fady,
    );
    expect(pkg.branchStatus).toHaveLength(1);
    expect(pkg.branchStatus[0].branch_id).toBe("khobar");
    expect(pkg.alerts).toHaveLength(1);
    expect(pkg.alerts[0].branch_id).toBe("khobar");
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
          { branch_id: "khobar" },
          { branch_id: "jeddah" },
        ],
        staffByBranch: { khobar: [], jeddah: [] },
      },
      fady,
    );
    expect(input.branchComparison).toHaveLength(1);
    expect(input.branchComparison[0].branch_id).toBe("khobar");
    expect(Object.keys(input.staffByBranch)).toEqual(["khobar"]);
  });

  test("commandCenterPulseTitle is branch-scoped for GM", () => {
    expect(commandCenterPulseTitle(fady)).toMatch(/operational pulse/i);
    expect(commandCenterPulseTitle(ceo)).toBe("Network operational pulse");
  });

  test("buildBranchComparisonForProfile omits hidden zero branches for GM", () => {
    const rows = buildBranchComparisonForProfile(fady, [
      { branch_id: "khobar", qr_scans: 40, google_redirects: 10 },
      { branch_id: "jeddah", qr_scans: 0, google_redirects: 0 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].branch_id).toBe("khobar");
  });

  test("filterCommandCenterPackage removes network alerts and timeline for GM", () => {
    const pkg = filterCommandCenterPackage(
      {
        branchStatus: [{ branch_id: "khobar", branch_name: "NAC", momentum: "Stable", google_redirects: 5, participation_breadth: 50, operational_score: 70, health: { id: "healthy", label: "Healthy" } }],
        branchScores: [{ branch_id: "khobar", score: 70 }],
        scoreByBranch: { khobar: { score: 70 } },
        alerts: [
          { id: "net", severity: "info", text: "Network review redirect momentum is rising." },
          { id: "jed", severity: "risk", text: "Jeddah alert", branch_id: "jeddah" },
          { id: "kho", severity: "info", text: "Khobar ok", branch_id: "khobar" },
        ],
        timeline: [
          { time: "00:00", text: "Network handoff pulse", kind: "pulse" },
          { time: "00:15", text: "Khobar spike", kind: "spike", branch_id: "khobar" },
        ],
        heatmap: { rows: [{ branch_id: "khobar" }, { branch_id: "jeddah" }] },
      },
      fady,
    );
    expect(pkg.alerts.every((a) => a.branch_id === "khobar")).toBe(true);
    expect(pkg.timeline.every((t) => t.kind !== "network")).toBe(true);
    expect(pkg.heatmap.mode).toBe("single");
    expect(rbacScopeCacheKey(fady)).toBe("khobar");
    expect(rbacScopeCacheKey(ceo)).toBe("network");
  });
});
