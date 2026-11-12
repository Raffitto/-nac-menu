import { convertToCanonicalQuantity } from "../inventory/inventoryIntelligence";

/**
 * Theoretical plate cost from approved recipe lines.
 * Missing cost, quantity, or an unverified conversion leaves the result incomplete.
 * Nothing is deducted and no zero is substituted for a missing cost.
 */
export function theoreticalPlateCost({ lines = [], ingredients = [], costByIngredientId = {} } = {}) {
  const gaps = [];
  let total = 0;
  const ingredientById = new Map((ingredients || []).map((row) => [row.id, row]));

  for (const line of lines || []) {
    const ingredient = ingredientById.get(line.ingredient_id);
    if (!ingredient) {
      gaps.push({ lineId: line.id, reason: "missing_ingredient" });
      continue;
    }
    const costRecord = costByIngredientId[ingredient.id];
    const unitCost = costRecord?.weighted_average_cost ?? costRecord?.last_purchase_price ?? null;
    if (unitCost == null) {
      gaps.push({ lineId: line.id, ingredientId: ingredient.id, reason: "missing_cost" });
      continue;
    }
    const quantity = line.quantity;
    if (quantity == null || Number(quantity) <= 0) {
      gaps.push({ lineId: line.id, reason: "missing_quantity" });
      continue;
    }
    try {
      const converted = convertToCanonicalQuantity({
        quantity: String(quantity),
        originalUnit: line.unit || ingredient.base_inventory_unit,
        packUnit: line.unit || ingredient.base_inventory_unit,
        canonicalUnit: ingredient.base_inventory_unit,
        verifiedConversionFactor: line.verified_conversion_factor,
      });
      total += Number(converted.canonicalQuantity) * Number(unitCost);
    } catch {
      gaps.push({ lineId: line.id, reason: "invalid_conversion" });
    }
  }

  if (gaps.length || !(lines || []).length) {
    return {
      status: "incomplete",
      label: "theoretical",
      amount: null,
      gaps,
    };
  }
  return {
    status: "complete",
    label: "theoretical",
    amount: Math.round(total * 100) / 100,
    gaps: [],
  };
}
