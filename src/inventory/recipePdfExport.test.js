import {
  currentFoodBibleSnapshots,
  flattenSelectedRecipeTrees,
  recipePdfFilename,
  recipePdfPlaintext,
  recipesPdfBytes,
  snapshotFromExtractedRecipe,
  snapshotFromRecipeRecord,
} from "./recipePdfExport";

describe("recipePdfExport", () => {
  const bigNac = snapshotFromRecipeRecord({
    row: {
      recipeId: "big-nac",
      displayName: "Big NAC",
      categoryName: "Burgers",
      guestStatus: "live",
      kind: "menu_item",
      outputQuantity: 1,
      outputUnit: "each",
      portionSize: 1,
      portionUnit: "each",
    },
    version: { versionNumber: 2, effectiveFrom: "2026-08-20T00:00:00+03:00" },
    lines: [
      { name: "Beef Patty", quantity: 180, unit: "gram", ingredientId: "patty" },
      { name: "Sauce", quantity: 35, unit: "gram", subRecipeId: "sauce" },
    ],
    documentation: { preparationMethod: "Grill the patty." },
  });

  test("individual and selected recipe PDFs generate from canonical data", () => {
    const one = recipesPdfBytes([bigNac]);
    expect(new Uint8Array(one)[0]).toBe(0x25);
    const selected = recipesPdfBytes([bigNac, { ...bigNac, name: "Conchiglie" }], { title: "Selected recipes" });
    expect(new Uint8Array(selected)[0]).toBe(0x25);
    expect(recipePdfPlaintext(bigNac)).toContain("Beef Patty — 180 gram");
  });

  test("generated PDF plaintext reflects the latest canonical edit, not the imported source", () => {
    const edited = snapshotFromRecipeRecord({
      row: { displayName: "Big NAC", guestStatus: "live", kind: "menu_item" },
      lines: [{ name: "Beef Patty", quantity: 170, unit: "gram", ingredientId: "patty" }],
    });
    expect(recipePdfPlaintext(edited)).toContain("Beef Patty — 170 gram");
    expect(recipePdfPlaintext(edited)).not.toContain("180");
    const imported = snapshotFromExtractedRecipe({
      ksaOperationalTitle: "Big NAC",
      ingredients: [{ sourceName: "Beef Patty", sourceQuantity: 180, sourceUnit: "g" }],
    }, { operationallyActive: true });
    expect(recipePdfPlaintext(imported)).toContain("180");
  });

  test("generated PDF includes a source photograph when the canonical snapshot has one", () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const withPhoto = { ...bigNac, imageDataUrl: png };
    expect(new Uint8Array(recipesPdfBytes([withPhoto]))[0]).toBe(0x25);
  });

  test("recipe-tree PDF includes each referenced component once after the finished dish", () => {
    const order = flattenSelectedRecipeTrees(["steak", "quinoa"], {
      steak: [{ subRecipeId: "sauce" }],
      sauce: [{ subRecipeId: "demi" }, { subRecipeId: "demi" }],
      quinoa: [{ subRecipeId: "sauce" }],
      demi: [],
    });
    expect(order).toEqual(["steak", "sauce", "demi", "quinoa"]);
  });

  test("Beetroot Hummus & Feta preserves the component boundary instead of flattening hummus ingredients", () => {
    const beetroot = snapshotFromRecipeRecord({
      row: {
        recipeId: "beetroot-hummus-feta",
        displayName: "Beetroot Hummus & Feta",
        categoryName: "Nibbles",
        guestStatus: "live",
        kind: "menu_item",
        outputQuantity: 1,
        outputUnit: "each",
      },
      lines: [
        { name: "Beetroot hummus", quantity: 110, unit: "gram", subRecipeId: "hummus-batch" },
        { name: "Feta", quantity: 12, unit: "gram", ingredientId: "feta", preparationNote: "Crumbled" },
        { name: "Pumpkin seeds", quantity: 4, unit: "gram", ingredientId: "pumpkin", preparationNote: "Toasted" },
        { name: "Parsley", quantity: 2, unit: "gram", ingredientId: "parsley", preparationNote: "Thinly chopped" },
        { name: "Olive oil", quantity: 5, unit: "millilitre", ingredientId: "oil" },
        { name: "Za'atar powder", quantity: 2, unit: "gram", ingredientId: "zaatar" },
        { name: "Pita bread", quantity: 2, unit: "each", ingredientId: "pita", preparationNote: "Heated, 120gram" },
      ],
      documentation: {
        preparationMethod: "Using gloves, crumble the feta with the hands.\nToast the pumpkin seeds.\nToast the Pita bread.",
        platingInstructions: "Spread the beet hummus at the bottom of the serving dish.",
        allergens: "Gluten / sesame / dairy",
        utensils: "Plating spoons / tray / gloves",
        prepTime: "15 minutes",
        menuSection: "Nibbles",
      },
    });

    expect(beetroot.ingredients).toHaveLength(7);
    expect(beetroot.ingredients[0]).toEqual(expect.objectContaining({
      name: "Beetroot hummus",
      quantity: 110,
      unit: "gram",
      isComponent: true,
      subRecipeId: "hummus-batch",
    }));
    const text = recipePdfPlaintext(beetroot);
    expect(text).toContain("Beetroot hummus (component) — 110 gram");
    expect(text).toContain("Feta — 12 gram");
    expect(text).not.toContain("Canned chickpeas");
    expect(text).not.toContain("3304");
    expect(text).not.toMatch(/^Gluten \/ sesame/m);
    expect(beetroot.ingredients.some((row) => /gluten|sesame|dairy|nibbles/i.test(row.name))).toBe(false);
    expect(beetroot.method).not.toContain("Spread the beet hummus");
    expect(beetroot.plating).toContain("Spread the beet hummus");
    const hummus = snapshotFromRecipeRecord({
      row: { recipeId: "hummus-batch", displayName: "Beetroot hummus", recipeType: "preparation", kind: "component" },
      lines: [
        { name: "Canned chickpeas", quantity: 800, unit: "gram", ingredientId: "chickpea" },
        { name: "Cooked beetroot", quantity: 720, unit: "gram", ingredientId: "beet" },
      ],
      documentation: { preparationMethod: "Blend chickpeas with beetroot." },
    });
    const treeText = [recipePdfPlaintext(beetroot), recipePdfPlaintext(hummus)].join("\n---\n");
    expect(treeText.split("Blend chickpeas with beetroot.").length - 1).toBe(1);
    expect(recipePdfPlaintext(beetroot)).not.toContain("Blend chickpeas");
    expect(new Uint8Array(recipesPdfBytes([beetroot, hummus], { mode: "recipe_book" }))[0]).toBe(0x25);
  });

  test("Food Bible and Recipe Book produce distinct combined filenames", () => {
    expect(recipePdfFilename("all", { combined: true, mode: "food_bible" })).toMatch(/^nac-food-bible-/);
    expect(recipePdfFilename("all", { combined: true, mode: "recipe_book" })).toMatch(/^nac-recipe-book-/);
  });

  test("current Food Bible excludes archived Apple Bircher", () => {
    const bircher = snapshotFromExtractedRecipe({
      ksaOperationalTitle: "Apple Bircher",
      ingredients: [{ sourceName: "Oats", sourceQuantity: 80, sourceUnit: "g" }],
    }, { operationallyActive: false });
    const bible = currentFoodBibleSnapshots([bigNac, bircher]);
    expect(bible).toHaveLength(1);
    expect(bible[0].name).toBe("Big NAC");
    const bytes = recipesPdfBytes(bible, { title: "NAC Food Bible", mode: "food_bible" });
    expect(new Uint8Array(bytes)[0]).toBe(0x25);
    expect(recipePdfPlaintext(bircher)).toContain("Apple Bircher");
  });
});
