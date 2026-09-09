import {
  ACTUAL_COVERAGE,
  CONVERSION_STATUS,
  COST_CLASS,
  GRAPH_STATUS,
  THEORETICAL_LEDGER_CONTRACT,
  VARIANCE_STATUS,
  buildRecipeGraph,
  classifyIngredientIdentities,
  classifyMissingCost,
  computeTheoreticalFoodCost,
  computeTheoreticalLedger,
  computeVariance,
  expandRecipeToIngredients,
  resolveActualConsumption,
  resolveCanonicalCost,
  resolveRecipeLineUom,
  runInventoryTruthEngine,
  summarizeUomCoverage,
  theoreticalConsumedQuantity,
  traceIngredientQuantity,
} from "./index";

const ingredients = [
  { id: "honey", canonical_name: "Honey", base_inventory_unit: "gram", active: true },
  { id: "salt", canonical_name: "Maldon Salt", base_inventory_unit: "gram", active: true },
  { id: "potato", canonical_name: "Sweet Potato", base_inventory_unit: "kilogram", active: true },
  { id: "ocr", canonical_name: "INV-OCR tomato [temp verify]", base_inventory_unit: "gram", active: true },
  { id: "legacy", canonical_name: "Old Oil", base_inventory_unit: "litre", active: false },
];

function platedGraph() {
  return buildRecipeGraph({
    ingredients,
    recipes: [
      { id: "steak", name: "Steak", menu_item_id: "menu-steak", recipe_type: "menu_item", output_quantity: "1", output_unit: "each", active: true },
      { id: "dressing", name: "House Dressing", recipe_type: "sub_recipe", output_quantity: "100", output_unit: "gram", active: true },
      { id: "salad", name: "House Salad", menu_item_id: "menu-salad", recipe_type: "menu_item", output_quantity: "1", output_unit: "each", active: true },
      { id: "toast", name: "French Toast", menu_item_id: "menu-toast", recipe_type: "menu_item", output_quantity: "1", output_unit: "each", active: true },
    ],
    versions: [
      { id: "v-steak", recipe_id: "steak", status: "active", yield_percentage: 100 },
      { id: "v-dressing", recipe_id: "dressing", status: "active", yield_percentage: 100 },
      { id: "v-salad", recipe_id: "salad", status: "active", yield_percentage: 100 },
      { id: "v-toast", recipe_id: "toast", status: "active", yield_percentage: 100 },
    ],
    lines: [
      { id: "l1", recipe_version_id: "v-steak", ingredient_id: "salt", quantity: "2", unit: "g" },
      { id: "l2", recipe_version_id: "v-dressing", ingredient_id: "honey", quantity: "10", unit: "g" },
      { id: "l3", recipe_version_id: "v-salad", sub_recipe_id: "dressing", quantity: "20", unit: "g" },
      { id: "l4", recipe_version_id: "v-salad", ingredient_id: "potato", quantity: "80", unit: "g" },
      { id: "l5", recipe_version_id: "v-toast", ingredient_id: "honey", quantity: "15", unit: "g" },
    ],
  });
}

describe("canonical ingredient identity", () => {
  test("uses inventory id as identity and does not invent SKUs", () => {
    const result = classifyIngredientIdentities({
      ingredients,
      catalogueItems: [
        { id: "c1", ingredientId: "honey", supplierSku: "HON-1", verification_state: "verified", original_product_name: "Honey" },
      ],
    });
    const honey = result.identities.find((row) => row.canonicalIngredientId === "honey");
    expect(honey.sku).toBe("HON-1");
    expect(honey.sourceSystem).toBe("nac_inventory");
    const salt = result.identities.find((row) => row.canonicalIngredientId === "salt");
    expect(salt.sku).toBe(null);
    expect(salt.identityIssues).toContain("missing_sku");
  });

  test("does not auto-merge duplicate normalized names or colliding SKUs", () => {
    const result = classifyIngredientIdentities({
      ingredients: [
        { id: "a", canonical_name: "Honey", base_inventory_unit: "gram", active: true },
        { id: "b", canonical_name: "Honey", base_inventory_unit: "gram", active: true },
      ],
      catalogueItems: [
        { ingredientId: "a", supplierSku: "X", verification_state: "verified", original_product_name: "Honey A" },
        { ingredientId: "b", supplierSku: "X", verification_state: "verified", original_product_name: "Honey B" },
      ],
    });
    expect(result.identities).toHaveLength(2);
    expect(result.duplicateNormalizedNames[0].ingredientIds).toEqual(["a", "b"]);
    expect(result.skuIssues.some((issue) => issue.code === "duplicate_sku")).toBe(true);
    expect(result.identities.every((row) => row.identityIssues.includes("same_normalized_name_different_id"))).toBe(true);
  });
});

