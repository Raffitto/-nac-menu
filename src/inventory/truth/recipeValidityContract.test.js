import { CONVERSION_STATUS, GRAPH_STATUS } from "./contracts";
import { ACTIVATION_DECISION, SOURCE_EVIDENCE_CLASS } from "./readinessContracts";
import { buildRecipeGraph, expandRecipeToIngredients, selectAnalyticalVersion } from "./recipeGraph";
import { computeTheoreticalLedger } from "./consumption";
import { applySourceEvidenceToRecipeRow } from "./sourceEvidence";
import { classifyBlockedRecipe } from "./readinessAudit";
import { mustForkNewDraft, planActivateRecipeVersion, applyActivationPlan, validateRecipeVersionForActivation } from "./recipeActivation";
import { RECIPE_LINE_KIND, classifyRecipeLineKind } from "./recipeLineKind";
import {
  OPERATIONAL_CHANGE_REASONS,
  PRODUCTION_SQL_GATES,
  RECIPE_VALIDITY,
  RECIPE_VALIDITY_CODE,
  classifyIngredientReadiness,
  evaluateCanonicalRecipeValidity,
  evaluateProductionSqlLine,
  formatSourceDiff,
  hasOperationalAcknowledgement,
  versionCoversTimestamp,
} from "./recipeValidityContract";
import fs from "fs";
import path from "path";

const gram = (id, name, extra = {}) => ({
  id,
  canonical_name: name,
  active: true,
  base_inventory_unit: "gram",
  inventory_classification: "other",
  recipe_cost_eligible: false,
  ...extra,
});

describe("SQL/JS production gate snapshot", () => {
  test("live production SQL blocks on recipe_cost_eligible, not classification", () => {
    expect(PRODUCTION_SQL_GATES.usesInventoryClassification).toBe(false);
    expect(PRODUCTION_SQL_GATES.requiresRecipeCostEligible).toBe(true);
    expect(evaluateProductionSqlLine(
      { ingredient_id: "salt", canonical_quantity: 3, canonical_unit: "gram" },
      gram("salt", "table salt"),
    )).toBe(RECIPE_VALIDITY_CODE.UNRESOLVED_RECIPE_LINE);
    expect(evaluateProductionSqlLine(
      { ingredient_id: "mayo", canonical_quantity: 10, canonical_unit: "gram" },
      gram("mayo", "Mayonnaise", { inventory_classification: "food_ingredient", recipe_cost_eligible: true }),
    )).toBe(null);
  });
});

