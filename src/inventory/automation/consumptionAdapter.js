import { theoreticalConsumption } from "../intelligence/theoreticalConsumption";

const EXCLUDED = new Set(["void", "cancelled", "canceled", "refunded"]);

/** Sold lines only. Voids, cancellations, refunds, and non-positive quantities do not consume ingredients. */
export function salesLinesForConsumption(rows = []) {
  return rows.filter((row) => {
    const status = String(row.status || "completed").toLowerCase();
    if (EXCLUDED.has(status)) return false;
    const quantity = Number(row.quantity);
    return Number.isFinite(quantity) && quantity > 0;
  });
}

/**
 * Adapter over the existing shadow consumption engine.
 * postsStock is always false. Incomplete recipes are a lower bound, never a fabricated total.
 */
export function theoreticalIngredientUse({
  branchId,
  businessDate,
  sales = [],
  inventory = [],
  components = [],
  costs = [],
} = {}) {
  const lines = salesLinesForConsumption(sales);
  const result = theoreticalConsumption({
    branchId,
    businessDate,
    sales: lines,
    inventory,
    components,
    costs,
  });
  const incomplete = result.coverage?.complete === false || result.issues.length > 0;
  const units = new Set(result.usage.map((row) => row.unit));
  const sameUnit = units.size === 1;
  return {
    ...result,
    postsStock: false,
    status: incomplete ? "LOWER_BOUND" : "COMPUTED",
    lowerBound: incomplete,
    excludedSaleCount: sales.length - lines.length,
    quantity: incomplete || !sameUnit
      ? null
      : result.usage.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
  };
}