describe("UOM truth", () => {
  test("converts kg to g and litres to ml, and keeps exact units", () => {
    expect(resolveRecipeLineUom({ quantity: "1", unit: "kg", baseUom: "gram" })).toMatchObject({
      quantityBase: "1000",
      conversionStatus: CONVERSION_STATUS.CONVERTED,
    });
    expect(resolveRecipeLineUom({ quantity: "2", unit: "l", baseUom: "millilitre" })).toMatchObject({
      quantityBase: "2000",
      conversionStatus: CONVERSION_STATUS.CONVERTED,
    });
    expect(resolveRecipeLineUom({ quantity: "5", unit: "g", baseUom: "gram" }).conversionStatus).toBe(CONVERSION_STATUS.EXACT);
  });

  test("does not invent ml↔g or packaging units", () => {
    expect(resolveRecipeLineUom({ quantity: "100", unit: "ml", baseUom: "gram" }).conversionStatus).toBe(CONVERSION_STATUS.INCOMPATIBLE);
    expect(resolveRecipeLineUom({ quantity: "1", unit: "bottle", baseUom: "litre" }).conversionStatus).toBe(CONVERSION_STATUS.UNKNOWN);
    expect(resolveRecipeLineUom({ quantity: "1", unit: "cup", baseUom: "millilitre" }).conversionStatus).toBe(CONVERSION_STATUS.UNKNOWN);
  });

  test("summarizes blocked vs converted lines", () => {
    const summary = summarizeUomCoverage([
      resolveRecipeLineUom({ quantity: "1", unit: "kg", baseUom: "gram" }),
      resolveRecipeLineUom({ quantity: "1", unit: "bottle", baseUom: "litre" }),
    ]);
    expect(summary.convertible).toBe(1);
    expect(summary.blocked).toBe(1);
  });
});

