import {
  adaptFoodBibleIngredientForKsa,
  adaptFoodBibleRecipeForKsa,
  findMethodIngredientMismatches,
  isCookingWine,
  isWineVinegar,
  ksaOperationalRecipeTitle,
  ksaZeroAlcoholWineName,
} from "./foodBibleKsaAdaptation";

describe("Food Bible KSA adaptations", () => {
  test("renames Vodka Tomato Sauce to Tomato Sauce without vodka wording", () => {
    const result = ksaOperationalRecipeTitle("VODKA TOMATO SAUCE");
    expect(result.ksaOperationalTitle).toBe("TOMATO SAUCE");
    expect(result.adaptation.rule).toBe("VODKA_TOMATO_SAUCE_RENAME");
    expect(result.ksaOperationalTitle).not.toMatch(/vodka/i);
  });

  test("maps vodka tomato sauce ingredient to Tomato Sauce subrecipe reference", () => {
    const adapted = adaptFoodBibleIngredientForKsa({
      sourceName: "Vodka tomato sauce",
      sourceQuantity: 400,
      sourceUnit: "g",
    });
    expect(adapted.includeInKsaRecipe).toBe(true);
    expect(adapted.ksaOperationalName).toBe("Tomato Sauce");
    expect(adapted.adaptations[0].rule).toBe("VODKA_TOMATO_SAUCE_RENAME");
  });

  test("excludes vodka spirit lines and preserves source evidence", () => {
    const adapted = adaptFoodBibleIngredientForKsa({
      sourceName: "Vodka",
      sourceQuantity: 200,
      sourceUnit: "ml",
      sourceLocator: "page 4",
    });
    expect(adapted.includeInKsaRecipe).toBe(false);
    expect(adapted.adaptations[0].type).toBe("EXCLUDE_SPIRIT");
    expect(adapted.sourceEvidence.sourceQuantity).toBe(200);
    expect(adapted.sourceEvidence.sourceLocator).toBe("page 4");
  });

  test("maps red and white wine to 0.0% alcohol equivalents and keeps vinegar unchanged", () => {
    expect(isWineVinegar("White wine vinegar")).toBe(true);
    expect(isCookingWine("White wine vinegar")).toBe(false);
    expect(ksaZeroAlcoholWineName("Red Wine")).toBe("Red Wine 0.0% Alcohol");
    expect(ksaZeroAlcoholWineName("White Wine")).toBe("White Wine 0.0% Alcohol");

    const wine = adaptFoodBibleIngredientForKsa({
      sourceName: "Red Wine",
      sourceQuantity: 100,
      sourceUnit: "ml",
    });
    expect(wine.includeInKsaRecipe).toBe(true);
    expect(wine.ksaOperationalName).toBe("Red Wine 0.0% Alcohol");
    expect(wine.adaptations[0].quantityPreserved).toBe(true);

    const vinegar = adaptFoodBibleIngredientForKsa({
      sourceName: "White wine vinegar",
      sourceQuantity: 750,
      sourceUnit: "g",
    });
    expect(vinegar.ksaOperationalName).toBe("White wine vinegar");
    expect(vinegar.adaptations).toHaveLength(0);
  });

  test("flags method vodka without ingredient-table quantity as source inconsistency", () => {
    const issues = findMethodIngredientMismatches({
      methodText: "deglaze it with the vodka and let it reduce fully",
      ingredients: [
        { sourceName: "Tinned tomatoes" },
        { sourceName: "Double cream" },
      ],
    });
    expect(issues).toEqual([
      expect.objectContaining({
        code: "SOURCE_RECIPE_INCONSISTENCY",
        detail: expect.stringMatching(/vodka/i),
        ksaBlocking: false,
        ksaPolicy: "INTENTIONAL_SPIRIT_EXCLUSION_NO_KSA_QTY_REQUIRED",
      }),
    ]);
  });

  test("adapts a full recipe while preserving international source title evidence", () => {
    const adapted = adaptFoodBibleRecipeForKsa({
      sourceTitle: "VODKA TOMATO SAUCE",
      ingredients: [
        { sourceName: "Tinned tomatoes", sourceQuantity: 12500, sourceUnit: "g" },
        { sourceName: "Vodka", sourceQuantity: null, sourceUnit: null },
        { sourceName: "Double cream", sourceQuantity: 2300, sourceUnit: "g" },
      ],
      method: ["deglaze it with the vodka and let it reduce fully"],
    });
    expect(adapted.sourceTitle).toBe("VODKA TOMATO SAUCE");
    expect(adapted.ksaOperationalTitle).toBe("TOMATO SAUCE");
    expect(adapted.ksaIngredients.map((item) => item.ksaOperationalName)).toEqual([
      "Tinned tomatoes",
      "Double cream",
    ]);
    expect(adapted.excludedIngredients).toHaveLength(1);
    expect(adapted.excludedIngredients[0].sourceName).toBe("Vodka");
    expect(adapted.operationalMarket).toBe("KSA");
    expect(adapted.sourceMarket).toBe("international");
  });
});
