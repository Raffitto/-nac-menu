import { GRAPH_STATUS } from "./contracts";
import {
  ACTIVATION_DECISION,
  COMMERCE_IDENTITY_CLASS,
  PURCHASE_EVIDENCE_CLASS,
  RECIPE_VERSION_CLASS,
} from "./readinessContracts";
import {
  classifyBlockedRecipe,
  classifyCommerceIdentity,
  classifyPurchaseEvidence,
  proposeActivateRecipeVersion,
  runInventoryReadinessAudit,
} from "./readinessAudit";

const gramIng = (id, name) => ({ id, canonical_name: name, active: true, base_inventory_unit: "gram" });

function draftSteakFixture() {
  return {
    ingredients: [
      gramIng("steak-cut", "Black Angus steak"),
      gramIng("salt", "table salt"),
      gramIng("pepper", "Black pepper"),
      { id: "cream", canonical_name: "Double Cream", active: true, base_inventory_unit: "millilitre" },
      gramIng("shallot", "Shallots"),
      gramIng("peppercorn", "Black Peppercorn"),
    ],
    recipes: [
      {
        id: "steak",
        name: "BLACK ANGUS, BLACK PEPPERCORN",
        recipe_type: "menu_item",
        menu_item_id: "menu-steak",
        active: true,
        output_quantity: "1",
        output_unit: "each",
        branch_id: null,
      },
      {
        id: "sauce",
        name: "PEPPERCORN SAUCE",
        recipe_type: "preparation",
        menu_item_id: null,
        active: true,
        output_quantity: "4000",
        output_unit: "millilitre",
        branch_id: null,
      },
    ],
    versions: [
      { id: "steak-draft", recipe_id: "steak", version_number: 2, status: "draft", created_at: "2026-08-01", updated_at: "2026-08-20" },
      { id: "sauce-active", recipe_id: "sauce", version_number: 3, status: "active", created_at: "2026-07-01", updated_at: "2026-07-14" },
    ],
    lines: [
      { id: "s1", recipe_version_id: "steak-draft", sub_recipe_id: "sauce", quantity: "75", unit: "millilitre" },
      { id: "s2", recipe_version_id: "steak-draft", ingredient_id: "steak-cut", quantity: "150", unit: "gram" },
      { id: "s3", recipe_version_id: "steak-draft", ingredient_id: "salt", quantity: "3", unit: "gram" },
      { id: "sv1", recipe_version_id: "sauce-active", ingredient_id: "cream", quantity: "4000", unit: "millilitre" },
      { id: "sv2", recipe_version_id: "sauce-active", ingredient_id: "shallot", quantity: "330", unit: "gram" },
      { id: "sv3", recipe_version_id: "sauce-active", ingredient_id: "peppercorn", quantity: "20", unit: "gram" },
    ],
    menuItems: [{ id: "menu-steak", name_en: "Black Angus Steak au Poivre", branch_id: "khobar", active: true }],
    salesRows: [{
      matched_menu_item_id: "menu-steak",
      matched_menu_item_name: "Black Angus Steak au Poivre",
      quantity_sold: 52,
      net_sales: 7800,
      branch_id: "khobar",
    }],
  };
}

