import { isActiveBigNac, isRetiredBigNac, presentGuestMenuItem } from "./canonicalGuestCatalogue";
import { filterPublicMenuData } from "./menuVisibility";

const currentId = "09553dff-7c0e-4255-ae8a-9c5e5bd57301";

test("confirmed current identity survives editable price, calories and name without overwriting them", () => {
  const row = { id: currentId, branch_id: "khobar", en: "Big NAC New", price: "71 SAR", calories: 1116, active: true };
  expect(isActiveBigNac(row)).toBe(true);
  expect(presentGuestMenuItem(row)).toEqual({ ...row, en: "Big NAC" });
  expect(row.en).toBe("Big NAC New");
});

test("an unbound historical-looking name is never rewritten into the current product", () => {
  const row = { id: "unbound", branch_id: "riyadh", en: "Big Nac", price: "68", calories: 1100, active: true };
  expect(isActiveBigNac(row)).toBe(false);
  expect(isRetiredBigNac(row)).toBe(false); // insufficient identity evidence
  expect(presentGuestMenuItem(row)).toBe(row);
  const filtered = filterPublicMenuData({ evening: [{ items: [row] }] });
  expect(filtered.evening[0].items[0]).toEqual(row);
});

test("explicit retired external identity remains historical and is not relabelled", () => {
  const row = { en: "Big Nac", foodics_product_id: "99d6f9bd-434f-4289-8972-62b9781ee8cc", price: "68" };
  expect(isRetiredBigNac(row)).toBe(true);
  expect(presentGuestMenuItem(row)).toBe(row);
  expect(filterPublicMenuData({ evening: [{ items: [row] }] }).evening).toHaveLength(0);
  expect(row.price).toBe("68");
});

test("cross-branch or conflicting external identity cannot borrow an observed Khobar binding", () => {
  expect(isActiveBigNac({ id: currentId, branch_id: "riyadh" })).toBe(false);
  expect(isActiveBigNac({ id: currentId, foodics_product_id: "99d6f9bd-434f-4289-8972-62b9781ee8cc" })).toBe(false);
});
