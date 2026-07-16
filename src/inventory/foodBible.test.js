import {
  READINESS,
  buildFoodBibleSummary,
  dedupeMenuItems,
  deriveRecipeReadiness,
  detectRecipeCycle,
  duplicateLineWarning,
  filterFoodBibleRows,
  guestMenuStatus,
  menuIdentityKey,
  validateRecipeDraft,
  wouldCreateCycle,
} from "./foodBible";

describe("foodBible helpers", () => {
  test("dedupeMenuItems groups linked placements under one identity", () => {
    const groups = dedupeMenuItems([
      { id: "a", placement_group_id: "group-1", name_en: "Burrata", section_id: "s1", sort_order: 2, active: true },
      { id: "b", placement_group_id: "group-1", name_en: "Burrata", section_id: "s2", sort_order: 1, active: true },
      { id: "c", name_en: "Latte", section_id: "s3", sort_order: 1, active: true },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].placements).toHaveLength(2);
    expect(groups[0].primaryItem.id).toBe("b");
    expect(menuIdentityKey(groups[1].primaryItem)).toBe("c");
  });

  test("buildFoodBibleSummary calculates coverage from menu rows", () => {
    const summary = buildFoodBibleSummary([
      { kind: "menu_item", readiness: READINESS.READY },
      { kind: "menu_item", readiness: READINESS.MISSING },
      { kind: "menu_item", readiness: READINESS.DRAFT },
      { kind: "component", readiness: READINESS.READY },
    ]);
    expect(summary).toEqual({
      totalMenuItems: 3,
      complete: 1,
      inProgress: 1,
      missing: 1,
      needsAttention: 0,
      coveragePct: 33,
    });
  });

  test("deriveRecipeReadiness marks missing, draft, ready, and needs attention", () => {
    const ingredient = { id: "ing-1", active: true, baseInventoryUnit: "gram" };
    const ingredientById = new Map([[ingredient.id, ingredient]]);
    const missing = deriveRecipeReadiness({ recipe: null });
    expect(missing.readiness).toBe(READINESS.MISSING);

    const draft = deriveRecipeReadiness({
      recipe: {
        id: "r1",
        name: "Hollandaise",
        recipeType: "preparation",
        outputQuantity: "1000",
        outputUnit: "gram",
        portionCount: "10",
      },
      version: { documentation: {} },
      lines: [],
      ingredientById,
      recipeById: new Map(),
    });
    expect(draft.readiness).toBe(READINESS.DRAFT);

    const ready = deriveRecipeReadiness({
      recipe: {
        id: "r2",
        name: "Burrata",
        recipeType: "menu_item",
        menuItemId: "menu-1",
        outputQuantity: "1",
        outputUnit: "each",
        portionCount: "1",
      },
      version: { documentation: { preparationMethod: "Plate and serve." } },
      lines: [{ ingredientId: "ing-1", quantity: "100", unit: "gram", wastePercentage: 0 }],
      ingredientById,
      recipeById: new Map(),
      menuItem: { id: "menu-1", active: true },
    });
    expect(ready.readiness).toBe(READINESS.READY);

    const attention = deriveRecipeReadiness({
      recipe: {
        id: "r3",
        name: "Latte",
        recipeType: "menu_item",
        menuItemId: "menu-2",
        outputQuantity: "1",
        outputUnit: "each",
        portionCount: "1",
      },
      version: { documentation: { preparationMethod: "Mix." } },
      lines: [{ ingredientId: "ing-1", quantity: "1", unit: "litre", wastePercentage: 0 }],
      ingredientById,
      recipeById: new Map(),
      menuItem: { id: "menu-2", active: true },
    });
    expect(attention.readiness).toBe(READINESS.NEEDS_ATTENTION);
  });

  test("wouldCreateCycle rejects self and two-level circular dependencies", () => {
    const graph = {
      a: [{ subRecipeId: "b" }],
      b: [{ subRecipeId: "c" }],
      c: [],
    };
    expect(wouldCreateCycle("a", "a", graph)).toBe(true);
    expect(wouldCreateCycle("a", "c", {
      ...graph,
      c: [{ subRecipeId: "a" }],
    })).toBe(true);
    expect(wouldCreateCycle("a", "c", graph)).toBe(false);
  });

  test("detectRecipeCycle finds cycles in a recipe graph", () => {
    const graph = new Map([
      ["a", ["b"]],
      ["b", ["a"]],
    ]);
    expect(detectRecipeCycle("a", [{ subRecipeId: "b" }], graph)).toBe(true);
  });

  test("duplicateLineWarning requires distinguishing preparation notes", () => {
    const lines = [
      { ingredientId: "ing-1", preparationNote: "Sauce base" },
    ];
    expect(duplicateLineWarning(lines, { ingredientId: "ing-1", preparationNote: "Sauce base" })).toBe(true);
    expect(duplicateLineWarning(lines, { ingredientId: "ing-1", preparationNote: "Garnish" })).toBe(false);
  });

  test("validateRecipeDraft rejects invalid yield and menu linkage", () => {
    expect(validateRecipeDraft({ name: "", recipeType: "menu_item", outputQuantity: "1", outputUnit: "each" }, []).ok).toBe(false);
    expect(validateRecipeDraft({
      name: "Water",
      recipeType: "direct_stock",
      outputQuantity: "0",
      outputUnit: "each",
    }, []).ok).toBe(false);
  });

  test("filterFoodBibleRows supports readiness and menu visibility filters", () => {
    const rows = [
      { displayName: "Burrata", readiness: READINESS.MISSING, guestStatus: "live", categoryName: "Mains" },
      { displayName: "Latte", readiness: READINESS.READY, guestStatus: "hidden", categoryName: "Drinks" },
    ];
    expect(filterFoodBibleRows(rows, { readiness: READINESS.MISSING })).toHaveLength(1);
    expect(filterFoodBibleRows(rows, { menuVisibility: "hidden" })).toHaveLength(1);
    expect(filterFoodBibleRows(rows, { search: "latte" })).toHaveLength(1);
  });

  test("guestMenuStatus reflects live, hidden, and sold out states", () => {
    expect(guestMenuStatus({ active: true, sold_out: false })).toBe("live");
    expect(guestMenuStatus({ active: false })).toBe("hidden");
    expect(guestMenuStatus({ active: true, sold_out: true })).toBe("sold_out");
    expect(guestMenuStatus({ active: true, hidden_until: "2099-01-01T00:00:00.000Z" })).toBe("hidden");
  });
});
