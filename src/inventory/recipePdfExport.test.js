import {
  currentFoodBibleSnapshots,
  recipePdfPlaintext,
  recipesPdfBytes,
  snapshotFromExtractedRecipe,
  snapshotFromRecipeRecord,
} from "./recipePdfExport";

describe("recipePdfExport", () => {
  const bigNac = snapshotFromRecipeRecord({
    row: {
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

  test("current Food Bible excludes archived Apple Bircher", () => {
    const bircher = snapshotFromExtractedRecipe({
      ksaOperationalTitle: "Apple Bircher",
      ingredients: [{ sourceName: "Oats", sourceQuantity: 80, sourceUnit: "g" }],
    }, { operationallyActive: false });
    const bible = currentFoodBibleSnapshots([bigNac, bircher]);
    expect(bible).toHaveLength(1);
    expect(bible[0].name).toBe("Big NAC");
    const bytes = recipesPdfBytes(bible, { title: "NAC Food Bible" });
    expect(new Uint8Array(bytes)[0]).toBe(0x25);
    expect(recipePdfPlaintext(bircher)).toContain("Apple Bircher");
  });
});
