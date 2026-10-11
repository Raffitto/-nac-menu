import { addDecimal, multiplyDecimal } from "../inventoryIntelligence";
import { explodeRecipe } from "./recipeExplosion";

/**
 * Shadow theoretical consumption.
 * Sales times a verified recipe. This never creates a stock movement.
 */
export function theoreticalConsumption({
  branchId,
  businessDate,
  sales = [],
  inventory = [],
  components = [],
  costs = [],
} = {}) {
  const explosion = explodeRecipe({
    lines: sales.map((line) => ({
      sku: line.sku,
      name: line.name,
      quantity: line.quantity,
      unit: line.unit,
      inventoryId: line.inventoryId || null,
    })),
    inventory,
    components,
    rootKey: `sale:${branchId || "unknown"}:${businessDate || "unknown"}`,
  });
  const usage = explosion.totals.map((row) => {
    const cost = costs.find((item) => item.sku === row.sku);
    return {
      sku: row.sku,
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      cost: cost && cost.unitCost != null ? multiplyDecimal(row.quantity, cost.unitCost) : null,
      costBasis: cost && cost.unitCost != null ? "verified_purchase_cost" : "unavailable",
    };
  });
  const requested = sales.length;
  const unresolved = explosion.issues.length;
  return {
    shadow: true,
    postsStock: false,
    branchId: branchId || null,
    businessDate: businessDate || null,
    usage,
    issues: explosion.issues,
    coverage: requested === 0 ? null : {
      requested,
      unresolved,
      complete: explosion.complete,
    },
    limitations: explosion.complete ? [] : ["Recipe coverage is incomplete. This is not a complete consumption figure."],
    totalKnownCost: usage.reduce((sum, row) => (row.cost == null ? sum : (sum == null ? row.cost : addDecimal(sum, row.cost))), null),
  };
}

export function explainTheoreticalConsumption(result) {
  if (!result) return "No calculation was run.";
  const lines = result.usage.map((row) => `${row.name}: ${row.quantity} ${row.unit}`);
  const gap = result.limitations[0] || "Coverage is complete for the supplied sales lines.";
  return [
    `Branch ${result.branchId || "unspecified"}, ${result.businessDate || "unspecified date"}.`,
    "Theoretical consumption only. No stock was posted.",
    lines.join("; ") || "No resolved usage.",
    gap,
  ].join(" ");
}