describe("recipe graph expansion", () => {
  test("expands nested sub-recipes without double counting the sub-recipe itself", () => {
    const graph = platedGraph();
    const expanded = expandRecipeToIngredients({ recipeId: "salad", outputNeeded: "5", graph });
    expect(expanded.ingredients.has("dressing")).toBe(false);
    expect(expanded.ingredients.get("honey").quantityBase).toBe("10");
    expect(expanded.ingredients.get("potato").quantityBase).toBe("0.4");
  });

  test("detects circular recipes and missing sub-recipes", () => {
    const graph = buildRecipeGraph({
      ingredients,
      recipes: [
        { id: "a", name: "A", output_quantity: "1", active: true },
        { id: "b", name: "B", output_quantity: "1", active: true },
      ],
      versions: [
        { id: "va", recipe_id: "a", status: "active" },
        { id: "vb", recipe_id: "b", status: "active" },
      ],
      lines: [
        { id: "1", recipe_version_id: "va", sub_recipe_id: "b", quantity: "1", unit: "each" },
        { id: "2", recipe_version_id: "vb", sub_recipe_id: "a", quantity: "1", unit: "each" },
      ],
    });
    const circular = expandRecipeToIngredients({ recipeId: "a", outputNeeded: "1", graph });
    expect(circular.issues.some((issue) => issue.code === GRAPH_STATUS.CIRCULAR)).toBe(true);

    const missing = expandRecipeToIngredients({
      recipeId: "a",
      outputNeeded: "1",
      graph: buildRecipeGraph({
        ingredients,
        recipes: [{ id: "a", name: "A", output_quantity: "1", active: true }],
        versions: [{ id: "va", recipe_id: "a", status: "active" }],
        lines: [{ id: "1", recipe_version_id: "va", sub_recipe_id: "ghost", quantity: "1", unit: "each" }],
      }),
    });
    expect(missing.issues.some((issue) => issue.code === GRAPH_STATUS.MISSING_SUB_RECIPE)).toBe(true);
  });

  test("does not silently choose among multiple active versions or inactive versions", () => {
    const multi = buildRecipeGraph({
      ingredients,
      recipes: [{ id: "a", name: "A", output_quantity: "1", active: true }],
      versions: [
        { id: "v1", recipe_id: "a", status: "active" },
        { id: "v2", recipe_id: "a", status: "active" },
      ],
      lines: [],
    });
    expect(expandRecipeToIngredients({ recipeId: "a", outputNeeded: "1", graph: multi }).issues[0].code)
      .toBe(GRAPH_STATUS.MULTIPLE_ACTIVE_VERSIONS);

    const inactive = buildRecipeGraph({
      ingredients,
      recipes: [{ id: "a", name: "A", output_quantity: "1", active: true }],
      versions: [{ id: "v1", recipe_id: "a", status: "retired" }],
      lines: [],
    });
    expect(expandRecipeToIngredients({ recipeId: "a", outputNeeded: "1", graph: inactive }).issues[0].code)
      .toBe(GRAPH_STATUS.LEGACY_RECIPE);
  });

  test("flags missing and invalid quantities", () => {
    const graph = buildRecipeGraph({
      ingredients,
      recipes: [{ id: "a", name: "A", output_quantity: "1", active: true }],
      versions: [{ id: "va", recipe_id: "a", status: "active" }],
      lines: [
        { id: "1", recipe_version_id: "va", ingredient_id: "honey", unit: "g" },
        { id: "2", recipe_version_id: "va", ingredient_id: "salt", quantity: "0", unit: "g" },
      ],
    });
    const expanded = expandRecipeToIngredients({ recipeId: "a", outputNeeded: "1", graph });
    expect(expanded.issues.some((issue) => issue.code === GRAPH_STATUS.MISSING_QUANTITY)).toBe(true);
    expect(expanded.issues.some((issue) => issue.code === GRAPH_STATUS.INVALID_QUANTITY)).toBe(true);
  });
});

describe("theoretical consumption and coverage", () => {
  test("multiplies aggregated sales by expanded recipes and traces the path", () => {
    const graph = platedGraph();
    const theoretical = computeTheoreticalLedger({
      graph,
      identities: classifyIngredientIdentities({ ingredients }).identities,
      salesRows: [
        { matched_menu_item_id: "menu-steak", matched_menu_item_name: "Steak", quantity_sold: 10, net_sales: 900, branch_id: "khobar", period_start: "2026-08-01", period_end: "2026-08-07" },
        { matched_menu_item_id: "menu-toast", matched_menu_item_name: "French Toast", quantity_sold: 4, net_sales: 220, branch_id: "khobar" },
      ],
      periodStart: "2026-08-01",
      periodEnd: "2026-08-07",
      branchId: "khobar",
    });
    const salt = theoretical.rows.find((row) => row.canonicalIngredientId === "salt");
    expect(salt.quantityTheoreticallyConsumed).toBe("20");
    expect(salt.traces[0].soldQuantity).toBe("10");
    expect(salt.traces[0].path[0].recipeName).toBe("Steak");
    expect(theoretical.coverage.recipeCoveredSoldRows).toBe(2);
    expect(theoretical.coverage.mappedRevenue).toBe("1120");
  });

  test("sales linked to a recipe without an active version stay uncovered", () => {
    const graph = buildRecipeGraph({
      ingredients,
      recipes: [{ id: "toast", name: "French Toast", menu_item_id: "menu-toast", output_quantity: "1", active: true }],
      versions: [{ id: "v-toast", recipe_id: "toast", status: "draft" }],
      lines: [{ id: "l1", recipe_version_id: "v-toast", ingredient_id: "honey", quantity: "15", unit: "g" }],
    });
    const theoretical = computeTheoreticalLedger({
      graph,
      salesRows: [{
        matched_menu_item_id: "menu-toast",
        matched_menu_item_name: "French Toast",
        quantity_sold: 4,
        net_sales: 220,
      }],
    });
    expect(theoretical.rows).toHaveLength(0);
    expect(theoretical.coverage.recipeCoveredSoldRows).toBe(0);
    expect(theoretical.coverage.recipeUncoveredSoldRows).toBe(1);
    expect(theoretical.uncoveredSales[0].reason).toBe(GRAPH_STATUS.INACTIVE_VERSION);
    expect(theoretical.uncoveredSales[0].soldQuantity).toBe("4");
    expect(theoretical.coverage.unmappedRevenue).toBe("220");
  });

  test("never hides unmapped sales or treats them as zero consumption", () => {
    const graph = platedGraph();
    const theoretical = computeTheoreticalLedger({
      graph,
      salesRows: [
        { matched_menu_item_id: "menu-unknown", matched_menu_item_name: "Mystery", quantity_sold: 7, net_sales: 70 },
      ],
    });
    expect(theoretical.rows).toHaveLength(0);
    expect(theoretical.coverage.recipeUncoveredSoldRows).toBe(1);
    expect(theoretical.coverage.unmappedRevenue).toBe("70");
    expect(theoretical.uncoveredSales[0].soldQuantity).toBe("7");
  });
});

