import { explodeRecipe } from "./recipeExplosion";
import { marlonItemByName } from "./marlonRegistry";
import { resolveCanonicalIdentity } from "./identityResolution";
import { explainTheoreticalConsumption, theoreticalConsumption } from "./theoreticalConsumption";
import { classifyWastageEvent } from "./wastageClassification";

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

describe("restaurant intelligence foundation", () => {
  test("explodes French Toast without posting stock or double-counting the mix", () => {
    const result = explodeRecipe({
      lines: [{ sku: "sk-1461", name: "French Toast", quantity: "1", unit: "Pcs" }],
      inventory,
      components,
    });
    expect(result.postsStock).toBe(false);
    expect(result.complete).toBe(true);
    expect(result.totals).toEqual(expect.arrayContaining([
      expect.objectContaining({ sku: "sk-2492", quantity: "2", unit: "each" }),
      expect.objectContaining({ sku: "sk-2375", quantity: "50", unit: "gram" }),
      expect.objectContaining({ sku: "sk-egg", quantity: "0.5", unit: "each" }),
    ]));
    expect(result.totals.some((row) => row.sku === "sk-0628")).toBe(false);
  });

  test("stops a circular recipe", () => {
    const result = explodeRecipe({
      lines: [{ sku: "sk-1461", name: "French Toast", quantity: "1", unit: "Pcs" }],
      inventory,
      components: [
        ...components.filter((row) => row.parentSku !== "sk-0628"),
        { parentSku: "sk-0628", childSku: "sk-1461", childName: "French Toast", quantity: "1", unit: "Pcs", yieldPercent: "100" },
      ],
    });
    expect(result.issues.map((issue) => issue.code)).toContain("CIRCULAR");
    expect(result.complete).toBe(false);
  });

  test("does not invent a SKU for Sumac Powder", () => {
    expect(marlonItemByName("Sumac Powder")).toEqual({
      status: "unresolved",
      sku: null,
      reason: "item-master SKU is blank",
    });
    expect(marlonItemByName("French Toast").sku).toBe("sk-1461");
  });

  test("a name-only match stays a candidate", () => {
    const result = resolveCanonicalIdentity({ supplierId: "eco", name: "Paper bag" });
    expect(result.state).toBe("candidate");
    expect(result.canonicalId).toBeNull();
  });

  test("theoretical consumption keeps a null cost null", () => {
    const result = theoreticalConsumption({
      branchId: "khobar",
      businessDate: "2026-10-11",
      sales: [{ sku: "sk-1461", name: "French Toast", quantity: "2", unit: "Pcs" }],
      inventory,
      components,
      costs: [{ sku: "sk-2375", unitCost: null }],
    });
    expect(result.postsStock).toBe(false);
    expect(result.usage.find((row) => row.sku === "sk-2492").quantity).toBe("4");
    expect(result.usage.find((row) => row.sku === "sk-2375").cost).toBeNull();
    expect(result.usage.find((row) => row.sku === "sk-2375").costBasis).toBe("unavailable");
    expect(explainTheoreticalConsumption(result)).toMatch(/No stock was posted/);
  });

  test("finished-product wastage does not deduct nested ingredients again", () => {
    const event = classifyWastageEvent({
      kind: "finished_product",
      sku: "sk-1461",
      name: "French Toast",
      quantity: "1",
      unit: "Pcs",
      inventory,
      components,
    });
    expect(event.postsStock).toBe(false);
    expect(event.doubleCountRisk).toBe(true);
    expect(event.shadow.totals.some((row) => row.sku === "sk-2375")).toBe(true);
  });
});