describe("recipe version candidate classification", () => {
  test("unique current draft with valid structure is SAFE_TO_ACTIVATE", () => {
    const fixture = draftSteakFixture();
    const row = classifyBlockedRecipe({
      recipe: fixture.recipes[0],
      versions: fixture.versions.filter((v) => v.recipe_id === "steak"),
      allRecipes: fixture.recipes,
      allVersions: fixture.versions,
      lines: fixture.lines,
      ingredients: fixture.ingredients,
      menuItems: fixture.menuItems,
      salesRows: fixture.salesRows,
    });
    expect(row.class).toBe(RECIPE_VERSION_CLASS.UNIQUE_CURRENT_DRAFT);
    expect(row.decision).toBe(ACTIVATION_DECISION.SAFE_TO_ACTIVATE);
    expect(row.candidate.versionId).toBe("steak-draft");
    expect(row.soldQuantity).toBe("52");
  });

  test("multiple draft candidates stay REVIEW_REQUIRED", () => {
    const fixture = draftSteakFixture();
    fixture.versions.push({ id: "steak-draft-old", recipe_id: "steak", version_number: 1, status: "draft" });
    fixture.lines.push({
      id: "old",
      recipe_version_id: "steak-draft-old",
      ingredient_id: "steak-cut",
      quantity: "140",
      unit: "gram",
    });
    const row = classifyBlockedRecipe({
      recipe: fixture.recipes[0],
      versions: fixture.versions.filter((v) => v.recipe_id === "steak"),
      allRecipes: fixture.recipes,
      allVersions: fixture.versions,
      lines: fixture.lines,
      ingredients: fixture.ingredients,
      menuItems: fixture.menuItems,
      salesRows: fixture.salesRows,
    });
    expect(row.class).toBe(RECIPE_VERSION_CLASS.MULTIPLE_DRAFT_CANDIDATES);
    expect(row.decision).toBe(ACTIVATION_DECISION.REVIEW_REQUIRED);
  });

  test("retired-only recipes are LEGACY and DO_NOT_ACTIVATE", () => {
    const row = classifyBlockedRecipe({
      recipe: { id: "old", name: "Legacy Toast", recipe_type: "menu_item", menu_item_id: "m1", active: false, output_quantity: "1" },
      versions: [{ id: "r1", recipe_id: "old", version_number: 1, status: "retired" }],
      allRecipes: [],
      allVersions: [],
      lines: [{ id: "l", recipe_version_id: "r1", ingredient_id: "honey", quantity: "10", unit: "gram" }],
      ingredients: [gramIng("honey", "honey")],
      menuItems: [],
      salesRows: [],
    });
    expect(row.class).toBe(RECIPE_VERSION_CLASS.LEGACY_STALE_ONLY);
    expect(row.decision).toBe(ACTIVATION_DECISION.DO_NOT_ACTIVATE);
  });

  test("documentation garbage lines are BROKEN, not safe", () => {
    const row = classifyBlockedRecipe({
      recipe: {
        id: "dressing",
        name: "HOUSE SALAD DRESSING",
        recipe_type: "preparation",
        menu_item_id: null,
        active: true,
        output_quantity: "1",
      },
      versions: [{ id: "d1", recipe_id: "dressing", version_number: 1, status: "draft" }],
      allRecipes: [],
      allVersions: [],
      lines: [
        { id: "g1", recipe_version_id: "d1", ingredient_id: "portions", quantity: "18", unit: "each" },
        { id: "g2", recipe_version_id: "d1", ingredient_id: "total", quantity: "1200", unit: "each" },
      ],
      ingredients: [
        gramIng("portions", "Portions"),
        gramIng("total", "Total"),
      ],
      menuItems: [],
      salesRows: [],
    });
    expect(row.class).toBe(RECIPE_VERSION_CLASS.BROKEN_RECIPE);
    expect(row.decision).toBe(ACTIVATION_DECISION.DO_NOT_ACTIVATE);
  });

  test("missing menu_item_id on a sold kitchen name is MENU_MAPPING_MISSING", () => {
    const row = classifyBlockedRecipe({
      recipe: {
        id: "toast",
        name: "French Toast",
        recipe_type: "menu_item",
        menu_item_id: null,
        active: true,
        output_quantity: "1",
      },
      versions: [{ id: "t1", recipe_id: "toast", version_number: 1, status: "draft" }],
      allRecipes: [],
      allVersions: [],
      lines: [
        { id: "h", recipe_version_id: "t1", ingredient_id: "honey", quantity: "20", unit: "gram" },
      ],
      ingredients: [gramIng("honey", "honey")],
      menuItems: [{ id: "menu-toast", name_en: "French Toast", branch_id: "khobar", active: true }],
      salesRows: [{
        matched_menu_item_id: "menu-toast",
        matched_menu_item_name: "French Toast",
        quantity_sold: 51,
      }],
    });
    expect(row.class).toBe(RECIPE_VERSION_CLASS.MENU_MAPPING_MISSING);
    expect(row.decision).toBe(ACTIVATION_DECISION.REVIEW_REQUIRED);
  });
});

