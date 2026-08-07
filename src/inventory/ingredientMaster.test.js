import {
  canManageBranchIngredients,
  canManageNetworkIngredients,
  collectCategoryOptions,
  duplicateNameMessage,
  filterIngredients,
  friendlyIngredientError,
  mapIngredientRow,
  trimIngredientName,
  validateIngredientForm,
} from "./ingredientMaster";

describe("ingredientMaster helpers", () => {
  const sampleRow = {
    id: "ing-1",
    canonical_name: "Heavy cream",
    normalized_search_name: "heavy cream",
    category: "Dairy",
    base_inventory_unit: "litre",
    inventory_classification: "food_ingredient",
    recipe_cost_eligible: true,
    description: "35% cream",
    scope: "branch",
    branch_id: "khobar",
    active: true,
    updated_at: "2026-07-15T10:00:00.000Z",
    created_at: "2026-07-01T10:00:00.000Z",
  };

  test("mapIngredientRow maps database fields to UI shape", () => {
    expect(mapIngredientRow(sampleRow)).toEqual({
      id: "ing-1",
      canonicalName: "Heavy cream",
      normalizedSearchName: "heavy cream",
      category: "Dairy",
      baseInventoryUnit: "litre",
      inventoryClassification: "food_ingredient",
      recipeCostEligible: true,
      legitimateZeroCost: false,
      description: "35% cream",
      scope: "branch",
      branchId: "khobar",
      active: true,
      updatedAt: "2026-07-15T10:00:00.000Z",
      createdAt: "2026-07-01T10:00:00.000Z",
    });
  });

  test("maps unclassified legacy items to safe non-recipe defaults", () => {
    expect(mapIngredientRow({
      ...sampleRow,
      inventory_classification: null,
      recipe_cost_eligible: null,
    })).toMatchObject({
      inventoryClassification: "other",
      recipeCostEligible: false,
    });
  });

  test("trimIngredientName normalizes whitespace", () => {
    expect(trimIngredientName("  whipping   cream  ")).toBe("whipping cream");
  });

  test("validateIngredientForm rejects empty and invalid values", () => {
    expect(validateIngredientForm({ canonicalName: "", category: "Dairy", baseInventoryUnit: "each" }).ok).toBe(false);
    expect(validateIngredientForm({ canonicalName: "Cream", category: "", baseInventoryUnit: "each" }).ok).toBe(false);
    expect(validateIngredientForm({ canonicalName: "Cream", category: "Dairy", baseInventoryUnit: "invalid" }).ok).toBe(false);
    expect(validateIngredientForm({
      canonicalName: "Cream",
      category: "Dairy",
      baseInventoryUnit: "litre",
      originalBaseUnit: "gram",
    }, { allowUnitChange: false }).ok).toBe(false);
  });

  test("validateIngredientForm accepts a valid form", () => {
    const result = validateIngredientForm({
      canonicalName: "  Heavy cream ",
      category: "Dairy",
      baseInventoryUnit: "litre",
    });
    expect(result).toEqual({ ok: true, canonicalName: "Heavy cream" });
  });

  test("filterIngredients supports search, category, and status filters", () => {
    const ingredients = [
      mapIngredientRow({ ...sampleRow, id: "1", canonical_name: "Heavy cream", category: "Dairy", active: true }),
      mapIngredientRow({ ...sampleRow, id: "2", canonical_name: "Tomato", category: "Produce", active: false }),
    ];
    expect(filterIngredients(ingredients, { search: "tomato", status: "all" })).toHaveLength(1);
    expect(filterIngredients(ingredients, { category: "Dairy", status: "active" })).toHaveLength(1);
    expect(filterIngredients(ingredients, { status: "inactive" })).toHaveLength(1);
  });

  test("collectCategoryOptions merges suggested and existing categories", () => {
    const options = collectCategoryOptions([
      mapIngredientRow({ ...sampleRow, category: "Custom" }),
    ]);
    expect(options).toEqual(expect.arrayContaining(["Dairy", "Custom"]));
  });

  test("duplicateNameMessage includes existing ingredient name when provided", () => {
    expect(duplicateNameMessage("Heavy cream")).toContain("Heavy cream");
  });

  test("friendlyIngredientError maps permission and duplicate errors", () => {
    expect(friendlyIngredientError(new Error("duplicate key value"))).toMatch(/already exists/i);
    expect(friendlyIngredientError(new Error("permission denied for table"))).toMatch(/permission/i);
  });

  test("canManageBranchIngredients respects role and branch access", () => {
    expect(canManageBranchIngredients({ vaultRole: "branch_manager", primaryBranchId: "khobar" }, "khobar")).toBe(true);
    expect(canManageBranchIngredients({ vaultRole: "branch_manager", primaryBranchId: "riyadh" }, "khobar")).toBe(false);
    expect(canManageBranchIngredients({ vaultRole: "ops_manager", branchIds: ["jeddah"] }, "jeddah")).toBe(true);
    expect(canManageBranchIngredients({ vaultRole: "viewer" }, "khobar")).toBe(false);
  });

  test("canManageNetworkIngredients allows network roles only", () => {
    expect(canManageNetworkIngredients({ vaultRole: "ops_manager" })).toBe(true);
    expect(canManageNetworkIngredients({ vaultRole: "branch_manager" })).toBe(false);
  });
});
