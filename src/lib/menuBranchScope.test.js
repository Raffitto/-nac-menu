import {
  assertMenuBranchAccess,
  lockBranchIdOnPayload,
  canManageGlobalAddOns,
  resolveMenuEditorBranch,
} from "./menuBranchScope";

describe("menuBranchScope", () => {
  const khobarGm = {
    authenticated: true,
    allBranches: false,
    branchScope: "khobar",
    permissions: ["manage:menu"],
  };
  const admin = {
    authenticated: true,
    allBranches: true,
    branchScope: null,
    permissions: ["manage:menu"],
  };

  test("branch GM cannot access another branch", () => {
    expect(() => assertMenuBranchAccess(khobarGm, "riyadh")).toThrow(/assigned branch/i);
    expect(assertMenuBranchAccess(khobarGm, "khobar")).toBe("khobar");
  });

  test("lockBranchIdOnPayload pins branch for branch managers", () => {
    const locked = lockBranchIdOnPayload({ name_en: "Test", branch_id: "riyadh" }, "khobar", khobarGm);
    expect(locked.branch_id).toBe("khobar");
    const adminPayload = lockBranchIdOnPayload({ branch_id: "riyadh" }, "khobar", admin);
    expect(adminPayload.branch_id).toBe("riyadh");
  });

  test("resolveMenuEditorBranch respects RBAC scope", () => {
    expect(resolveMenuEditorBranch(khobarGm, "riyadh")).toBe("khobar");
    expect(resolveMenuEditorBranch(admin, "jeddah")).toBe("jeddah");
  });

  test("canManageGlobalAddOns only for network admins", () => {
    expect(canManageGlobalAddOns(khobarGm)).toBe(false);
    expect(canManageGlobalAddOns(admin)).toBe(true);
  });
});
