/**
 * Read-only Foodics facts captured from console.foodics.com on 2026-11-06.
 * Nothing here is written back to Foodics or to the guest menu.
 * A shared SKU is not a shared identity: all 459 overlapping SKUs had different names.
 */

export const FOODICS_READONLY_SNAPSHOT = Object.freeze({
  readAt: "2026-11-06",
  products: 713,
  activeProducts: 559,
  inventoryItems: 1672,
  modifiers: 88,
  categories: 78,
  groups: 96,
  combos: 0,
  skuOverlapsSameName: 0,
  skuOverlapsDifferentName: 459,
});

export function foodicsRecordsShareIdentity(left, right) {
  if (!left || !right) return false;
  const sameType = left.entityType && left.entityType === right.entityType;
  const sameId = left.id && left.id === right.id;
  return Boolean(sameType && sameId);
}

export const LIVE_FOODICS_OBSERVATIONS = Object.freeze([
  {
    menuName: "2 eggs any style",
    foodicsId: "97c447cd-37e3-4f28-8942-dfd811fa5a4f",
    sku: "sk-1320",
    name: "2 Eggs any style",
    priceSar: 31,
    calories: 461,
    inactiveSiblingSku: "sk-2364",
    note: "Active record. Printed menu calorie is 461.4. Direct ingredient list is empty; preparation sits on the Eggs Cook modifier.",
  },
  {
    menuName: "Big NAC",
    foodicsId: "a1dd13cd-5c4e-48f3-a40e-8c8d2fa2f3d3",
    sku: "sk-2457",
    name: "Big NAC",
    priceSar: 69,
    calories: null,
    inactiveSiblingSku: "sk-1955",
    note: "Active record has 8 ingredients. Foodics has no calorie. The printed menu says 1115.",
  },
  {
    menuName: "Speculoos French toast",
    foodicsId: "97355136-ee5a-4553-9cc6-d460a294bc88",
    sku: "sk-0647",
    name: "French Toast",
    priceSar: 55,
    calories: 462,
    note: "Matches the dessert PDF price and calorie. A second active French Toast, sk-1461, is 61 SAR and 503 cal and must stay separate.",
  },
]);

export function activeFrenchToastProducts() {
  return [
    { id: "97e5f6a4-cf62-4e1d-9638-2e50b2bc24e2", sku: "sk-1461", priceSar: 61, calories: 503 },
    { id: "97355136-ee5a-4553-9cc6-d460a294bc88", sku: "sk-0647", priceSar: 55, calories: 462 },
  ];
}
