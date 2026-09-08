/**
 * Known-case regression: results come from the fixture graph, not prior chat memory.
 * Guest-menu copy in App.js is not recipe evidence.
 */
import { classifyIngredientIdentities, computeTheoreticalLedger, expandRecipeToIngredients, exploreIngredient, runInventoryTruthEngine } from "./index";
import { KNOWN_CASE_FIXTURE } from "./knownCases.fixtures";

function graphFromFixture(fixture) {
  return runInventoryTruthEngine({
    ingredients: fixture.ingredients,
    recipes: fixture.recipes,
    versions: fixture.versions,
    lines: fixture.lines,
    salesRows: fixture.salesRows,
    costStateByIngredientId: fixture.costStateByIngredientId,
    branchId: fixture.branchId,
    periodStart: fixture.periodStart,
    periodEnd: fixture.periodEnd,
  });
}

describe("known operational cases from canonical fixtures", () => {
  const engine = graphFromFixture(KNOWN_CASE_FIXTURE);

  test("Maldon Salt traces to recipes that list it, including Steak when the fixture includes it", () => {
    const maldon = engine.theoretical.rows.find((row) => /maldon/i.test(row.displayName));
    expect(maldon).toBeTruthy();
    expect(maldon.recipes.some((recipe) => /steak/i.test(recipe.recipeName))).toBe(true);
    expect(maldon.traces.every((trace) => trace.contributionBaseQty != null)).toBe(true);
    expect(maldon.cost.coverageStatus).toBe("VALID_COST");
    expect(maldon.cost.source).toBe("inventory_ingredient_cost_state");
    const steakTrace = maldon.traces.find((trace) => /steak/i.test(trace.path[0].recipeName));
    expect(steakTrace.path[0].lineQuantity).toBe("2");
    expect(steakTrace.uomOriginal).toBe("g");
  });

  test("Honey theoretical quantity is the sum of expanded recipe contributions from sales", () => {
    const honey = engine.theoretical.rows.find((row) => /honey/i.test(row.displayName));
    expect(honey.quantityTheoreticallyConsumed).toBe("82");
    expect(honey.menuItems.some((item) => /french toast/i.test(item.displayName))).toBe(true);
    expect(honey.menuItems.some((item) => /house salad/i.test(item.displayName))).toBe(true);
  });

  test("Sweet Potato remains a base ingredient after House Salad sub-recipe expansion", () => {
    const potato = engine.theoretical.rows.find((row) => /sweet potato/i.test(row.displayName));
    expect(potato.quantityTheoreticallyConsumed).toBe("0.64");
    expect(potato.recipes.some((recipe) => /house salad/i.test(recipe.recipeName))).toBe(true);
    expect(potato.recipes.some((recipe) => /honey sweet potato/i.test(recipe.recipeName))).toBe(true);
    expect(potato.recipes.some((recipe) => /dressing/i.test(recipe.recipeName))).toBe(false);
  });

  test("Steak expands direct ingredients and does not invent missing actual/variance", () => {
    const steak = expandRecipeToIngredients({
      recipeId: "recipe-steak",
      outputNeeded: "1",
      graph: engine.graph,
    });
    expect([...steak.ingredients.keys()].sort()).toEqual(["maldon", "oil"]);
    expect(engine.actual.actualCoverageStatus).toBe("UNAVAILABLE");
    expect(engine.variance.status).toBe("VARIANCE_NOT_COMPUTABLE");
  });

  test("House Salad expands dressing sub-recipe into honey without counting dressing as a base ingredient", () => {
    const salad = expandRecipeToIngredients({
      recipeId: "recipe-salad",
      outputNeeded: "1",
      graph: engine.graph,
    });
    expect(salad.ingredients.has("recipe-dressing")).toBe(false);
    expect(salad.ingredients.get("honey").quantityBase).toBe("2");
    expect(salad.issues.some((issue) => issue.code === "MISSING_SUB_RECIPE")).toBe(false);
  });

  test("live-contract fixture uses recipe lines, not guest-menu copy", () => {
    expect(KNOWN_CASE_FIXTURE.productionEvidence).toBeFalsy();
    expect(KNOWN_CASE_FIXTURE.recipes.every((recipe) => recipe.menu_item_id || recipe.recipe_type === "sub_recipe")).toBe(true);
    expect(KNOWN_CASE_FIXTURE.lines.every((line) => line.ingredient_id || line.sub_recipe_id)).toBe(true);
    expect(KNOWN_CASE_FIXTURE.lines.every((line) => line.quantity != null && line.unit)).toBe(true);
    expect(KNOWN_CASE_FIXTURE.versions.every((version) => version.status === "active")).toBe(true);
  });

  test("French Toast honey answer is taken from recipe lines, not memory", () => {
    const withHoney = exploreIngredient("honey", engine);
    expect(withHoney.menuItems.some((item) => /french toast/i.test(item.displayName))).toBe(true);
    const toastOnly = computeTheoreticalLedger({
      graph: engine.graph,
      identities: classifyIngredientIdentities({ ingredients: KNOWN_CASE_FIXTURE.ingredients }).identities,
      salesRows: KNOWN_CASE_FIXTURE.salesRows.filter((row) => row.matched_menu_item_id === "menu-toast"),
    });
    expect(toastOnly.rows.some((row) => row.canonicalIngredientId === "honey")).toBe(true);

    const noHoneyFixture = {
      ...KNOWN_CASE_FIXTURE,
      lines: KNOWN_CASE_FIXTURE.lines.filter((line) => !(line.recipe_version_id === "v-toast" && line.ingredient_id === "honey")),
    };
    const withoutHoney = graphFromFixture(noHoneyFixture);
    const toastDrivers = withoutHoney.theoretical.rows.find((row) => row.canonicalIngredientId === "honey")
      ?.menuItems.some((item) => /french toast/i.test(item.displayName));
    expect(toastDrivers || false).toBe(false);
  });
});
