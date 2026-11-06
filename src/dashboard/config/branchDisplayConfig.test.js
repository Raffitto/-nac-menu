import {
  BRANCH_DISPLAY_CONFIG,
  branchPublicName,
  branchDashboardName,
  branchExportName,
  resolvePublicBranchFromLocation,
  publicMenuPathForBranch,
} from "./branchDisplayConfig";
import { branchDisplayName, normalizeBranchId } from "../utils/rangeState";
import { REVIEW_BRANCH_OPTIONS } from "../../review/reviewBranchIdentity";

describe("branchDisplayConfig", () => {
  test("the Khobar guest-menu brand remains NAC while branch labels use its official name", () => {
    expect(branchPublicName("khobar")).toBe("NAC");
    expect(branchDashboardName("khobar")).toBe("NAC Khobar");
    expect(branchExportName("khobar")).toBe("NAC Khobar");
  });

  test("riyadh and jeddah have branch-specific public names", () => {
    expect(branchPublicName("riyadh")).toBe("NAC Laysen Valley");
    expect(branchPublicName("jeddah")).toBe("NAC Jeddah");
  });

  test("all branch-facing labels derive from stable restaurant identities, separate from city", () => {
    const expected = {
      khobar: ["Khobar", "NAC Khobar"],
      riyadh: ["Riyadh", "NAC Laysen Valley"],
      jeddah: ["Jeddah", "NAC Jeddah"],
      hettin: ["Riyadh", "NAC Hettin"],
    };
    for (const [id, [city, label]] of Object.entries(expected)) {
      expect(BRANCH_DISPLAY_CONFIG[id].city).toBe(city);
      expect(branchDashboardName(id)).toBe(label);
      expect(branchExportName(id)).toBe(label);
      expect(branchDisplayName(id)).toBe(label);
      expect(REVIEW_BRANCH_OPTIONS.find((option) => option.id === id)?.label).toBe(label);
    }
    expect(normalizeBranchId("Riyadh")).toBe("riyadh");
    expect(normalizeBranchId("NAC Future Riyadh")).toBeNull();
    expect(normalizeBranchId("NAC Hettin Riyadh")).toBe("hettin");
  });

  test("resolves future route slugs without migrating links yet", () => {
    expect(resolvePublicBranchFromLocation({ pathname: "/riyadh" })).toBe("riyadh");
    expect(publicMenuPathForBranch("jeddah")).toBe("/jeddah");
  });
});
