import { matchCostHistoryToCanonical, collectPositiveCostRecords } from "./foodBibleCostReconcile";
import { classifyRecipeCosting, COSTING_STATES } from "./recipeGraph";

describe("foodBibleCostReconcile", () => {
  test("matches cost history by canonical id and does not treat missing as zero", () => {
    const result = matchCostHistoryToCanonical({
      ingredients: [
        { id: "a", canonicalName: "Olive Oil" },
        { id: "b", canonicalName: "Sea Bass Fillet" },
      ],
      costRows: [
        { ingredient_id: "a", canonical_unit_cost: 0.04, canonical_unit: "millilitre", effective_at: "2026-08-01" },
        { ingredient_id: "other", canonical_name: "Unknown Spice", canonical_unit_cost: 1, canonical_unit: "gram" },
      ],
    });
    expect(result.matchedCount).toBe(1);
    expect(result.costByCanonicalId.a.amount).toBe(0.04);
    expect(result.missing.map((item) => item.id)).toEqual(["b"]);
  });

  test("maps cost history from a differently id'd purchase ingredient by name", () => {
    const result = matchCostHistoryToCanonical({
      ingredients: [{ id: "canonical-oil", canonicalName: "Olive Oil" }],
      lookupIngredients: [{ id: "purchase-oil", canonicalName: "Olive Oil" }],
      costRows: [
        { ingredient_id: "purchase-oil", canonical_unit_cost: 0.05, canonical_unit: "millilitre", effective_at: "2026-07-01" },
      ],
    });
    expect(result.matchedCount).toBe(1);
    expect(result.costByCanonicalId["canonical-oil"].amount).toBe(0.05);
    expect(result.unmatchedCostCount).toBe(0);
  });

  test("collects only positive history and receipt costs", () => {
    const rows = collectPositiveCostRecords({
      history: [
        { ingredient_id: "a", canonical_unit_cost: 0, canonical_unit: "gram" },
        { ingredient_id: "b", canonical_unit_cost: 1.2, canonical_unit: "gram", effective_at: "2026-07-02" },
      ],
      receiptLines: [
        { ingredient_id: "c", unit_cost_canonical: 3, canonical_unit: "kilogram", normalized_description: "Salt" },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.ingredient_id).sort()).toEqual(["b", "c"]);
  });

  test("unknown cost stays unknown through recipe costing", () => {
    const costing = classifyRecipeCosting({
      lines: [{ ingredientId: "b", quantity: 160, unit: "gram" }],
      costByIngredientId: {},
    });
    expect(costing.state).toBe(COSTING_STATES.UNCOSTED);
    expect(costing.total).toBeNull();
  });
});
