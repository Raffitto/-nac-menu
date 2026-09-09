import {
  RECIPE_LINE_KIND,
  analyticalRecipeLines,
  classifyRecipeLineKind,
} from "./recipeLineKind";

describe("recipe line kind", () => {
  test("Total / Portions / finished weight are documentation, not ingredients", () => {
    expect(classifyRecipeLineKind({ ingredient_id: "x" }, { ingredientName: "Total" }))
      .toBe(RECIPE_LINE_KIND.DOCUMENTATION_LINE);
    expect(classifyRecipeLineKind({ ingredient_id: "x" }, { ingredientName: "Portions" }))
      .toBe(RECIPE_LINE_KIND.DOCUMENTATION_LINE);
    expect(classifyRecipeLineKind({ ingredient_id: "x" }, { ingredientName: "fInished weight" }))
      .toBe(RECIPE_LINE_KIND.DOCUMENTATION_LINE);
  });

  test("sub-recipe and real ingredients stay analytical", () => {
    expect(classifyRecipeLineKind({ sub_recipe_id: "dressing" }, { ingredientName: "HOUSE SALAD DRESSING" }))
      .toBe(RECIPE_LINE_KIND.SUB_RECIPE_LINE);
    expect(classifyRecipeLineKind({ ingredient_id: "honey" }, { ingredientName: "honey" }))
      .toBe(RECIPE_LINE_KIND.INGREDIENT_LINE);
  });

  test("analyticalRecipeLines drops French Toast Total without deleting it from the source array", () => {
    const lines = [
      { id: "a", ingredient_id: "bun", quantity: "80", unit: "gram" },
      { id: "b", ingredient_id: "total", quantity: "220", unit: "gram" },
    ];
    const byId = new Map([
      ["bun", { canonical_name: "French toast batter bun" }],
      ["total", { canonical_name: "Total" }],
    ]);
    const analytical = analyticalRecipeLines(lines, byId);
    expect(analytical.map((line) => line.id)).toEqual(["a"]);
    expect(lines).toHaveLength(2);
  });
});
