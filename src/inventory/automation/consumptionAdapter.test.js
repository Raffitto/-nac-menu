import { salesLinesForConsumption, theoreticalIngredientUse } from "./consumptionAdapter";

const inventory = [
  { sku: "sk-1461", name: "French Toast", storageUnit: "Pcs", ingredientUnit: "Pcs", storageToIngredientFactor: "1" },
  { sku: "sk-2492", name: "Toasted Sourdough", storageUnit: "Pcs", ingredientUnit: "Pcs", storageToIngredientFactor: "1" },
  { sku: "sk-0628", name: "NAC-French Toast Soaking Mix", storageUnit: "Batch", ingredientUnit: "Gm", storageToIngredientFactor: "100" },
  { sku: "sk-2375", name: "Fresh Milk", storageUnit: "Gm", ingredientUnit: "Gm", storageToIngredientFactor: "1" },
  { sku: "sk-egg", name: "Egg", storageUnit: "Pcs", ingredientUnit: "Pcs", storageToIngredientFactor: "1" },
];

const components = [
  { parentSku: "sk-1461", childSku: "sk-2492", childName: "Toasted Sourdough", quantity: "2", unit: "Pcs", yieldPercent: "100" },
  { parentSku: "sk-1461", childSku: "sk-0628", childName: "NAC-French Toast Soaking Mix", quantity: "50", unit: "Gm", yieldPercent: "100" },
  { parentSku: "sk-0628", childSku: "sk-2375", childName: "Fresh Milk", quantity: "80", unit: "Gm", yieldPercent: "80" },
  { parentSku: "sk-0628", childSku: "sk-egg", childName: "Egg", quantity: "1", unit: "Pcs", yieldPercent: "100" },
];

test("voids and refunds are not consumed", () => {
  const lines = salesLinesForConsumption([
    { sku: "sk-1461", quantity: "2", status: "completed", unit: "Pcs" },
    { sku: "sk-1461", quantity: "1", status: "void", unit: "Pcs" },
    { sku: "sk-1461", quantity: "-1", status: "refunded", unit: "Pcs" },
  ]);
  expect(lines).toHaveLength(1);
  expect(lines[0].quantity).toBe("2");
});

test("a nested recipe stays theoretical and does not post stock", () => {
  const result = theoreticalIngredientUse({
    branchId: "khobar",
    businessDate: "2026-10-10",
    sales: [{ sku: "sk-1461", name: "French Toast", quantity: "1", unit: "Pcs", status: "completed" }],
    inventory,
    components,
  });
  expect(result.postsStock).toBe(false);
  expect(result.lowerBound).toBe(false);
  expect(result.usage).toEqual(expect.arrayContaining([
    expect.objectContaining({ sku: "sk-2375" }),
    expect.objectContaining({ sku: "sk-egg" }),
  ]));
});

test("a sale with no recipe is a lower bound and invents no quantity", () => {
  const result = theoreticalIngredientUse({
    branchId: "khobar",
    businessDate: "2026-10-10",
    sales: [{ sku: "sk-missing", name: "Unknown Dish", quantity: "1", unit: "Pcs", status: "completed" }],
    inventory,
    components,
  });
  expect(result.postsStock).toBe(false);
  expect(result.status).toBe("LOWER_BOUND");
  expect(result.quantity).toBeNull();
});
