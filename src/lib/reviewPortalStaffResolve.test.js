import { parseReviewPortalParams, buildReviewTrackingContext } from "./reviewPortalParams";
import {
  findReviewPortalStaffBySlug,
  getStaffLookupKey,
  normalizeStaffSlug,
  resolveReviewPortalStaff,
} from "./reviewPortalStaffResolve";
import { canonName } from "../review/reviewGeneratorShared";

const RIYADH_STAFF = [
  {
    branch_id: "riyadh",
    employee_name: "Armel",
    role: "gm",
    url_slug: "masud-ali",
    active: true,
  },
];

describe("reviewPortalStaffResolve", () => {
  test("?s=masud-ali resolves to DB row for branch staff list", () => {
    const params = parseReviewPortalParams(
      "?store=riyadh&s=masud-ali&role=waiter&app=review",
    );
    expect(params.normalizedBranch).toBe("riyadh");
    expect(getStaffLookupKey(params)).toBe("masud-ali");

    const resolved = resolveReviewPortalStaff(params, RIYADH_STAFF);
    expect(resolved.matched).toBe(true);
    expect(resolved.employeeName).toBe("Armel");
    expect(resolved.employeeRole).toBe("gm");
  });

  test("DB role overrides URL role when slug match exists", () => {
    const params = parseReviewPortalParams("?s=masud-ali&role=waiter&store=riyadh");
    const resolved = resolveReviewPortalStaff(params, RIYADH_STAFF);
    expect(resolved.employeeRole).toBe("gm");
    expect(resolved.employeeRole).not.toBe("waiter");

    const tracking = buildReviewTrackingContext(params, {
      employeeName: resolved.employeeName,
      employeeRole: resolved.employeeRole,
    });
    expect(tracking.employee_name).toBe("Armel");
    expect(tracking.employee_role).toBe("gm");
  });

  test("falls back to literal name when no DB row exists", () => {
    const params = parseReviewPortalParams("?s=masud-ali&role=waiter&store=riyadh");
    const resolved = resolveReviewPortalStaff(params, []);
    expect(resolved.matched).toBe(false);
    expect(resolved.employeeName).toBe("masud-ali");
    expect(resolved.employeeRole).toBe("waiter");
    expect(canonName(resolved.employeeName)).toBe("Masud-ali");

    const tracking = buildReviewTrackingContext(params, {
      employeeName: resolved.employeeName,
      employeeRole: resolved.employeeRole,
    });
    expect(tracking.employee_name).toBe("Masud-ali");
    expect(tracking.employee_role).toBe("waiter");
  });

  test("slug-only route resolves from review_portal_staff", () => {
    const params = parseReviewPortalParams("?slug=masud-ali&store=riyadh");
    expect(params.employeeName).toBeNull();
    expect(getStaffLookupKey(params)).toBe("masud-ali");

    const resolved = resolveReviewPortalStaff(params, RIYADH_STAFF);
    expect(resolved.matched).toBe(true);
    expect(resolved.employeeName).toBe("Armel");
    expect(resolved.employeeRole).toBe("gm");
  });

  test("normalizeStaffSlug matches case-insensitively", () => {
    expect(normalizeStaffSlug("Masud-Ali")).toBe("masud-ali");
    const match = findReviewPortalStaffBySlug(RIYADH_STAFF, "MASUD-ALI");
    expect(match?.employee_name).toBe("Armel");
  });

  test("literal display name QR still works when slug does not match", () => {
    const params = parseReviewPortalParams(
      "?store=NAC%20Khobar&s=Boy%20Boy&role=receptionist",
    );
    const resolved = resolveReviewPortalStaff(params, RIYADH_STAFF);
    expect(resolved.matched).toBe(false);
    expect(resolved.employeeName).toBe("Boy Boy");

    const tracking = buildReviewTrackingContext(params, {
      employeeName: resolved.employeeName,
      employeeRole: resolved.employeeRole,
    });
    expect(tracking.employee_name).toBe("Boyboy");
  });
});
