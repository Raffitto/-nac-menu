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

test("independent catalogue release flag uses each requested branch and rejects unscoped reads", () => {
  const original = process.env.REACT_APP_GUEST_CATALOGUE_MODE;
  try {
    process.env.REACT_APP_GUEST_CATALOGUE_MODE = "branch";
    for (const branch of ["khobar", "riyadh", "jeddah"]) expect(guestCatalogueBranchId(branch)).toBe(branch);
    expect(() => guestCatalogueBranchId(null)).toThrow("valid branch");
    expect(() => guestCatalogueBranchId("unknown")).toThrow("valid branch");
    expect(guestCatalogueBranchId("riyadh", { shareKhobar: true })).toBe("khobar");
  } finally {
    if (original === undefined) delete process.env.REACT_APP_GUEST_CATALOGUE_MODE;
    else process.env.REACT_APP_GUEST_CATALOGUE_MODE = original;
  }
});