describe("safe activation criteria", () => {
  test("inactive sub-recipe blocks SAFE even when the plate draft is unique", () => {
    const fixture = draftSteakFixture();
    fixture.versions = fixture.versions.map((v) => (
      v.id === "sauce-active" ? { ...v, status: "draft" } : v
    ));
    const row = classifyBlockedRecipe({
      recipe: fixture.recipes[0],
      versions: fixture.versions.filter((v) => v.recipe_id === "steak"),
      allRecipes: fixture.recipes,
      allVersions: fixture.versions,
      lines: fixture.lines,
      ingredients: fixture.ingredients,
      menuItems: fixture.menuItems,
      salesRows: fixture.salesRows,
    });
    expect(row.decision).toBe(ACTIVATION_DECISION.REVIEW_REQUIRED);
    expect(row.structuralIssues.some((issue) => issue.code === GRAPH_STATUS.INACTIVE_VERSION)).toBe(true);
  });

  test("proposed activation write set retires current active versions and is not executed", () => {
    const plan = proposeActivateRecipeVersion({
      recipeId: "steak",
      activateVersionId: "steak-draft",
      versions: [
        { id: "steak-draft", recipe_id: "steak", status: "draft" },
        { id: "old-active", recipe_id: "steak", status: "active" },
      ],
    });
    expect(plan.executed).toBe(false);
    expect(plan.writes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "steak-draft", patch: { status: "active" } }),
      expect.objectContaining({ id: "old-active", patch: { status: "retired" } }),
    ]));
  });
});

describe("commerce identity mapping", () => {
  const menuItems = [
    { id: "menu-cola", name_en: "Coca cola light", branch_id: "khobar", active: true, placement_group_id: "pg-cola" },
    { id: "menu-cola-riyadh", name_en: "Coca cola light", branch_id: "riyadh", active: true, placement_group_id: "pg-cola" },
    { id: "menu-toast", name_en: "French Toast", branch_id: "khobar", active: true },
  ];

  test("product_id already linked on another row is a deterministic product-id match", () => {
    const row = classifyCommerceIdentity({
      driver: { menuItemId: null, displayName: "Coke Light", foodicsProductId: "p-cola", soldQuantity: "10", branchId: "khobar" },
      salesRows: [
        { matched_menu_item_id: "menu-cola", foodics_product_id: "p-cola", matched_menu_item_name: "Coca cola light" },
      ],
      menuItems,
      branchId: "khobar",
    });
    expect(row.class).toBe(COMMERCE_IDENTITY_CLASS.EXACT_EXISTING_PRODUCT_ID_MATCH);
    expect(row.proposedMenuItemId).toBe("menu-cola");
  });

  test("exact unique branch name match is deterministic and not fuzzy", () => {
    const row = classifyCommerceIdentity({
      driver: { menuItemId: null, displayName: "French Toast", foodicsProductId: null, soldQuantity: "51", branchId: "khobar" },
      salesRows: [],
      menuItems,
      branchId: "khobar",
    });
    expect(row.class).toBe(COMMERCE_IDENTITY_CLASS.EXACT_MENU_NAME_UNIQUE_BRANCH_MATCH);
    expect(row.proposedMenuItemId).toBe("menu-toast");
  });

  test("placement copies of one identity stay a cluster match, not auto-written", () => {
    const row = classifyCommerceIdentity({
      driver: { menuItemId: null, displayName: "Coca cola light", foodicsProductId: null, soldQuantity: "3", branchId: "khobar" },
      salesRows: [],
      menuItems,
      branchId: "khobar",
    });
    expect(row.class).toBe(COMMERCE_IDENTITY_CLASS.PLACEMENT_COPY_CLUSTER_MATCH);
    expect(row.proposedMenuItemId).toBe("menu-cola");
  });

  test("no menu match stays unmatched", () => {
    const row = classifyCommerceIdentity({
      driver: { menuItemId: null, displayName: "Love Your Main Course", foodicsProductId: null, soldQuantity: "87", branchId: "khobar" },
      salesRows: [],
      menuItems,
      branchId: "khobar",
    });
    expect(row.class).toBe(COMMERCE_IDENTITY_CLASS.NO_MENU_MATCH);
    expect(row.proposedMenuItemId).toBe(null);
  });
});