describe("canonical ingredient readiness", () => {
  test("ordinary canonical ingredient does not fail because of legacy other classification", () => {
    const result = classifyIngredientReadiness(gram("pasta", "Rigatonni pasta (De Ceddo)"));
    expect(result.ok).toBe(true);
    expect(evaluateProductionSqlLine(
      { ingredient_id: "pasta", canonical_quantity: 200, canonical_unit: "gram" },
      gram("pasta", "Rigatonni pasta (De Ceddo)"),
    )).toBe(RECIPE_VALIDITY_CODE.UNRESOLVED_RECIPE_LINE);
  });

  test("genuinely unresolved placeholder remains blocked", () => {
    const result = classifyIngredientReadiness({
      id: "ocr",
      canonical_name: "Inventory OCR Verification Cream INV-OCR-VERIFY-1",
      active: true,
      base_inventory_unit: "gram",
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(RECIPE_VALIDITY_CODE.OCR_PLACEHOLDER);
  });

  test("missing identity blocks activation", () => {
    const result = classifyIngredientReadiness({ canonical_name: "mystery", active: true, base_inventory_unit: "gram" });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(RECIPE_VALIDITY_CODE.MISSING_IDENTITY);
  });

  test("missing cost does not invalidate structure", () => {
    const result = evaluateCanonicalRecipeValidity({
      recipe: { id: "r", name: "Plate", output_quantity: "1", output_unit: "each" },
      version: { id: "v", recipe_id: "r", status: "draft", output_quantity: "1", output_unit: "each" },
      versions: [{ id: "v", recipe_id: "r", status: "draft" }],
      lines: [{ id: "l1", recipe_version_id: "v", ingredient_id: "pasta", quantity: "200", unit: "gram" }],
      ingredients: [gram("pasta", "Rigatonni pasta (De Ceddo)")],
      allRecipes: [{ id: "r", name: "Plate", output_quantity: "1", output_unit: "each" }],
    });
    expect(result.valid).toBe(true);
    expect(result.status).toBe(RECIPE_VALIDITY.VALID);
  });
});

describe("documentation and UOM contract", () => {
  test("documentation line never becomes an ingredient", () => {
    expect(classifyRecipeLineKind({ ingredient_id: "t" }, { ingredientName: "Total" }))
      .toBe(RECIPE_LINE_KIND.DOCUMENTATION_LINE);
    const result = evaluateCanonicalRecipeValidity({
      recipe: { id: "toast", output_quantity: "1", output_unit: "each" },
      version: { id: "v", recipe_id: "toast", status: "draft", output_quantity: "1", output_unit: "each" },
      versions: [{ id: "v", recipe_id: "toast", status: "draft" }],
      lines: [
        { id: "bun", recipe_version_id: "v", ingredient_id: "bun", quantity: "80", unit: "gram" },
        { id: "total", recipe_version_id: "v", ingredient_id: "total", quantity: "220", unit: "gram" },
      ],
      ingredients: [gram("bun", "French toast batter bun"), gram("total", "Total")],
      allRecipes: [{ id: "toast", output_quantity: "1", output_unit: "each" }],
    });
    expect(result.valid).toBe(true);
    expect(result.errors.some((item) => item.lineId === "total")).toBe(false);
  });

  test("g ↔ kg is valid and ml ↔ L is valid", () => {
    const mass = evaluateCanonicalRecipeValidity({
      recipe: { id: "r", output_quantity: "1", output_unit: "each" },
      version: { id: "v", recipe_id: "r", status: "draft", output_quantity: "1", output_unit: "each" },
      versions: [{ id: "v", recipe_id: "r", status: "draft" }],
      lines: [{ id: "l", recipe_version_id: "v", ingredient_id: "salt", quantity: "1", unit: "kilogram" }],
      ingredients: [gram("salt", "table salt")],
      allRecipes: [{ id: "r", output_quantity: "1", output_unit: "each" }],
    });
    expect(mass.valid).toBe(true);
    const volume = evaluateCanonicalRecipeValidity({
      recipe: { id: "r", output_quantity: "1", output_unit: "each" },
      version: { id: "v", recipe_id: "r", status: "draft", output_quantity: "1", output_unit: "each" },
      versions: [{ id: "v", recipe_id: "r", status: "draft" }],
      lines: [{ id: "l", recipe_version_id: "v", ingredient_id: "oil", quantity: "1", unit: "litre" }],
      ingredients: [{ id: "oil", canonical_name: "oil", active: true, base_inventory_unit: "millilitre" }],
      allRecipes: [{ id: "r", output_quantity: "1", output_unit: "each" }],
    });
    expect(volume.valid).toBe(true);
  });

  test("g ↔ ml and each ↔ g stay invalid without explicit conversion", () => {
    const massVolume = evaluateCanonicalRecipeValidity({
      recipe: { id: "r", output_quantity: "1", output_unit: "each" },
      version: { id: "v", recipe_id: "r", status: "draft", output_quantity: "1", output_unit: "each" },
      versions: [{ id: "v", recipe_id: "r", status: "draft" }],
      lines: [{ id: "l", recipe_version_id: "v", ingredient_id: "yog", quantity: "50", unit: "gram" }],
      ingredients: [{ id: "yog", canonical_name: "Greek yoghurt", active: true, base_inventory_unit: "millilitre" }],
      allRecipes: [{ id: "r", output_quantity: "1", output_unit: "each" }],
    });
    expect(massVolume.valid).toBe(false);
    expect(massVolume.status).toBe(RECIPE_VALIDITY.BLOCKED_UOM);
    const eachMass = evaluateCanonicalRecipeValidity({
      recipe: { id: "r", output_quantity: "1", output_unit: "each" },
      version: { id: "v", recipe_id: "r", status: "draft", output_quantity: "1", output_unit: "each" },
      versions: [{ id: "v", recipe_id: "r", status: "draft" }],
      lines: [{ id: "l", recipe_version_id: "v", ingredient_id: "egg", quantity: "1", unit: "gram" }],
      ingredients: [{ id: "egg", canonical_name: "Egg", active: true, base_inventory_unit: "each" }],
      allRecipes: [{ id: "r", output_quantity: "1", output_unit: "each" }],
    });
    expect(eachMass.valid).toBe(false);
    expect(eachMass.status).toBe(RECIPE_VALIDITY.BLOCKED_UOM);
  });

  test("sub-recipe uses output/yield UOM, allowing g ↔ kg", () => {
    const result = evaluateCanonicalRecipeValidity({
      recipe: { id: "burger", output_quantity: "1", output_unit: "each" },
      version: { id: "bv", recipe_id: "burger", status: "draft", output_quantity: "1", output_unit: "each" },
      versions: [
        { id: "bv", recipe_id: "burger", status: "draft", output_quantity: "1", output_unit: "each" },
        { id: "mv", recipe_id: "mayo", status: "active", output_quantity: "1.23", output_unit: "kilogram" },
      ],
      lines: [
        { id: "l1", recipe_version_id: "bv", sub_recipe_id: "mayo", quantity: "10", unit: "gram" },
        { id: "l2", recipe_version_id: "mv", ingredient_id: "base", quantity: "1000", unit: "gram" },
      ],
      ingredients: [gram("base", "Mayonnaise", { recipe_cost_eligible: true, inventory_classification: "food_ingredient" })],
      allRecipes: [
        { id: "burger", output_quantity: "1", output_unit: "each" },
        { id: "mayo", name: "TRUFFLE MAYONNAISE", output_quantity: "1.23", output_unit: "kilogram" },
      ],
    });
    expect(result.valid).toBe(true);
    const productionExact = evaluateProductionSqlLine(
      { sub_recipe_id: "mayo", canonical_quantity: 10, canonical_unit: "gram" },
      null,
    );
    expect(productionExact).toBe(null);
    expect(PRODUCTION_SQL_GATES.requiresExactSubrecipeOutputUnit).toBe(true);
  });
});

describe("lifecycle and source policy", () => {
  test("editing active must fork a draft and active versions are immutable", () => {
    expect(mustForkNewDraft("active")).toBe(true);
    expect(mustForkNewDraft("retired")).toBe(true);
    expect(mustForkNewDraft("draft")).toBe(false);
  });

  test("activation retires previous active and leaves exactly one active", () => {
    const versions = [
      { id: "old", recipe_id: "r", status: "active" },
      { id: "next", recipe_id: "r", status: "draft" },
    ];
    const next = applyActivationPlan(versions, planActivateRecipeVersion({
      recipeId: "r",
      activateVersionId: "next",
      versions,
    }));
    expect(next.filter((row) => row.status === "active").map((row) => row.id)).toEqual(["next"]);
    expect(next.find((row) => row.id === "old").status).toBe("retired");
  });

  test("source difference does not automatically block structure", () => {
    const row = applySourceEvidenceToRecipeRow({
      decision: ACTIVATION_DECISION.SAFE_TO_ACTIVATE,
      reason: "structurally valid",
      recipeType: "menu_item",
    }, {
      class: SOURCE_EVIDENCE_CLASS.SOURCE_CONFIRMED_WITH_DIFFERENCES,
      reason: "qty changed",
      sourceDish: { dish: "Steak", pdf: "steak.pdf" },
      differences: [{ sourceName: "Black pepper", sourceQty: "10", draftName: "Black pepper", draftQty: "14" }],
    });
    expect(row.decision).toBe(ACTIVATION_DECISION.SAFE_TO_ACTIVATE);
    expect(row.sourceClass).toBe(SOURCE_EVIDENCE_CLASS.SOURCE_CONFIRMED_WITH_DIFFERENCES);
  });

  test("source difference requires acknowledgement and a reason", () => {
    expect(hasOperationalAcknowledgement({}, { sourceClass: SOURCE_EVIDENCE_CLASS.SOURCE_CONFIRMED_WITH_DIFFERENCES })).toBe(false);
    expect(hasOperationalAcknowledgement({
      operationalChange: { acknowledged: true, reason: "chef_operational_update" },
    }, { sourceClass: SOURCE_EVIDENCE_CLASS.SOURCE_CONFIRMED_WITH_DIFFERENCES })).toBe(true);
    expect(OPERATIONAL_CHANGE_REASONS.map((item) => item.value)).toContain("chef_operational_update");
    const policy = evaluateCanonicalRecipeValidity({
      recipe: { id: "r", output_quantity: "1", output_unit: "each" },
      version: { id: "v", recipe_id: "r", status: "draft", output_quantity: "1", output_unit: "each" },
      versions: [{ id: "v", recipe_id: "r", status: "draft" }],
      lines: [{ id: "l", recipe_version_id: "v", ingredient_id: "salt", quantity: "3", unit: "gram" }],
      ingredients: [gram("salt", "table salt")],
      allRecipes: [{ id: "r", output_quantity: "1", output_unit: "each" }],
      sourceClass: SOURCE_EVIDENCE_CLASS.SOURCE_CONFIRMED_WITH_DIFFERENCES,
      requireActivationPolicy: true,
      activationReason: "",
    });
    expect(policy.valid).toBe(false);
    expect(policy.errors.some((item) => item.code === RECIPE_VALIDITY_CODE.SOURCE_ACKNOWLEDGEMENT_REQUIRED)).toBe(true);
    expect(formatSourceDiff([{ draftName: "Rosemary", sourceName: null }])[0].label).toBe("+ Rosemary");
  });
});

describe("effective-dated recipe resolution", () => {
  const recipes = [{ id: "plate", name: "Plate", menu_item_id: "menu", output_quantity: "1", active: true }];
  const ingredients = [gram("salt", "table salt")];
  const versions = [
    { id: "va", recipe_id: "plate", status: "retired", version_number: 1, effective_from: "2026-08-01T00:00:00.000Z", effective_to: "2026-09-09T00:00:00.000Z" },
    { id: "vb", recipe_id: "plate", status: "active", version_number: 2, effective_from: "2026-09-09T00:00:00.000Z", effective_to: null },
  ];
  const lines = [
    { id: "la", recipe_version_id: "va", ingredient_id: "salt", quantity: "3", unit: "gram" },
    { id: "lb", recipe_version_id: "vb", ingredient_id: "salt", quantity: "10", unit: "gram" },
  ];

  test("Aug 30 sale uses recipe A and Sep 9 sale uses recipe B", () => {
    expect(versionCoversTimestamp(versions[0], "2026-08-30")).toBe(true);
    expect(versionCoversTimestamp(versions[1], "2026-08-30")).toBe(false);
    expect(versionCoversTimestamp(versions[1], "2026-09-09")).toBe(true);
    const august = selectAnalyticalVersion(versions, { asOf: "2026-08-30" });
    const september = selectAnalyticalVersion(versions, { asOf: "2026-09-09" });
    expect(august.version.id).toBe("va");
    expect(september.version.id).toBe("vb");

    const graphA = buildRecipeGraph({ recipes, versions, lines, ingredients, asOf: "2026-08-30" });
    const graphB = buildRecipeGraph({ recipes, versions, lines, ingredients, asOf: "2026-09-09" });
    expect(expandRecipeToIngredients({ recipeId: "plate", outputNeeded: "1", graph: graphA }).ingredients.get("salt").quantityBase).toBe("3");
    expect(expandRecipeToIngredients({ recipeId: "plate", outputNeeded: "1", graph: graphB }).ingredients.get("salt").quantityBase).toBe("10");

    const beforeCoverage = selectAnalyticalVersion(versions, { asOf: "2026-07-15" });
    expect(beforeCoverage.version).toBeNull();
    expect(beforeCoverage.status).toBe(GRAPH_STATUS.INACTIVE_VERSION);

    const ledger = computeTheoreticalLedger({
      salesRows: [
        { matched_menu_item_id: "menu", quantity_sold: 1, business_date: "2026-08-30" },
        { matched_menu_item_id: "menu", quantity_sold: 1, business_date: "2026-09-09" },
      ],
      graph: graphB,
      graphAt: (asOf) => buildRecipeGraph({ recipes, versions, lines, ingredients, asOf }),
    });
    expect(ledger.rows[0].quantityTheoreticallyConsumed).toBe("13");
  });
});

describe("authored SQL matches canonical contract", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "../../../supabase/migrations/20260909193000_recipe_validity_contract.sql"),
    "utf8",
  );

  test("replaces the production validator without flipping ingredient classification", () => {
    expect(sql).toMatch(/create or replace function public\.inventory_validate_recipe_version_activation/);
    expect(sql).not.toMatch(/i\.recipe_cost_eligible is not true/);
    expect(sql).toMatch(/inventory_recipe_units_compatible/);
    expect(sql).toMatch(/UNRESOLVED_RECIPE_LINE/);
    expect(sql).toMatch(/INVALID_SUBRECIPE_VERSION_OR_UNIT/);
    expect(sql).not.toMatch(/update public\.inventory_ingredients set inventory_classification/);
  });
});
