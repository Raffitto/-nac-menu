import {
  RBAC_ROLES,
  PERMISSIONS,
  resolveRbacProfile,
  canAccessNav,
  canAccessIntelligenceTab,
  canAccessReviewsTab,
  allowedBranchIds,
  resolveEffectiveBranch,
  filterRowsByBranchScope,
  buildBranchFilterOptions,
  reviewAllowedBranchIds,
  buildReviewBranchFilterOptions,
} from "./rbac";
import {
  operationalBrandDisplay,
  normalizeOperationalBrandLabel,
} from "../utils/branchIdentity";
import { filterRowsByRbacProfile, canFetchCrossBranchComparison } from "../../lib/rbacQueryScope";

function mockSession(email) {
  return { user: { email } };
}

describe("NAC OS RBAC", () => {
  describe("Developer (Raffi)", () => {
    const profile = resolveRbacProfile(mockSession("raffi@nac.com"));

    test("has full branch access", () => {
      expect(profile.role).toBe(RBAC_ROLES.DEVELOPER);
      expect(profile.allBranches).toBe(true);
      expect(allowedBranchIds(profile)).toEqual(["khobar", "riyadh", "jeddah"]);
    });

    test("can access all nav and intelligence surfaces", () => {
      expect(canAccessNav(profile, "branches")).toBe(true);
      expect(canAccessNav(profile, "intelligence")).toBe(true);
      expect(canAccessNav(profile, "food-bible")).toBe(true);
      expect(canAccessIntelligenceTab(profile, "competitive")).toBe(true);
      expect(canAccessIntelligenceTab(profile, "executive")).toBe(true);
      expect(hasPerm(profile, PERMISSIONS.MANAGE_SYSTEM)).toBe(true);
    });

    test("does not filter cross-branch payloads", () => {
      const rows = [
        { branch_id: "khobar", count: 1 },
        { branch_id: "riyadh", count: 2 },
      ];
      expect(filterRowsByBranchScope(profile, rows)).toHaveLength(2);
      expect(canFetchCrossBranchComparison(profile)).toBe(true);
    });
  });

  describe("CEO (Ahmad)", () => {
    const profile = resolveRbacProfile(mockSession("ahmad@nac.com"));

    test("sees all branches without system config", () => {
      expect(profile.role).toBe(RBAC_ROLES.CEO);
      expect(profile.allBranches).toBe(true);
      expect(canAccessNav(profile, "branches")).toBe(true);
      expect(canAccessIntelligenceTab(profile, "executive")).toBe(true);
      expect(hasPerm(profile, PERMISSIONS.MANAGE_SYSTEM)).toBe(false);
      expect(hasPerm(profile, PERMISSIONS.MANAGE_MENU)).toBe(false);
      expect(hasPerm(profile, PERMISSIONS.VIEW_MENU)).toBe(true);
      expect(hasPerm(profile, PERMISSIONS.VIEW_EXECUTIVE_EXPORT)).toBe(true);
    });
  });

  describe("Khobar GM (Fady)", () => {
    const profile = resolveRbacProfile(mockSession("fady@nac.com"));

    test("maps the verified production account", () => {
      const production = resolveRbacProfile(mockSession("fady.aly@nacriyadh.com"));
      expect(production.role).toBe(RBAC_ROLES.BRANCH_GM);
      expect(production.branchScope).toBe("khobar");
    });

    test("preserves built-in review capabilities when production env overrides identity", () => {
      const previous = process.env.REACT_APP_RBAC_USERS;
      process.env.REACT_APP_RBAC_USERS = JSON.stringify([
        {
          emails: ["fady.aly@nacriyadh.com"],
          role: "branch_gm",
          branchScope: "khobar",
          name: "Fady",
        },
      ]);
      try {
        const production = resolveRbacProfile(mockSession("fady.aly@nacriyadh.com"));
        expect(production.permissions).toContain(PERMISSIONS.VIEW_NETWORK_REVIEWS);
        expect(reviewAllowedBranchIds(production)).toEqual(["khobar", "riyadh", "jeddah"]);
      } finally {
        if (previous === undefined) delete process.env.REACT_APP_RBAC_USERS;
        else process.env.REACT_APP_RBAC_USERS = previous;
      }
    });

    test("is scoped to khobar only", () => {
      expect(profile.role).toBe(RBAC_ROLES.BRANCH_GM);
      expect(profile.branchScope).toBe("khobar");
      expect(allowedBranchIds(profile)).toEqual(["khobar"]);
      expect(resolveEffectiveBranch(profile, "riyadh")).toBe("khobar");
      expect(resolveEffectiveBranch(profile, null)).toBe("khobar");
    });

    test("keeps operational data branch-scoped while allowing network reviews", () => {
      expect(canAccessNav(profile, "branches")).toBe(false);
      expect(canAccessIntelligenceTab(profile, "competitive")).toBe(false);
      expect(canAccessReviewsTab(profile, "branches")).toBe(true);
      expect(canFetchCrossBranchComparison(profile)).toBe(false);
      expect(reviewAllowedBranchIds(profile)).toEqual(["khobar", "riyadh", "jeddah"]);
      expect(buildReviewBranchFilterOptions(profile)[0]).toEqual({
        value: "all",
        label: "All branches",
      });
    });

    test("can access branch operational surfaces", () => {
      expect(canAccessNav(profile, "intelligence")).toBe(true);
      expect(canAccessNav(profile, "reviews")).toBe(true);
      expect(canAccessNav(profile, "reports")).toBe(true);
      expect(canAccessNav(profile, "food-bible")).toBe(true);
      expect(canAccessIntelligenceTab(profile, "sales")).toBe(true);
      expect(canAccessIntelligenceTab(profile, "executive")).toBe(true);
      expect(hasPerm(profile, PERMISSIONS.MANAGE_IMPORTS)).toBe(true);
    });

    test("filters hidden branch rows from payloads", () => {
      const rows = [
        { branch_id: "khobar", net_sales: 100 },
        { branch_id: "riyadh", net_sales: 200 },
        { branch_id: "jeddah", net_sales: 50 },
      ];
      const filtered = filterRowsByRbacProfile(profile, rows);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].branch_id).toBe("khobar");
    });

    test("branch filter UI excludes other branches", () => {
      const options = buildBranchFilterOptions(profile);
      expect(options).toEqual([{ value: "khobar", label: "NAC" }]);
    });
  });

  describe("Riyadh GM (Armel)", () => {
    const profile = resolveRbacProfile(mockSession("armel@nac.com"));

    test("is scoped to riyadh only", () => {
      expect(profile.branchScope).toBe("riyadh");
      expect(allowedBranchIds(profile)).toEqual(["riyadh"]);
      expect(resolveEffectiveBranch(profile, "jeddah")).toBe("riyadh");
      expect(reviewAllowedBranchIds(profile)).toEqual(["riyadh"]);
      expect(canAccessReviewsTab(profile, "branches")).toBe(false);
    });
  });

  describe("Jeddah GM (Usama)", () => {
    const profile = resolveRbacProfile(mockSession("usama@nac.com"));

    test("is scoped to jeddah only", () => {
      expect(profile.branchScope).toBe("jeddah");
      expect(allowedBranchIds(profile)).toEqual(["jeddah"]);
      expect(reviewAllowedBranchIds(profile)).toEqual(["jeddah"]);
    });
  });

  describe("branch normalization", () => {
    test("maps NAC Khobar to operational brand NAC", () => {
      expect(operationalBrandDisplay("khobar")).toBe("NAC");
      expect(normalizeOperationalBrandLabel("NAC Khobar")).toBe("NAC");
    });

    test("preserves canonical branch ids internally", () => {
      expect(resolveEffectiveBranch(resolveRbacProfile(mockSession("fady@nac.com")), "khobar")).toBe(
        "khobar",
      );
    });
  });

  describe("unmapped authenticated users", () => {
    const profile = resolveRbacProfile(mockSession("unknown@example.com"));

    test("are restricted with no branch data", () => {
      expect(profile.role).toBe(RBAC_ROLES.RESTRICTED);
      expect(profile.unmapped).toBe(true);
      expect(allowedBranchIds(profile)).toEqual([]);
      expect(canAccessNav(profile, "intelligence")).toBe(false);
      expect(canAccessNav(profile, "food-bible")).toBe(false);
    });
  });
});

function hasPerm(profile, permission) {
  return (profile.permissions || []).includes(permission);
}