describe("cost truth", () => {
  test("missing cost stays null and is not priced at zero", () => {
    const missing = resolveCanonicalCost(ingredients[0], {});
    expect(missing.value).toBe(null);
    expect(missing.coverageStatus).toBe(COST_CLASS.NO_PURCHASE_HISTORY);
    expect(classifyMissingCost(ingredients[3], {})).toBe(COST_CLASS.OCR_PLACEHOLDER);
    expect(classifyMissingCost(ingredients[4], {})).toBe(COST_CLASS.LEGACY_SOURCE);

    const zero = resolveCanonicalCost(ingredients[0], {
      costState: { weighted_average_cost: "0", last_purchase_at: "2026-07-01", last_purchase_price: "0" },
    });
    expect(zero.coverageStatus).toBe(COST_CLASS.VERIFIED_ZERO);
    expect(zero.value).toBe("0");

    const defaultZero = resolveCanonicalCost(ingredients[0], {
      costState: { weighted_average_cost: "0" },
    });
    expect(defaultZero.value).toBe(null);
    expect(defaultZero.coverageStatus).toBe(COST_CLASS.INGREDIENT_COST_NULL);

    expect(THEORETICAL_LEDGER_CONTRACT.quantityField).toBe("quantityTheoreticallyConsumed");
    expect(theoreticalConsumedQuantity({ quantityBase: "10" })).toBe(null);
    expect(theoreticalConsumedQuantity({ quantityTheoreticallyConsumed: "10" })).toBe("10");

    const ignoredLegacyField = computeTheoreticalFoodCost(
      [{ canonicalIngredientId: "honey", quantityBase: "10" }],
      { honey: { value: "3", coverageStatus: COST_CLASS.VALID } },
    );
    expect(ignoredLegacyField.calculatedTheoreticalFoodCost).toBe(null);

    const foodCost = computeTheoreticalFoodCost(
      [
        { canonicalIngredientId: "honey", quantityTheoreticallyConsumed: "10" },
        { canonicalIngredientId: "salt", quantityTheoreticallyConsumed: "2" },
      ],
      {
        honey: { value: "3", coverageStatus: COST_CLASS.VALID },
        salt: { value: null, coverageStatus: COST_CLASS.NO_PURCHASE_HISTORY },
      },
    );
    expect(foodCost.calculatedTheoreticalFoodCost).toBe("30");
    expect(foodCost.uncostedIngredientCount).toBe(1);
    expect(computeTheoreticalFoodCost(
      [{ canonicalIngredientId: "honey", quantityTheoreticallyConsumed: "10" }],
      { honey: { value: "3", coverageStatus: COST_CLASS.VALID } },
    ).calculatedTheoreticalFoodCost).toBe("30");
  });
});

