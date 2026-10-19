import { guestCatalogueBranchId, SHARED_GUEST_CATALOGUE_BRANCH_ID } from "./guestCatalogueBranch";

test("Khobar, Riyadh, and Jeddah guest menus read the same catalogue", () => {
  expect(guestCatalogueBranchId("khobar")).toBe(SHARED_GUEST_CATALOGUE_BRANCH_ID);
  expect(guestCatalogueBranchId("riyadh")).toBe("khobar");
  expect(guestCatalogueBranchId("jeddah")).toBe("khobar");
  expect(guestCatalogueBranchId("riyadh")).toBe(guestCatalogueBranchId("jeddah"));
});

test("a branch can show its own stored catalogue again without a migration", () => {
  expect(guestCatalogueBranchId("riyadh", { shareKhobar: false })).toBe("riyadh");
  expect(guestCatalogueBranchId("jeddah", { shareKhobar: false })).toBe("jeddah");
});
