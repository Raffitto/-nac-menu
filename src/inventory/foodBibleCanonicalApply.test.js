import { buildApplyPlan, matchCanonicalIngredient, recipeImportKey, applyDecision } from "./foodBibleCanonicalApply";
import { RECONCILE_STATES } from "./recipeMenuReconcile";
import { kitchenRecipeCoverage, requiresKitchenRecipe } from "./foodBibleKitchenCoverage";

describe("foodBibleCanonicalApply", () => {
  test("reuses singular/plural ingredient names instead of creating duplicates", () => {
    const match = matchCanonicalIngredient("Tomatoes", [
      { id: "1", canonicalName: "Tomato", normalizedSearchName: "tomato" },
    ]);
    expect(match.status).toBe("reuse");
    expect(match.ingredient.id).toBe("1");
  });

  test("idempotent import keys stay stable and identical fingerprints skip", () => {
    const key = recipeImportKey({ sourceFile: "Big NAC V2.pdf", title: "BIG NAC" });
    expect(key).toContain("fb:20260820:");
    expect(applyDecision({ fingerprint: "abc" }, "abc")).toBe("skip_identical");
    expect(applyDecision(null, "abc")).toBe("create");
    expect(applyDecision({ fingerprint: "abc" }, "xyz")).toBe("new_version");
    expect(applyDecision({ fingerprint: "abc" }, "abc", { hasLines: false, plannedLineCount: 4, existingLineCount: 0 })).toBe("new_version");
    expect(applyDecision({ fingerprint: "abc" }, "abc", { hasLines: true, plannedLineCount: 8, existingLineCount: 1 })).toBe("new_version");
    expect(applyDecision({ fingerprint: "abc" }, "abc", { hasLines: true, plannedLineCount: 3, existingLineCount: 3 })).toBe("skip_identical");
  });

  test("sub-recipe ingredient names are not created as duplicate ingredients", () => {
    const plan = buildApplyPlan({
      ingredients: [],
      recipes: [
        {
          ksaOperationalTitle: "VODKA TOMATO SAUCE",
          sourceFile: "sauce.pdf",
          recipeKind: "prep",
          yieldRaw: "16.5 KG",
          ksaIngredients: [{ ksaOperationalName: "Tomato", sourceQuantity: 2000, sourceUnit: "g" }],
        },
        {
          ksaOperationalTitle: "RIGATONI",
          sourceFile: "pasta.pdf",
          recipeKind: "finished",
          yieldRaw: "1 Pax",
          ksaIngredients: [{ ksaOperationalName: "Vodka tomato sauce", sourceQuantity: 400, sourceUnit: "g" }],
        },
      ],
      recipeRows: [
        { recipeTitle: "VODKA TOMATO SAUCE", state: RECONCILE_STATES.SUB_RECIPE_NON_SELLABLE, recipeKind: "prep", sourceFile: "sauce.pdf" },
        {
          recipeTitle: "RIGATONI",
          state: RECONCILE_STATES.ACTIVE_MATCHED,
          sourceFile: "pasta.pdf",
          liveItem: { primary: { id: "menu-rig", placement_group_id: "g2" } },
        },
      ],
    });
    const pasta = plan.persist.find((row) => /rigatoni/i.test(row.name));
    expect(pasta.lines[0].subRecipeName).toMatch(/vodka tomato sauce/i);
    expect(plan.createIngredientCount).toBe(1);
  });

  test("missing ingredient cost stays unknown, never zero", () => {
    const { classifyRecipeCosting, COSTING_STATES } = require("./recipeGraph");
    const result = classifyRecipeCosting({
      lines: [{ ingredientId: "ing-1", quantity: 10, unit: "gram" }],
      costByIngredientId: {},
    });
    expect(result.state).toBe(COSTING_STATES.UNCOSTED);
    expect(result.total).toBeNull();
  });

  test("legacy stays inactive, ambiguous does not activate, matched links the live item", () => {
    const plan = buildApplyPlan({
      ingredients: [{ id: "ing-1", canonicalName: "Oats", normalizedSearchName: "oats" }],
      recipes: [
        {
          ksaOperationalTitle: "APPLE BIRCHER MUESLI",
          sourceFile: "Apple Bircher.pdf",
          recipeKind: "finished",
          yieldRaw: "1 Pax",
          ksaIngredients: [{ ksaOperationalName: "Oats", sourceQuantity: 80, sourceUnit: "g" }],
        },
        {
          ksaOperationalTitle: "FLAMED AUBERGINE",
          sourceFile: "aubergine.pdf",
          recipeKind: "finished",
          yieldRaw: "1 Pax",
          ksaIngredients: [{ ksaOperationalName: "Oats", sourceQuantity: 10, sourceUnit: "g" }],
        },
        {
          ksaOperationalTitle: "BIG NAC",
          sourceFile: "Big NAC V2.pdf",
          recipeKind: "finished",
          yieldRaw: "1 Pax",
          ksaIngredients: [{ ksaOperationalName: "Oats", sourceQuantity: 160, sourceUnit: "g" }],
        },
      ],
      recipeRows: [
        { recipeTitle: "APPLE BIRCHER MUESLI", state: RECONCILE_STATES.RECIPE_LEGACY_INACTIVE, sourceFile: "Apple Bircher.pdf" },
        { recipeTitle: "FLAMED AUBERGINE", state: RECONCILE_STATES.AMBIGUOUS_MATCH, sourceFile: "aubergine.pdf" },
        {
          recipeTitle: "BIG NAC",
          state: RECONCILE_STATES.ACTIVE_MATCHED,
          sourceFile: "Big NAC V2.pdf",
          liveItem: { primary: { id: "menu-big", placement_group_id: "g1" } },
        },
      ],
    });
    const bircher = plan.persist.find((row) => /bircher/i.test(row.name));
    const flamed = plan.persist.find((row) => /aubergine/i.test(row.name));
    const burger = plan.persist.find((row) => /big nac/i.test(row.name));
    expect(bircher.active).toBe(false);
    expect(bircher.menuItemId).toBeNull();
    expect(flamed.active).toBe(false);
    expect(burger.active).toBe(true);
    expect(burger.menuItemId).toBe("menu-big");
  });
});

describe("kitchen recipe coverage", () => {
  test("drinks are excluded from the kitchen-recipe denominator", () => {
    expect(requiresKitchenRecipe({ name: "Coca Cola", sectionName: "Drinks" })).toBe(false);
    expect(requiresKitchenRecipe({ name: "Big NAC", sectionName: "Mains" })).toBe(true);
    const coverage = kitchenRecipeCoverage([
      { liveName: "Big NAC", state: "active + matched", sectionName: "Mains" },
      { liveName: "Coca Cola", state: "active + recipe missing", sectionName: "Drinks" },
      { liveName: "Conchiglie", state: "active + recipe missing", sectionName: "Mains" },
    ]);
    expect(coverage.overallLive).toBe(3);
    expect(coverage.kitchenRequired).toBe(2);
    expect(coverage.kitchenMatched).toBe(1);
    expect(coverage.kitchenPct).toBe(50);
  });
});
