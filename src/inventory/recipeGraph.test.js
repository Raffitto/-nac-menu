import {
  COSTING_STATES,
  classifyRecipeCosting,
  detectRecipeCycle,
  expandRecipeToIngredients,
  resolveCanonicalSaleToRecipe,
  resolveRecipeVersionForDate,
  theoreticalConsumptionForSale,
} from "./recipeGraph";

const recipesById = {
  burger: { id: "burger", outputQuantity: 1, outputUnit: "each" },
  sauce: { id: "sauce", outputQuantity: 1000, outputUnit: "gram" },
  garlic: { id: "garlic", outputQuantity: 100, outputUnit: "gram" },
};

describe("recipeGraph", () => {
  test("direct ingredients expand for one sold item", () => {
    const result = expandRecipeToIngredients({
      recipeId: "burger",
      recipesById,
      linesByRecipeId: {
        burger: [
          { ingredientId: "patty", quantity: 180, unit: "gram" },
          { ingredientId: "bun", quantity: 1, unit: "each" },
        ],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.ingredients.find((line) => line.ingredientId === "patty").quantity).toBe(180);
  });

  test("sub-recipe and multi-level expansion scale by component yield", () => {
    const result = expandRecipeToIngredients({
      recipeId: "burger",
      recipesById,
      linesByRecipeId: {
        burger: [
          { ingredientId: "patty", quantity: 180, unit: "gram" },
          { subRecipeId: "sauce", quantity: 35, unit: "gram" },
        ],
        sauce: [
          { ingredientId: "mayo", quantity: 800, unit: "gram" },
          { subRecipeId: "garlic", quantity: 200, unit: "gram" },
        ],
        garlic: [{ ingredientId: "garlic-clove", quantity: 100, unit: "gram" }],
      },
    });
    expect(result.ok).toBe(true);
    const mayo = result.ingredients.find((line) => line.ingredientId === "mayo");
    const garlic = result.ingredients.find((line) => line.ingredientId === "garlic-clove");
    expect(mayo.quantity).toBeCloseTo(28, 5);
    expect(garlic.quantity).toBeCloseTo(7, 5);
  });

  test("circular dependencies fail safely", () => {
    const linesByRecipeId = {
      a: [{ subRecipeId: "b", quantity: 1, unit: "each" }],
      b: [{ subRecipeId: "c", quantity: 1, unit: "each" }],
      c: [{ subRecipeId: "a", quantity: 1, unit: "each" }],
    };
    expect(detectRecipeCycle("a", linesByRecipeId)).toBe(true);
    const expanded = expandRecipeToIngredients({
      recipeId: "a",
      recipesById: { a: { outputQuantity: 1 }, b: { outputQuantity: 1 }, c: { outputQuantity: 1 } },
      linesByRecipeId,
    });
    expect(expanded.ok).toBe(false);
    expect(expanded.blockers.some((b) => b === "CIRCULAR_DEPENDENCY" || b.code === "CIRCULAR_DEPENDENCY")).toBe(true);
  });

  test("known unit conversions work; unknown conversions block", () => {
    const ok = theoreticalConsumptionForSale({
      recipeId: "burger",
      recipesById,
      linesByRecipeId: {
        burger: [{ ingredientId: "patty", quantity: 180, unit: "gram" }],
      },
    });
    expect(ok.authoritative).toBe(true);
    const blocked = expandRecipeToIngredients({
      recipeId: "burger",
      recipesById: { burger: { outputQuantity: 1, outputUnit: "each" }, sauce: { outputQuantity: 1, outputUnit: "each" } },
      linesByRecipeId: {
        burger: [{ subRecipeId: "sauce", quantity: 35, unit: "gram" }],
        sauce: [{ ingredientId: "x", quantity: 1, unit: "each" }],
      },
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.blockers.some((b) => b.code === "UNKNOWN_CONVERSION")).toBe(true);
  });

  test("fully costed vs missing cost is partial/uncosted and never zero", () => {
    const lines = [
      { ingredientId: "patty", quantity: 0.18, unit: "kilogram" },
      { ingredientId: "bun", quantity: 1, unit: "each" },
    ];
    const full = classifyRecipeCosting({
      lines,
      costByIngredientId: {
        patty: { amount: 40, unit: "kilogram" },
        bun: { amount: 2, unit: "each" },
      },
    });
    expect(full.state).toBe(COSTING_STATES.FULLY_COSTED);
    expect(full.total).toBeCloseTo(9.2, 5);
    const partial = classifyRecipeCosting({
      lines,
      costByIngredientId: { patty: { amount: 40, unit: "kilogram" } },
    });
    expect(partial.state).toBe(COSTING_STATES.PARTIALLY_COSTED);
    expect(partial.total).toBeNull();
    const none = classifyRecipeCosting({ lines, costByIngredientId: {} });
    expect(none.state).toBe(COSTING_STATES.UNCOSTED);
    expect(none.total).toBeNull();
  });

  test("old business date resolves old recipe version", () => {
    const versions = [
      { id: "v1", status: "active", versionNumber: 1, effectiveFrom: "2026-08-01T00:00:00+03:00", effectiveTo: "2026-09-01T00:00:00+03:00", outputQuantity: 1 },
      { id: "v2", status: "active", versionNumber: 2, effectiveFrom: "2026-09-01T00:00:00+03:00", outputQuantity: 1 },
    ];
    expect(resolveRecipeVersionForDate(versions, "2026-08-20").id).toBe("v1");
    expect(resolveRecipeVersionForDate(versions, "2026-09-02").id).toBe("v2");
    const consumption = theoreticalConsumptionForSale({
      recipeId: "burger",
      recipesById,
      versionsByRecipeId: { burger: versions },
      linesByRecipeId: {
        v1: [{ ingredientId: "patty", quantity: 180, unit: "gram" }],
        v2: [{ ingredientId: "patty", quantity: 170, unit: "gram" }],
      },
      businessDate: "2026-08-20",
    });
    expect(consumption.lines[0].quantity).toBe(180);
    const later = theoreticalConsumptionForSale({
      recipeId: "burger",
      recipesById,
      versionsByRecipeId: { burger: versions },
      linesByRecipeId: {
        v1: [{ ingredientId: "patty", quantity: 180, unit: "gram" }],
        v2: [{ ingredientId: "patty", quantity: 170, unit: "gram" }],
      },
      businessDate: "2026-09-02",
    });
    expect(later.lines[0].quantity).toBe(170);
  });

  test("canonical sold product resolves the active recipe", () => {
    const result = resolveCanonicalSaleToRecipe({
      orderItem: { menuItemId: "menu-1", quantity: 1 },
      recipes: [{ id: "burger", active: true, menuItemId: "menu-1" }],
      recipesById,
      linesByRecipeId: {
        burger: [{ ingredientId: "patty", quantity: 170, unit: "gram" }],
      },
      businessDate: "2026-08-20",
    });
    expect(result.ok).toBe(true);
    expect(result.lines[0].quantity).toBe(170);
  });
});
