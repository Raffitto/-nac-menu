import { filterPublicMenuData } from "./menuVisibility";
const item = { id: "2fa6a037-5b2e-4841-a2c4-e5df28a40136", en: "Small Sparkling Water", branch_id: "khobar", price: "17 SAR", active: true, soldOut: false };
const overrides = [{ itemId: item.id, branchId: "khobar", sourceBranchId: "khobar", soldOut: true }];
function render(row, branch, availabilityOverrides = overrides) {
  return filterPublicMenuData({ drinks: [{ items: [row] }] }, Date.now(), { requestedBranchId: branch, availabilityOverrides });
}

test("confirmed Khobar unavailability keeps the card, price and identity, without changing source", () => {
  const result = render(item, "khobar").drinks[0].items[0];
  expect(result).toEqual({ ...item, soldOut: true });
  expect(item.soldOut).toBe(false);
});

test.each(["riyadh", "jeddah", undefined])("shared-source route %s does not inherit the Khobar override", (branch) => {
  expect(render(item, branch).drinks[0].items[0]).toBe(item);
});

test("other items, conflicting branch records and inactive/temporarily hidden items are not reactivated", () => {
  const other = { ...item, id: "another-water" };
  expect(render(other, "khobar").drinks[0].items[0]).toBe(other);
  const conflicting = { ...item, branch_id: "riyadh" };
  expect(render(conflicting, "khobar").drinks[0].items[0]).toBe(conflicting);
  expect(render({ ...item, active: false }, "khobar").drinks).toHaveLength(0);
  expect(render({ ...item, hiddenUntil: "2100-01-01" }, "khobar").drinks).toHaveLength(0);
});

 test("temporary stock decision is never silently enabled or held forever in runtime code", () => {
  expect(render(item, "khobar", []).drinks[0].items[0]).toBe(item);
  expect(render(item, "khobar", [...overrides, ...overrides]).drinks[0].items[0]).toBe(item);
});