describe("actual consumption and variance", () => {
  test("absent stock sources stay unavailable, never zero", () => {
    const actual = resolveActualConsumption({ movements: [], stockCounts: [] });
    expect(actual.actualConsumption).toBe(null);
    expect(actual.actualCoverageStatus).toBe(ACTUAL_COVERAGE.UNAVAILABLE);
  });

  test("empty or probe-only movements never become actual zero or complete", () => {
    const dummy = resolveActualConsumption({
      movements: [{ id: "probe", movement_type: "unknown" }],
      stockCounts: [],
      movementPresence: "empty",
      postedCountPresence: "empty",
    });
    expect(dummy.actualConsumption).toBe(null);
    expect(dummy.actualCoverageStatus).toBe(ACTUAL_COVERAGE.UNAVAILABLE);
    expect(dummy.actualCoverageStatus).not.toBe("COMPLETE");

    const presentProbe = resolveActualConsumption({
      movements: [],
      stockCounts: [],
      movementPresence: "present",
      postedCountPresence: "empty",
    });
    expect(presentProbe.actualConsumption).toBe(null);
    expect(presentProbe.actualCoverageStatus).toBe(ACTUAL_COVERAGE.UNAVAILABLE);
    expect(presentProbe.note).toMatch(/exist in the ledger/i);
    expect(presentProbe.note).not.toMatch(/do not exist/i);
  });

  test("sale_consumption alone is not independent actual", () => {
    const actual = resolveActualConsumption({
      movements: [{ movement_type: "sale_consumption", signed_canonical_quantity: "-2" }],
      stockCounts: [],
    });
    expect(actual.actualConsumption).toBe(null);
    expect(actual.actualCoverageStatus).toBe(ACTUAL_COVERAGE.UNAVAILABLE);
  });

  test("variance is not computed when actual is unavailable or theoretical is zero", () => {
    expect(computeVariance({
      theoreticalQuantity: "10",
      actualQuantity: null,
      actualCoverageStatus: ACTUAL_COVERAGE.UNAVAILABLE,
    }).status).toBe(VARIANCE_STATUS.NOT_COMPUTABLE);

    const zeroTheo = computeVariance({
      theoreticalQuantity: "0",
      actualQuantity: "4",
      actualCoverageStatus: ACTUAL_COVERAGE.AVAILABLE,
    });
    expect(zeroTheo.varianceQuantity).toBe("4");
    expect(zeroTheo.variancePercent).toBe(null);
    expect(zeroTheo.status).toBe(VARIANCE_STATUS.ZERO_THEORETICAL_DENOMINATOR);

    const valid = computeVariance({
      theoreticalQuantity: "10",
      actualQuantity: "12",
      theoreticalUom: "gram",
      actualUom: "gram",
      actualCoverageStatus: ACTUAL_COVERAGE.AVAILABLE,
    });
    expect(valid.varianceQuantity).toBe("2");
    expect(valid.variancePercent).toBe("0.2");
  });
});

describe("branch isolation and engine orchestration", () => {
  test("engine reports actual unavailable and does not invent variance", () => {
    const result = runInventoryTruthEngine({
      ingredients,
      recipes: [{ id: "steak", name: "Steak", menu_item_id: "menu-steak", output_quantity: "1", active: true }],
      versions: [{ id: "v-steak", recipe_id: "steak", status: "active" }],
      lines: [{ id: "l1", recipe_version_id: "v-steak", ingredient_id: "salt", quantity: "2", unit: "g" }],
      salesRows: [
        { matched_menu_item_id: "menu-steak", matched_menu_item_name: "Steak", quantity_sold: 3, branch_id: "khobar" },
      ],
      branchId: "khobar",
    });
    expect(result.actual.actualCoverageStatus).toBe(ACTUAL_COVERAGE.UNAVAILABLE);
    expect(result.variance.status).toBe(VARIANCE_STATUS.NOT_COMPUTABLE);
    expect(result.theoretical.rows[0].quantityTheoreticallyConsumed).toBe("6");
    const trace = traceIngredientQuantity("salt", result);
    expect(trace.traces[0].path[0].recipeName).toBe("Steak");
    expect(trace.quantity).toBe("6");
  });
});
