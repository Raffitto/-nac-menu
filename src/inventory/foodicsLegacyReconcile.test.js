import {
  parseFoodicsProductIngredientCsv,
  deriveFoodicsReferenceUnitCost,
  classifyFoodicsBrandScope,
  classifyFoodicsRecordType,
  reconcileShortlistWithFoodics,
} from "./foodicsLegacyReconcile";

const SAMPLE_CSV = `product_sku,product_name,product_name_localized,inventory_item_sku,inventory_item_name,inventory_item_name_localized,quantity,unit,ingredient_cost
sk-1174,Rigatoni,,sk-1092,Parmesan Cheese,,21,Gm,1.1889560611107
sk-1174,Rigatoni,,sk-1172,NAC-Pasta Cooking (RIgatoni),,130,Gm,
sk-0631,Cajun Chicken,,sk-0613,NAC-Cajun Chicken,,207,Gm,10.98829485
sk-0628,Halloumi Grilled,,sk-1081,Halloumi Cheese,,120,Gm,3.8325694819963
sk-0629,Truffle Burger,,sk-0530,Beef Minced,,150,Gm,5.8050483961062
sk-0629,Truffle Burger,,sk-0658,NAC-Truffle Mayonnaise,,40,Gm,
sk-0613,Halloumi fries,,sk-1081,Halloumi Cheese,,250,Gm,7.9845197541589
`;

describe("foodicsLegacyReconcile", () => {
  test("parses Foodics CSV and keeps skus as external evidence only", () => {
    const rows = parseFoodicsProductIngredientCsv(SAMPLE_CSV);
    expect(rows).toHaveLength(7);
    expect(rows[0].externalSystem).toBe("foodics");
    expect(rows[0].productSku).toBe("sk-1174");
    expect(rows[0].inventoryItemSku).toBe("sk-1092");
  });

  test("derives Foodics reference unit cost without treating it as trusted WAC", () => {
    const ref = deriveFoodicsReferenceUnitCost({
      quantity: 150,
      unit: "Gm",
      ingredientCost: 5.8050483961062,
    });
    expect(ref.label).toBe("LEGACY_FOODICS_REFERENCE");
    expect(ref.status).toBe("FOODICS_REFERENCE_COST");
    expect(ref.impliedUnit).toBe("kg");
    expect(ref.impliedUnitCost).toBeCloseTo(38.700322640708, 4);
  });

  test("Foodics zero cost is missing/unreliable, not legitimate zero", () => {
    const ref = deriveFoodicsReferenceUnitCost({
      quantity: 40,
      unit: "Gm",
      ingredientCost: 0,
    });
    expect(ref.status).toBe("MISSING_OR_UNRELIABLE_COST");
  });

  test("classifies SPT as other brand and NAC- as prep candidate", () => {
    expect(classifyFoodicsBrandScope("SPT-Caesar Dressing").brandScope).toBe("SPT");
    expect(classifyFoodicsRecordType("NAC-Truffle Mayonnaise")).toBe("PREP_SUBRECIPE");
    expect(classifyFoodicsRecordType("Halloumi Cheese")).toBe("PURCHASED_INGREDIENT");
  });

  test("reconciles shortlist Food Bible vs Foodics without production mutation", () => {
    const recipes = [
      {
        recipeKind: "finished",
        sourceTitle: "RIGATONI, PINK SAUCE, BASIL, CHILI, PARMIGIANO",
        ksaOperationalTitle: "RIGATONI, PINK SAUCE, BASIL, CHILI, PARMIGIANO",
        sourceFile: "Rigatoni.pdf",
        ksaIngredients: [
          { sourceName: "Parmigianno", ksaOperationalName: "Parmigianno", sourceQuantity: 22, sourceUnit: "g" },
          { sourceName: "Tomato Sauce", ksaOperationalName: "Tomato Sauce", sourceQuantity: 400, sourceUnit: "g" },
        ],
      },
      {
        recipeKind: "finished",
        sourceTitle: "FREE RANGE GRILLED CAJUN CHICKEN, CORN, TOMATOES",
        ksaOperationalTitle: "FREE RANGE GRILLED CAJUN CHICKEN, CORN, TOMATOES",
        sourceFile: "Cajun.pdf",
        ksaIngredients: [
          { sourceName: "Cajun chicken fillet (cooked)", ksaOperationalName: "Cajun chicken fillet (cooked)", sourceQuantity: 1, sourceUnit: "unit" },
        ],
      },
      {
        recipeKind: "finished",
        sourceTitle: "HALLOUMI",
        ksaOperationalTitle: "HALLOUMI",
        sourceFile: "Halloumi.pdf",
        ksaIngredients: [
          { sourceName: "Halloumi", ksaOperationalName: "Halloumi", sourceQuantity: 95, sourceUnit: "g" },
        ],
      },
      {
        recipeKind: "finished",
        sourceTitle: "TRUFFLE BURGER, MONTERREY JACK, TRUFFLE MAYO",
        ksaOperationalTitle: "TRUFFLE BURGER, MONTERREY JACK, TRUFFLE MAYO",
        sourceFile: "Truffle burger.pdf",
        ksaIngredients: [
          { sourceName: "Minced beef", ksaOperationalName: "Minced beef", sourceQuantity: 150, sourceUnit: "g" },
          { sourceName: "Truffle mayonnaise", ksaOperationalName: "Truffle mayonnaise", sourceQuantity: 40, sourceUnit: "g" },
        ],
      },
    ];

    const report = reconcileShortlistWithFoodics({
      recipes,
      foodicsRows: parseFoodicsProductIngredientCsv(SAMPLE_CSV),
      modifierRows: [
        {
          productSku: "sk-0629",
          modifierName: "Steak Cook Option",
          minimumOptions: 1,
          maximumOptions: 1,
        },
      ],
    });

    expect(report.productionMutation).toBe(false);
    expect(report.readyForApproval).toEqual([]);
    expect(report.realKhobarPurchaseCostStillRequired).toBe(true);
    expect(report.summary.shortlistDishes).toBe(4);

    const rigatoni = report.groups.find((g) => g.shortlistKey === "RIGATONI");
    const parm = rigatoni.reconciliations.find((r) => /parmig/i.test(r.foodBibleSourceName || ""));
    expect(parm.foodicsMatch).toBe(true);
    expect(parm.foodicsInventorySku).toBe("sk-1092");
    expect(parm.sourceConflict?.code).toBe("SOURCE_RECIPE_CONFLICT");
    expect(parm.foodicsReferenceCost.label).toBe("LEGACY_FOODICS_REFERENCE");

    const burger = report.groups.find((g) => g.shortlistKey === "TRUFFLE_BURGER");
    expect(burger.modifiers[0].stockEffectClass).toBe("REVIEW_REQUIRED");
    const minced = burger.reconciliations.find((r) => /minced beef/i.test(r.foodBibleSourceName || ""));
    expect(minced.confidence).toBe("HIGH");
    expect(minced.externalRefs.external_system).toBe("foodics");
  });
});
