import {
  CATALOGUE_SCOPES,
  READINESS,
  buildFoodBibleSummary,
  dedupeMenuItems,
  deriveRecipeReadiness,
  detectRecipeCycle,
  duplicateLineWarning,
  filterFoodBibleRows,
  findRecipeForMenuIdentity,
  guestMenuStatus,
  isVerificationFixture,
  menuIdentityKey,
  requiresKitchenRecipe,
  validateRecipeDraft,
  wouldCreateCycle,
} from "./foodBible";

describe("foodBible helpers", () => {
  test("dedupeMenuItems groups linked placements and same-name dayparts as one identity", () => {
    const groups = dedupeMenuItems([
      { id: "a", placement_group_id: "group-1", name_en: "Burrata", section_id: "s1", sort_order: 2, active: true },
      { id: "b", placement_group_id: "group-1", name_en: "Burrata", section_id: "s2", sort_order: 1, active: true },
      { id: "c", name_en: "Big NAC", section_id: "s3", sort_order: 1, active: true },
      { id: "d", name_en: "Big NAC", section_id: "s4", sort_order: 2, active: true },
      { id: "e", name_en: "Latte", section_id: "s5", sort_order: 1, active: true },
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.find((group) => group.primaryItem.name_en === "Burrata").placements).toHaveLength(2);
    expect(groups.find((group) => group.primaryItem.name_en === "Big NAC").placements).toHaveLength(2);
    expect(groups.find((group) => group.primaryItem.name_en === "Latte").primaryItem.id).toBe("e");
  });

  test("dedupeMenuItems merges same-name leftovers split across placement groups", () => {
    const groups = dedupeMenuItems([
      { id: "linked", placement_group_id: "pg-1", name_en: "Turkish Eggs", section_id: "s1", sort_order: 1, active: true },
      { id: "orphan", name_en: "Turkish Eggs", section_id: "s2", sort_order: 2, active: true },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].placements).toHaveLength(2);
  });

  test("duplicate menu placements do not inflate the unique kitchen recipe denominator", () => {
    const summary = buildFoodBibleSummary([
      {
        kind: "menu_item",
        displayName: "Big NAC",
        guestStatus: "live",
        requiresKitchenRecipe: true,
        readiness: READINESS.READY,
        recipeId: "r-big",
        lineCount: 8,
        placements: [{ id: "1" }, { id: "2" }, { id: "3" }],
      },
    ]);
    expect(summary.liveKitchenItems).toBe(1);
    expect(summary.placementCount).toBe(3);
    expect(summary.mapped).toBe(1);
    expect(summary.coveragePct).toBe(100);
  });

  test("coverage ignores drinks, packaged items, components, archives, and verification fixtures", () => {
    const summary = buildFoodBibleSummary([
      {
        kind: "menu_item",
        displayName: "Pan Seared Seabass",
        guestStatus: "live",
        requiresKitchenRecipe: true,
        readiness: READINESS.READY,
        recipeId: "r-bass",
        lineCount: 12,
        placements: [{ id: "sb" }],
      },
      {
        kind: "menu_item",
        displayName: "Coca Cola",
        guestStatus: "live",
        requiresKitchenRecipe: false,
        readiness: READINESS.MISSING,
        placements: [{ id: "coke" }],
      },
      {
        kind: "menu_item",
        displayName: "Espresso",
        guestStatus: "live",
        requiresKitchenRecipe: false,
        readiness: READINESS.MISSING,
        placements: [{ id: "esp" }],
      },
      {
        kind: "component",
        displayName: "Hollandaise",
        readiness: READINESS.READY,
        recipeId: "r-holl",
        lineCount: 4,
      },
      {
        kind: "archived",
        displayName: "APPLE BIRCHER MUESLI",
        guestStatus: "hidden",
        operationallyActive: false,
        readiness: READINESS.READY,
        recipeId: "r-birch",
        lineCount: 6,
      },
      {
        kind: "menu_item",
        displayName: "[TEMP VERIFY] Cream",
        guestStatus: "live",
        isVerificationFixture: true,
        requiresKitchenRecipe: true,
        readiness: READINESS.READY,
        recipeId: "r-temp",
        lineCount: 1,
      },
      {
        kind: "menu_item",
        displayName: "Conchiglie",
        guestStatus: "live",
        requiresKitchenRecipe: true,
        readiness: READINESS.MISSING,
        placements: [{ id: "pasta" }],
      },
    ]);
    expect(summary.liveKitchenItems).toBe(2);
    expect(summary.mapped).toBe(1);
    expect(summary.missing).toBe(1);
    expect(summary.preparedComponentCount).toBe(1);
    expect(summary.drinkCount).toBe(2);
    expect(summary.coveragePct).toBe(50);
  });

  test("buildFoodBibleSummary calculates coverage from mapped kitchen recipes, not placements", () => {
    const summary = buildFoodBibleSummary([
      { kind: "menu_item", guestStatus: "live", requiresKitchenRecipe: true, readiness: READINESS.READY, recipeId: "r1", lineCount: 2, placements: [{ id: "a" }] },
      { kind: "menu_item", guestStatus: "live", requiresKitchenRecipe: true, readiness: READINESS.MISSING, placements: [{ id: "b" }] },
      { kind: "menu_item", guestStatus: "live", requiresKitchenRecipe: true, readiness: READINESS.DRAFT, recipeId: "r2", lineCount: 1, placements: [{ id: "c" }] },
      { kind: "component", readiness: READINESS.READY, recipeId: "r3", lineCount: 3 },
    ]);
    expect(summary.liveKitchenItems).toBe(3);
    expect(summary.complete).toBe(1);
    expect(summary.incomplete).toBe(1);
    expect(summary.missing).toBe(1);
    expect(summary.mapped).toBe(2);
    expect(summary.coveragePct).toBe(67);
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
      { kind: "menu_item", displayName: "Burrata", readiness: READINESS.MISSING, guestStatus: "live", requiresKitchenRecipe: true, categoryName: "Mains" },
      { kind: "menu_item", displayName: "Latte", readiness: READINESS.READY, guestStatus: "hidden", requiresKitchenRecipe: false, categoryName: "Drinks" },
    ];
    expect(filterFoodBibleRows(rows, { catalogue: CATALOGUE_SCOPES.ALL, readiness: READINESS.MISSING })).toHaveLength(1);
    expect(filterFoodBibleRows(rows, { catalogue: CATALOGUE_SCOPES.ALL, menuVisibility: "hidden" })).toHaveLength(1);
    expect(filterFoodBibleRows(rows, { catalogue: CATALOGUE_SCOPES.ALL, search: "latte" })).toHaveLength(1);
  });

  test("filterFoodBibleRows default kitchen hides drinks, components, archives, and fixtures", () => {
    const rows = [
      { kind: "menu_item", displayName: "Burrata", guestStatus: "live", requiresKitchenRecipe: true, readiness: READINESS.MISSING, categoryName: "Mains" },
      { kind: "menu_item", displayName: "Latte", guestStatus: "live", requiresKitchenRecipe: false, readiness: READINESS.MISSING, categoryName: "Drinks" },
      { kind: "component", displayName: "Hollandaise", readiness: READINESS.DRAFT, categoryName: "Kitchen components" },
      { kind: "archived", displayName: "APPLE BIRCHER MUESLI", guestStatus: "hidden", operationallyActive: false },
      { kind: "menu_item", displayName: "[TEMP VERIFY] x", isVerificationFixture: true, guestStatus: "live", requiresKitchenRecipe: true },
    ];
    expect(filterFoodBibleRows(rows, { catalogue: CATALOGUE_SCOPES.KITCHEN }).map((row) => row.displayName)).toEqual(["Burrata"]);
    expect(filterFoodBibleRows(rows, { catalogue: CATALOGUE_SCOPES.DRINKS }).map((row) => row.displayName)).toEqual(["Latte"]);
    expect(filterFoodBibleRows(rows, { catalogue: CATALOGUE_SCOPES.COMPONENTS }).map((row) => row.displayName)).toEqual(["Hollandaise"]);
    expect(filterFoodBibleRows(rows, { catalogue: CATALOGUE_SCOPES.ARCHIVED }).map((row) => row.displayName)).toEqual(["APPLE BIRCHER MUESLI"]);
    expect(filterFoodBibleRows(rows, { catalogue: CATALOGUE_SCOPES.ALL }).some((row) => /TEMP VERIFY/.test(row.displayName))).toBe(false);
  });

  test("guestMenuStatus reflects live, hidden, and sold out states", () => {
    expect(guestMenuStatus({ active: true, sold_out: false })).toBe("live");
    expect(guestMenuStatus({ active: false })).toBe("hidden");
    expect(guestMenuStatus({ active: true, sold_out: true })).toBe("sold_out");
    expect(guestMenuStatus({ active: true, hidden_until: "2099-01-01T00:00:00.000Z" })).toBe("hidden");
  });

  test("findRecipeForMenuIdentity matches placement groups and menu item ids", () => {
    const identity = {
      placementGroupId: "group-1",
      primaryItem: { id: "menu-a" },
      placements: [{ id: "menu-a" }, { id: "menu-b" }],
    };
    const byGroup = findRecipeForMenuIdentity([
      { id: "r1", active: true, placementGroupId: "group-1", menuItemId: "menu-a" },
    ], identity);
    expect(byGroup?.id).toBe("r1");

    const byItem = findRecipeForMenuIdentity([
      { id: "r2", active: true, placementGroupId: null, menuItemId: "menu-b" },
    ], identity);
    expect(byItem?.id).toBe("r2");
  });

  test("findRecipeForMenuIdentity matches Big NAC to BIG NAC by normalized name", () => {
    const identity = {
      placementGroupId: null,
      primaryItem: { id: "live-1", name_en: "Big NAC" },
      placements: [{ id: "live-1" }, { id: "live-2" }],
    };
    const recipe = findRecipeForMenuIdentity([
      { id: "r-big", active: true, name: "BIG NAC", normalizedName: "big nac", recipeType: "menu_item", menuItemId: "other" },
    ], identity);
    expect(recipe?.id).toBe("r-big");
  });

  test("findRecipeForMenuIdentity keeps Sea Bass and Prawn Rendang linked by menu item id when names differ", () => {
    const seaBass = findRecipeForMenuIdentity([
      { id: "r-bass", active: true, name: "SEA BASS CREOLE WITH PEPPER CREAM SAUCE", recipeType: "menu_item", menuItemId: "sb-2" },
    ], {
      primaryItem: { id: "sb-1", name_en: "Pan Seared Seabass" },
      placements: [{ id: "sb-1" }, { id: "sb-2" }],
    });
    expect(seaBass?.id).toBe("r-bass");

    const rendang = findRecipeForMenuIdentity([
      { id: "r-rendang", active: true, name: "Prawn Rendang, grilled lemon", recipeType: "menu_item", menuItemId: "kr-1" },
    ], {
      primaryItem: { id: "kr-1", name_en: "King Prawn Rendang" },
      placements: [{ id: "kr-1" }],
    });
    expect(rendang?.id).toBe("r-rendang");
  });

  test("inactive Apple Bircher and Conchiglie missing stay unmapped", () => {
    const bircher = findRecipeForMenuIdentity([
      { id: "r-birch", active: false, name: "APPLE BIRCHER MUESLI", recipeType: "menu_item", menuItemId: null },
    ], {
      primaryItem: { id: "live-birch", name_en: "Apple Bircher" },
      placements: [{ id: "live-birch" }],
    });
    expect(bircher).toBeNull();

    const pasta = findRecipeForMenuIdentity([], {
      primaryItem: { id: "conch", name_en: "Conchiglie" },
      placements: [{ id: "conch" }],
    });
    expect(pasta).toBeNull();
  });

  test("maps leftover identities to canonical recipes without inventing dishes", () => {
    const turkish = findRecipeForMenuIdentity([
      { id: "r-turk", active: true, name: "TURKISH EGGS, CAJUN BUTTER, PITA", recipeType: "menu_item", menuItemId: "other" },
    ], { primaryItem: { id: "live", name_en: "Turkish Eggs" }, placements: [{ id: "live" }] });
    expect(turkish?.id).toBe("r-turk");

    const halloumi = findRecipeForMenuIdentity([
      { id: "r-hal", active: true, name: "HALLOUMI", recipeType: "menu_item", menuItemId: "other" },
      { id: "r-fries", active: true, name: "HALLOUMI FRIES, HONEY SRIRACHA", recipeType: "menu_item", menuItemId: "fries" },
    ], { primaryItem: { id: "live", name_en: "Grilled Halloumi" }, placements: [{ id: "live" }] });
    expect(halloumi?.id).toBe("r-hal");

    const yogurt = findRecipeForMenuIdentity([
      { id: "r-yog", active: true, name: "GREEK YOGHURT, HOUSE GRANOLA, RASPBERRY, CARAMEL TOAST", recipeType: "menu_item", menuItemId: "other" },
    ], { primaryItem: { id: "live", name_en: "Greek Yogurt" }, placements: [{ id: "live" }] });
    expect(yogurt?.id).toBe("r-yog");

    const popcorn = findRecipeForMenuIdentity([
      { id: "r-pop", active: true, name: "POPCORN CHICKEN, SPICY MAYO", recipeType: "preparation", menuItemId: null },
    ], { primaryItem: { id: "live", name_en: "Popcorn Chicken" }, placements: [{ id: "live" }] });
    expect(popcorn?.id).toBe("r-pop");

    const flamed = findRecipeForMenuIdentity([
      { id: "r-flm", active: false, name: "FLAMED AUBERGINE, MISO, CRISPY RICE, GREEK YOGURT", recipeType: "menu_item", menuItemId: null, internalName: "fb:20260820:flamed" },
    ], { primaryItem: { id: "live", name_en: "Flamed Aubergine" }, placements: [{ id: "live" }] });
    expect(flamed?.id).toBe("r-flm");
  });

  test("does not auto-map ambiguous or source-missing kitchen identities", () => {
    expect(findRecipeForMenuIdentity([
      { id: "r-fried", active: true, name: "2 EGGS ANY STYLE - FRIED", recipeType: "menu_item", menuItemId: "other" },
    ], { primaryItem: { id: "live", name_en: "2 Eggs Any Style" }, placements: [{ id: "live" }] })).toBeNull();

    expect(findRecipeForMenuIdentity([
      { id: "r-toast", active: true, name: "AVOCADO TOAST, FETA", recipeType: "menu_item", menuItemId: "a" },
      { id: "r-salt", active: true, name: "AVOCADO WITH SMOKED SEA SALT", recipeType: "menu_item", menuItemId: "b" },
    ], { primaryItem: { id: "live", name_en: "Avocado" }, placements: [{ id: "live" }] })).toBeNull();

    expect(findRecipeForMenuIdentity([
      { id: "r-jack", active: true, name: "SCRAMBLED EGGS, MONTERREY JACK, JALAPEÑO MAYO, BRIOCHE BUN", recipeType: "menu_item", menuItemId: "a" },
      { id: "r-toast", active: false, name: "SCRAMBLED EGGS ON TOAST", recipeType: "menu_item", menuItemId: null, internalName: "fb:x" },
    ], { primaryItem: { id: "live", name_en: "Scrambled Eggs" }, placements: [{ id: "live" }] })).toBeNull();

    expect(findRecipeForMenuIdentity([
      { id: "r-morel", active: true, name: "MOREL PASTA, PARMESAN", recipeType: "menu_item", menuItemId: "x" },
    ], { primaryItem: { id: "live", name_en: "Conchiglie" }, placements: [{ id: "live" }] })).toBeNull();

    expect(findRecipeForMenuIdentity([
      { id: "r-plate", active: true, name: "MEDITERRANEAN PLATE", recipeType: "menu_item", menuItemId: "x" },
    ], { primaryItem: { id: "live", name_en: "Mediterranean Breakfast" }, placements: [{ id: "live" }] })).toBeNull();
  });

  test("requiresKitchenRecipe excludes drinks and packaged add-ons but keeps kitchen dishes", () => {
    expect(requiresKitchenRecipe({ name: "Coca Cola", categoryName: "Drinks" })).toBe(false);
    expect(requiresKitchenRecipe({ name: "Espresso", categoryName: "Coffee" })).toBe(false);
    expect(requiresKitchenRecipe({ name: "Still Water", categoryName: "Drinks" })).toBe(false);
    expect(requiresKitchenRecipe({ name: "Watermelon & Cucumber", categoryName: "Starters" })).toBe(true);
    expect(requiresKitchenRecipe({ name: "Big NAC", categoryName: "Burgers" })).toBe(true);
    expect(isVerificationFixture("[TEMP VERIFY] recipe")).toBe(true);
  });
});
