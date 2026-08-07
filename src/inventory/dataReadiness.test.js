import {
  classifyCatalogueCandidate,
  COVERAGE_STATUS,
  filterCoverageProducts,
  mergeTheoreticalConsumption,
  prioritizeRecipeWork,
} from "./dataReadiness";

describe("inventory data readiness", () => {
  test("filters recipe coverage by state and product text", () => {
    const products = [
      { name: "Cappuccino", section: "Coffee", coverageStatus: "MISSING_RECIPE" },
      { name: "Water", section: "Soft Drinks", coverageStatus: "DIRECT_STOCK" },
    ];
    expect(filterCoverageProducts(products, {
      status: COVERAGE_STATUS.MISSING_RECIPE,
      search: "coffee",
    })).toEqual([products[0]]);
  });

  test("prioritizes missing recipe work by sales value then units", () => {
    const result = prioritizeRecipeWork([
      { name: "Trusted", coverageStatus: "TRUSTED", soldUnits: 20, salesValue: 200 },
      { name: "Low", coverageStatus: "MISSING_RECIPE", soldUnits: 10, salesValue: 100 },
      { name: "High", coverageStatus: "MISSING_COST", soldUnits: 30, salesValue: 500 },
      { name: "Excluded", coverageStatus: "EXCLUDED", soldUnits: 40, salesValue: 300 },
    ], { limit: 1 });
    expect(result.products.map(({ name }) => name)).toEqual(["High"]);
    expect(result.currentUnitCoveragePct).toBe(20);
    expect(result.projectedUnitCoveragePct).toBe(50);
  });

  test("does not fabricate sales coverage without sales units", () => {
    const result = prioritizeRecipeWork([
      { name: "Missing", coverageStatus: "MISSING_RECIPE", soldUnits: 0, salesValue: 0 },
    ]);
    expect(result.currentUnitCoveragePct).toBeNull();
    expect(result.projectedUnitCoveragePct).toBeNull();
  });

  test("ranks one recipe task for repeated menu placements", () => {
    const result = prioritizeRecipeWork([
      {
        menuItemId: "a",
        placementGroupId: "group-1",
        name: "Halloumi",
        coverageStatus: "MISSING_RECIPE",
        soldUnits: 5,
        salesValue: 50,
      },
      {
        menuItemId: "b",
        placementGroupId: "group-1",
        name: "Halloumi",
        coverageStatus: "MISSING_RECIPE",
        soldUnits: 3,
        salesValue: 30,
      },
    ]);
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ soldUnits: 8, salesValue: 80 });
  });

  test("prevents canonical creation for duplicate candidates", () => {
    expect(classifyCatalogueCandidate({
      candidate_status: "DUPLICATE_CANDIDATE",
      duplicate_ingredient_name: "Milk",
    })).toEqual({
      status: "duplicate_candidate",
      canCreate: false,
      reason: "Milk",
    });
  });

  test("merges complete theoretical consumption without converting gaps to zero", () => {
    const variance = {
      theoreticalConsumptionAvailable: false,
      items: [
        { inventoryItemId: "chicken", actual: { orderConsumption: 12 } },
        { inventoryItemId: "milk", actual: {} },
      ],
    };
    const merged = mergeTheoreticalConsumption(variance, {
      status: "COMPLETE",
      complete: true,
      coverage: { unitCoveragePct: 100 },
      gaps: [],
      items: [{
        inventoryItemId: "chicken",
        theoreticalQuantity: 10,
        evidence: [{ recipeVersionId: "v1" }],
      }],
    });
    expect(merged.theoreticalConsumptionAvailable).toBe(true);
    expect(merged.items[0]).toMatchObject({
      theoreticalRecipeConsumption: 10,
      consumptionVarianceQuantity: 2,
      theoreticalConsumptionComplete: true,
    });
    expect(merged.items[1].theoreticalRecipeConsumption).toBeUndefined();
  });

  test("keeps theoretical analysis gated when no source is approved", () => {
    const variance = {
      theoreticalConsumptionAvailable: false,
      theoreticalConsumptionReason: "RECIPE_COVERAGE_GAP",
      items: [{ inventoryItemId: "milk" }],
    };
    expect(mergeTheoreticalConsumption(variance, {
      status: "NO_APPROVED_SALES_SOURCE",
      items: [],
    })).toBe(variance);
  });
});
