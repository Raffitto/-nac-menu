import {
  MATCH_STATUS,
  collectProcurementIdentities,
  costFoodBibleRecipe,
  isExcludedProcurementName,
  matchProcurementIdentity,
  namesAreDistinctProducts,
  normalizePurchaseToCanonicalUnitCost,
  reconcileProcurementToCanonical,
  resolveEffectiveCost,
} from "./foodBibleProcurementCost";
import { COSTING_STATES } from "./recipeGraph";

describe("foodBibleProcurementCost", () => {
  const minced = { id: "c-beef", canonicalName: "Minced Beef", description: "Food Bible aliases: minced beef" };
  const tomato = { id: "c-tom", canonicalName: "Tomato", description: "Food Bible aliases: tomatoes | fresh tomato" };
  const paste = { id: "c-paste", canonicalName: "Tomato Paste" };
  const doubleCream = { id: "c-cream", canonicalName: "Double Cream" };
  const prawns = { id: "c-prawn", canonicalName: "Prawns Tiger 16 29" };

  test("obvious alias maps and is idempotent", () => {
    const first = matchProcurementIdentity({
      identity: { ingredientId: "p-tom", name: "Tomatoes" },
      canonicalIngredients: [tomato, paste],
    });
    expect(first.status).toBe(MATCH_STATUS.DETERMINISTIC);
    expect(first.canonicalId).toBe("c-tom");
    const again = matchProcurementIdentity({
      identity: { ingredientId: "p-tom", name: "Tomatoes" },
      canonicalIngredients: [tomato, paste],
      existingRelated: [{
        ingredient_id: "c-tom",
        related_ingredient_id: "p-tom",
        relationship_type: "same_operational_ingredient",
        active: true,
      }],
    });
    expect(again.status).toBe(MATCH_STATUS.ALREADY_MAPPED);
    expect(again.canonicalId).toBe("c-tom");
  });

  test("does not merge tomato paste with tomato or cream with double cream", () => {
    expect(namesAreDistinctProducts("Tomato paste", "Tomatoes")).toBe(true);
    expect(matchProcurementIdentity({
      identity: { name: "Tomato paste" },
      canonicalIngredients: [tomato, paste],
    }).canonicalId).toBe("c-paste");
    expect(namesAreDistinctProducts("Double cream", "Cream")).toBe(true);
    expect(isExcludedProcurementName("Inventory OCR Verification Cream")).toBe(true);
    expect(matchProcurementIdentity({
      identity: { name: "VERIFICATION CREAM 12X1L" },
      canonicalIngredients: [doubleCream],
    }).status).toBe(MATCH_STATUS.EXCLUDED);
  });

  test("ambiguous supplier item remains unresolved for human review", () => {
    const result = matchProcurementIdentity({
      identity: { name: "Prawns", originalDescription: "Prawns mixed size" },
      canonicalIngredients: [prawns, { id: "c-prawn-2", canonicalName: "Prawns Tiger 8 12" }],
    });
    expect([MATCH_STATUS.AMBIGUOUS, MATCH_STATUS.UNRESOLVED]).toContain(result.status);
    expect(result.canonicalId).toBeUndefined();
  });

  test("kg to g and litre to ml unit costs convert; unknown pack blocks", () => {
    const kg = normalizePurchaseToCanonicalUnitCost({
      unitCostCanonical: 40,
      canonicalUnit: "kilogram",
      targetUnit: "gram",
    });
    expect(kg.ok).toBe(true);
    expect(kg.amount).toBeCloseTo(0.04, 8);
    const litre = normalizePurchaseToCanonicalUnitCost({
      unitCostCanonical: 26.5,
      canonicalUnit: "litre",
      targetUnit: "millilitre",
    });
    expect(litre.ok).toBe(true);
    expect(litre.amount).toBeCloseTo(0.0265, 8);
    const pack = normalizePurchaseToCanonicalUnitCost({
      unitPrice: 48,
      purchaseQuantity: 1,
      purchaseUnit: "case",
      targetUnit: "each",
    });
    expect(pack.ok).toBe(false);
    expect(pack.code).toBe("UNKNOWN_PACK_SIZE");
    const knownPack = normalizePurchaseToCanonicalUnitCost({
      unitPrice: 48,
      purchaseQuantity: 1,
      purchaseUnit: "each",
      packQuantity: 1,
      packSize: 12,
      packUnit: "each",
      targetUnit: "each",
    });
    expect(knownPack.ok).toBe(true);
    expect(knownPack.amount).toBeCloseTo(4, 8);
  });

  test("historical WAC resolves by date", () => {
    const historyRows = [
      { ingredient_id: "p-oil", weighted_average_cost: 0.04, canonical_unit_cost: 0.05, canonical_unit: "millilitre", effective_at: "2026-07-01T00:00:00+03:00" },
      { ingredient_id: "p-oil", weighted_average_cost: 0.03, canonical_unit_cost: 0.03, canonical_unit: "millilitre", effective_at: "2026-08-01T00:00:00+03:00" },
    ];
    const july = resolveEffectiveCost({ ingredientId: "c-oil", asOf: "2026-07-15T12:00:00+03:00", historyRows, mappedIngredientIds: ["p-oil"] });
    const aug = resolveEffectiveCost({ ingredientId: "c-oil", asOf: "2026-08-15T12:00:00+03:00", historyRows, mappedIngredientIds: ["p-oil"] });
    expect(july.amount).toBe(0.04);
    expect(aug.amount).toBe(0.03);
  });

  test("recipe costing rolls sub-recipes, stays partial, and never treats missing as zero", () => {
    const result = costFoodBibleRecipe({
      recipeId: "burger",
      recipesById: {
        burger: { id: "burger", outputQuantity: 1, outputUnit: "each" },
        sauce: { id: "sauce", outputQuantity: 100, outputUnit: "gram" },
      },
      linesByRecipeId: {
        burger: [
          { ingredientId: "beef", quantity: 160, unit: "gram" },
          { subRecipeId: "sauce", quantity: 70, unit: "gram" },
        ],
        sauce: [
          { ingredientId: "mayo", quantity: 80, unit: "gram" },
          { ingredientId: "mustard", quantity: 20, unit: "gram" },
        ],
      },
      costByIngredientId: {
        beef: { amount: 0.05, unit: "gram" },
        mayo: { amount: 0.02, unit: "gram" },
      },
      sellingPrice: 48,
    });
    expect(result.state).toBe(COSTING_STATES.PARTIALLY_COSTED);
    expect(result.total).toBeNull();
    expect(result.foodCostPct).toBeNull();
    expect(result.knownSubtotal).toBeGreaterThan(0);
    expect(result.missing.some((row) => row.ingredientId === "mustard")).toBe(true);

    const full = costFoodBibleRecipe({
      recipeId: "burger",
      recipesById: { burger: { id: "burger", outputQuantity: 1, outputUnit: "each" } },
      linesByRecipeId: { burger: [{ ingredientId: "beef", quantity: 160, unit: "gram" }] },
      costByIngredientId: { beef: { amount: 0.05, unit: "gram" } },
      sellingPrice: 40,
    });
    expect(full.state).toBe(COSTING_STATES.FULLY_COSTED);
    expect(full.total).toBeCloseTo(8, 5);
    expect(full.foodCostPct).toBeCloseTo(20, 5);
  });

  test("collects identities without inventing rows", () => {
    const identities = collectProcurementIdentities({
      history: [{ ingredient_id: "p1" }],
      receipts: [{ ingredient_id: "p1", original_description: "Minced beef" }],
      catalogue: [{ ingredient_id: "p1", original_product_name: "MINCED BEEF" }],
      ingredients: [{ id: "p1", canonical_name: "Minced Beef Purchase" }],
    });
    expect(identities).toHaveLength(1);
    const plan = reconcileProcurementToCanonical({
      identities,
      canonicalIngredients: [minced],
    });
    expect(plan.newlyMapped).toHaveLength(1);
    expect(plan.newlyMapped[0].canonicalId).toBe("c-beef");
  });
});
