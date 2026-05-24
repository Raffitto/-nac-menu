import {
  branchPublicName,
  branchDashboardName,
  branchExportName,
  resolvePublicBranchFromLocation,
  publicMenuPathForBranch,
} from "./branchDisplayConfig";

describe("branchDisplayConfig", () => {
  test("khobar public brand is NAC", () => {
    expect(branchPublicName("khobar")).toBe("NAC");
    expect(branchDashboardName("khobar")).toBe("NAC");
    expect(branchExportName("khobar")).toBe("Khobar");
  });

  test("riyadh and jeddah have branch-specific public names", () => {
    expect(branchPublicName("riyadh")).toBe("NAC Riyadh");
    expect(branchPublicName("jeddah")).toBe("NAC Jeddah");
  });

  test("resolves future route slugs without migrating links yet", () => {
    expect(resolvePublicBranchFromLocation({ pathname: "/riyadh" })).toBe("riyadh");
    expect(publicMenuPathForBranch("jeddah")).toBe("/jeddah");
  });
});
