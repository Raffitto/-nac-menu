import { explodeRecipe } from "./recipeExplosion";

/**
 * Wastage stays a recorded event. Exploding it for intelligence
 * must not also deduct the same ingredients from stock.
 */
export function classifyWastageEvent({ kind, sku, name, quantity, unit, inventory = [], components = [] }) {
  const allowed = ["finished_product", "ingredient", "preparation", "operational_loss"];
  if (!allowed.includes(kind)) {
    return { ok: false, reason: "Unknown wastage kind.", postsStock: false };
  }
  const shadow = kind === "finished_product"
    ? explodeRecipe({ lines: [{ sku, name, quantity, unit }], inventory, components, rootKey: `wastage:${sku}` })
    : null;
  return {
    ok: true,
    kind,
    postsStock: false,
    shadow,
    doubleCountRisk: Boolean(shadow && shadow.totals.length),
    note: shadow
      ? "Finished-product wastage is recorded once. Nested ingredients are shadow usage, not a second stock deduction."
      : "Record this quantity once against the selected item.",
  };
}