describe("purchase evidence classification", () => {
  test("complete receipt evidence is recoverable and not a guessed pack", () => {
    const row = classifyPurchaseEvidence({
      ingredient: gramIng("honey", "honey"),
      costState: null,
      costHistory: [],
      catalogueItems: [],
      invoiceLines: [],
      receiptLines: [{
        ingredient_id: "honey",
        canonical_quantity: "5.5",
        canonical_unit: "kilogram",
        unit_cost_canonical: "237.999",
        line_total: "1309",
        effective_at: "2026-07-01",
        receipt_id: "r1",
      }],
    });
    expect(row.class).toBe(PURCHASE_EVIDENCE_CLASS.PURCHASE_EVIDENCE_COMPLETE);
    expect(row.recoverable).toBe(true);
    expect(row.proposedCost.value).toBe("237.999");
    expect(row.proposedCost.method).toBe("last_purchase");
    expect(row.proposedCost.sourceTable).toBe("inventory_purchase_receipt_lines");
  });

  test("default WAC 0 without purchase evidence is not a cost", () => {
    const row = classifyPurchaseEvidence({
      ingredient: gramIng("maldon", "Maldon Salt"),
      costState: { weighted_average_cost: 0, last_purchase_at: null, last_purchase_price: null },
      costHistory: [],
      catalogueItems: [],
      invoiceLines: [],
      receiptLines: [],
    });
    expect(row.class).toBe(PURCHASE_EVIDENCE_CLASS.NO_PURCHASE_SOURCE);
    expect(row.recoverable).toBe(false);
    expect(row.proposedCost).toBe(null);
  });

  test("invoice price without pack conversion is PRICE_WITHOUT_USABLE_UNIT", () => {
    const row = classifyPurchaseEvidence({
      ingredient: gramIng("oil", "Olive Oil"),
      costState: null,
      costHistory: [],
      catalogueItems: [],
      invoiceLines: [{
        ingredient_id: "oil",
        unit_price: "48",
        original_unit: "case",
        canonical_unit: "millilitre",
        conversion_factor: null,
        pack_size: null,
      }],
      receiptLines: [],
    });
    expect(row.class).toBe(PURCHASE_EVIDENCE_CLASS.PRICE_WITHOUT_USABLE_UNIT);
    expect(row.recoverable).toBe(false);
  });

  test("OCR invoice line never posted stays OCR_ONLY", () => {
    const row = classifyPurchaseEvidence({
      ingredient: gramIng("butter", "Butter"),
      costState: null,
      costHistory: [],
      catalogueItems: [],
      invoiceLines: [{
        ingredient_id: "butter",
        unit_price: "12",
        original_unit: "kilogram",
        canonical_unit: "kilogram",
        canonical_received_quantity: "2",
        conversion_factor: "1",
      }],
      receiptLines: [],
    });
    expect(row.class).toBe(PURCHASE_EVIDENCE_CLASS.OCR_ONLY);
    expect(row.recoverable).toBe(false);
  });
});

describe("readiness audit orchestration", () => {
  test("hypothetical coverage counts only SAFE_TO_ACTIVATE recipes", () => {
    const fixture = draftSteakFixture();
    const result = runInventoryReadinessAudit({
      ...fixture,
      catalogueItems: [],
      costStateByIngredientId: {},
      costHistory: [],
      invoiceLines: [],
      receiptLines: [],
    });
    expect(result.recipes.blocked).toBeGreaterThanOrEqual(1);
    expect(result.recipes.safeToActivate).toBe(1);
    expect(result.sales.coveredToday).toBe(0);
    expect(result.sales.coveredIfSafeActivated).toBe(1);
    expect(result.sales.coveredSoldQuantityIfSafe).toBe("52");
    expect(result.proposedActivationWrites).toHaveLength(1);
    expect(result.proposedActivationWrites[0].executed).toBe(false);
    const steakCut = result.costs.rows.find((row) => row.ingredientId === "steak-cut");
    expect(Number(steakCut.theoreticalQuantity)).toBeGreaterThan(0);
    expect(Number(result.costs.rows[0].theoreticalQuantity)).toBeGreaterThanOrEqual(Number(steakCut.theoreticalQuantity));
  });
});
