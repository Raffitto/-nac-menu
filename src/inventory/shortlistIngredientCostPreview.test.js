import {
  buildShortlistIngredientCostPreview,
  classifyMenuPlacements,
  collectShortlistIngredientUniverse,
  findPossibleDuplicateCanonicals,
} from "./shortlistIngredientCostPreview";

const SHORTLIST_RECIPES = [
  {
    recipeKind: "finished",
    sourceFile: "Rigatoni.pdf",
    sourceTitle: "RIGATONI, PINK SAUCE, BASIL, CHILI, PARMIGIANO",
    ksaOperationalTitle: "RIGATONI, PINK SAUCE, BASIL, CHILI, PARMIGIANO",
    yieldRaw: "1 Pax",
    ksaIngredients: [
      { ksaOperationalName: "Rigatonni pasta (De Ceddo)", sourceUnit: "g", sourceQuantity: 200 },
      { ksaOperationalName: "Tomato Sauce", sourceUnit: "g", sourceQuantity: 400 },
      { ksaOperationalName: "Parmigianno", sourceUnit: "g", sourceQuantity: 22 },
      { ksaOperationalName: "Extra virgin olive oil", sourceUnit: "g", sourceQuantity: 10 },
    ],
  },
  {
    recipeKind: "prep",
    sourceFile: "Rigatoni.pdf",
    sourceTitle: "VODKA TOMATO SAUCE",
    ksaOperationalTitle: "TOMATO SAUCE",
    yieldRaw: "16.5 KG",
    ksaIngredients: [
      { ksaOperationalName: "Tinned tomatoes", sourceUnit: "g", sourceQuantity: 12500 },
      { ksaOperationalName: "Double cream", sourceUnit: "g", sourceQuantity: 2300 },
      { ksaOperationalName: "Olive oil", sourceUnit: "g", sourceQuantity: 300 },
    ],
  },
  {
    recipeKind: "finished",
    sourceFile: "Halloumi.pdf",
    sourceTitle: "HALLOUMI",
    ksaOperationalTitle: "HALLOUMI",
    yieldRaw: null,
    ksaIngredients: [
      { ksaOperationalName: "Halloumi", sourceUnit: "g", sourceQuantity: 95 },
      { ksaOperationalName: "Olive oil", sourceUnit: "ml", sourceQuantity: 15 },
    ],
  },
];

describe("shortlist ingredient + July cost preview", () => {
  test("collects deduplicated cost-bearing ingredient universe across dependency graph", () => {
    const universe = collectShortlistIngredientUniverse(SHORTLIST_RECIPES);
    const names = universe.ingredients.map((i) => i.proposedCanonicalName);
    expect(names).toEqual(expect.arrayContaining(["Rigatoni pasta", "Parmigiano", "Tinned tomatoes", "Double cream", "Halloumi"]));
    expect(names).not.toContain("Tomato Sauce");
    expect(findPossibleDuplicateCanonicals(universe.ingredients).some((d) => d.group === "olive_oil")).toBe(true);
  });

  test("does not treat verification cream invoices as culinary July cost", () => {
    const preview = buildShortlistIngredientCostPreview({
      recipes: SHORTLIST_RECIPES,
      canonicalIngredients: [],
      invoiceLines: [
        {
          id: "x",
          original_description: "VERIFICATION CREAM 12X1L",
          normalized_description: "verification cream 12x1l",
          unit_price: 28,
          review_status: "verified",
        },
      ],
      baselines: [],
      costHistory: [],
    });
    expect(preview.summary.trustedJulyCosts).toBe(0);
    expect(preview.summary.noJulyCost).toBe(preview.summary.uniqueIngredientCount);
    expect(preview.summary.productionMutation).toBe(false);
    expect(preview.ingredients.every((i) => i.previewClassification.status === "NEEDS_REVIEW")).toBe(true);
  });

  test("classifies same-name same-price daypart placements as one culinary recipe", () => {
    const reviews = classifyMenuPlacements(
      [
        { id: "1", name: "Rigatoni Pink Sauce", price: "72 SAR", section_id: "a" },
        { id: "2", name: "Rigatoni Pink Sauce", price: "72 SAR", section_id: "b" },
        { id: "3", name: "Rigatoni Pink Sauce", price: "72 SAR", section_id: "c" },
      ],
      {
        a: { name_en: "Plates", daypart: "Brunch" },
        b: { name_en: "Mains", daypart: "Daytime" },
        c: { name_en: "Mains", daypart: "Evening Menu" },
      }
    );
    expect(reviews[0].classification).toBe("SAME_CULINARY_PRODUCT_DIFFERENT_PLACEMENTS");
    expect(reviews[0].proposal).toBe("ONE_CULINARY_RECIPE_MULTIPLE_MENU_PLACEMENTS");
  });
});
