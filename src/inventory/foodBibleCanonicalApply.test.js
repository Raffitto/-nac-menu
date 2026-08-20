import { buildApplyPlan, matchCanonicalIngredient, recipeImportKey, applyDecision, inferredBatchOutput } from "./foodBibleCanonicalApply";
import { RECONCILE_STATES } from "./recipeMenuReconcile";
import { kitchenRecipeCoverage, requiresKitchenRecipe } from "./foodBibleKitchenCoverage";
import fs from "fs";
import path from "path";

describe("foodBibleCanonicalApply", () => {
  test("delete grant migration is authenticated-only", () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, "../../supabase/migrations/20260820180000_inventory_recipe_line_delete_grant.sql"),
      "utf8",
    );
    expect(sql).toMatch(/grant delete on public\.inventory_recipe_version_lines to authenticated/i);
    expect(sql).toMatch(/grant delete on public\.inventory_recipe_stages to authenticated/i);
    expect(sql).not.toMatch(/to anon/i);
  });
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
    expect(applyDecision({ fingerprint: "abc" }, "abc", { hasLines: true, plannedLineCount: 3, existingLineCount: 3, outputChanged: true })).toBe("new_version");
    expect(applyDecision({ fingerprint: "abc" }, "abc", {
      hasLines: true,
      plannedLineCount: 4,
      existingLineCount: 4,
      plannedSubRecipes: true,
      existingHasSubRecipe: false,
    })).toBe("new_version");
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
    expect(plan.createIngredientCount).toBe(2);
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

describe("Sea Bass apply graph", () => {
  test("finished dish links sauce as a component and does not consume the marinate card", () => {
    expect(inferredBatchOutput("1 Pax", [
      { quantity: 30, unit: "gram" },
      { quantity: 200, unit: "millilitre" },
    ], { force: true })).toEqual(expect.objectContaining({ outputQuantity: 230, outputUnit: "gram" }));

    const plan = buildApplyPlan({
      ingredients: [],
      recipes: [
        {
          ksaOperationalTitle: "SEA BASS CREOLE WITH PEPPER CREAM SAUCE",
          sourceFile: "Sea bass creole.pdf",
          recipeKind: "finished",
          yieldRaw: "1 Pax",
          ksaIngredients: [
            { ksaOperationalName: "Sea bass fillet", sourceQuantity: 1, sourceUnit: "pcs" },
            { ksaOperationalName: "Salt", sourceQuantity: 2, sourceUnit: "gr" },
            { ksaOperationalName: "Creole pepper sauce", sourceQuantity: 70, sourceUnit: "gr" },
            { ksaOperationalName: "Watercress", sourceQuantity: 10, sourceUnit: "gr" },
          ],
        },
        {
          ksaOperationalTitle: "SEA BASS MARINATE",
          sourceFile: "Sea bass creole.pdf",
          recipeKind: "prep",
          yieldRaw: "1 Batch",
          ksaIngredients: [
            { ksaOperationalName: "Sea bass", sourceQuantity: 1, sourceUnit: "pcs" },
            { ksaOperationalName: "creole spice", sourceQuantity: 5, sourceUnit: "gr" },
            { ksaOperationalName: "Salt", sourceQuantity: 3, sourceUnit: "gr" },
          ],
        },
        {
          ksaOperationalTitle: "CREOLE PEPPER SAUCE",
          sourceFile: "Sea bass creole.pdf",
          recipeKind: "prep",
          yieldRaw: "1 Batch",
          ksaIngredients: [
            { ksaOperationalName: "Butter", sourceQuantity: 30, sourceUnit: "g" },
            { ksaOperationalName: "Creole spice mix", sourceQuantity: 15, sourceUnit: "g" },
            { ksaOperationalName: "Tomato paste", sourceQuantity: 10, sourceUnit: "g" },
            { ksaOperationalName: "Double cream", sourceQuantity: 200, sourceUnit: "ml" },
            { ksaOperationalName: "Red pepper", sourceQuantity: 10, sourceUnit: "g" },
            { ksaOperationalName: "Yellow pepper", sourceQuantity: 10, sourceUnit: "g" },
          ],
        },
      ],
      recipeRows: [
        {
          recipeTitle: "SEA BASS CREOLE WITH PEPPER CREAM SAUCE",
          state: RECONCILE_STATES.ACTIVE_MATCHED,
          sourceFile: "Sea bass creole.pdf",
          liveItem: { primary: { id: "menu-seabass", placement_group_id: "g1" } },
        },
        { recipeTitle: "SEA BASS MARINATE", state: RECONCILE_STATES.SUB_RECIPE_NON_SELLABLE, recipeKind: "prep", sourceFile: "Sea bass creole.pdf" },
        { recipeTitle: "CREOLE PEPPER SAUCE", state: RECONCILE_STATES.SUB_RECIPE_NON_SELLABLE, recipeKind: "prep", sourceFile: "Sea bass creole.pdf" },
      ],
    });
    const finished = plan.persist.find((row) => /creole with pepper/i.test(row.name));
    const sauce = plan.persist.find((row) => /^creole pepper sauce$/i.test(row.name));
    const marinate = plan.persist.find((row) => /marinate/i.test(row.name));
    expect(finished.lines).toHaveLength(4);
    expect(finished.lines.some((line) => /marinate/i.test(line.sourceName || ""))).toBe(false);
    expect(finished.lines.find((line) => /creole pepper sauce/i.test(line.sourceName)).subRecipeName).toMatch(/creole pepper sauce/i);
    expect(plan.ingredientActions.some((row) => /creole pepper sauce/i.test(row.canonicalName))).toBe(true);
    expect(sauce.outputUnit).toBe("gram");
    expect(sauce.outputQuantity).toBe(275);
    expect(sauce.lines).toHaveLength(6);
    expect(marinate.lines.some((line) => /sea bass/i.test(line.sourceName))).toBe(true);
  });
});
