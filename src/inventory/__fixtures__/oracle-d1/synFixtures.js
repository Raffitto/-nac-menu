/**
 * SYNTHETIC fixtures for the Oracle D1 acceptance tests (T1-T28).
 * Every identifier is prefixed SYN-. No production data.
 */

export const SYN_BRANCH = "khobar";

export const SYN_INGREDIENTS = Object.freeze({
  milk: { id: "SYN-ING-MILK", canonical_name: "SYN-Milk", base_inventory_unit: "millilitre", active: true, branch_id: null },
  fruit: { id: "SYN-ING-FRUIT", canonical_name: "SYN-Fruit", base_inventory_unit: "gram", active: true, branch_id: null },
  flour: { id: "SYN-ING-FLOUR", canonical_name: "SYN-Flour", base_inventory_unit: "gram", active: true, branch_id: null },
});

/**
 * Build Food Bible graph rows.
 * recipes: [{ id, name, menuItemId, outputQuantity, outputUnit, recipeType,
 *   versions: [{ id, status, yield, effectiveFrom, effectiveTo, lines: [...] }] }]
 * A recipe given `lines` (no versions) gets one active version.
 * line: { ingredientId | subRecipeId, quantity, unit }
 */
export function synGraph(recipes = [], ingredients = Object.values(SYN_INGREDIENTS)) {
  const out = { recipes: [], versions: [], lines: [], ingredients: [...ingredients] };
  let lineSeq = 0;
  for (const recipe of recipes) {
    out.recipes.push({
      id: recipe.id,
      name: recipe.name || recipe.id,
      recipe_type: recipe.recipeType || (recipe.menuItemId ? "menu_item" : "sub_recipe"),
      menu_item_id: recipe.menuItemId || null,
      branch_id: recipe.branchId ?? null,
      output_quantity: recipe.outputQuantity ?? "1",
      output_unit: recipe.outputUnit ?? (recipe.menuItemId ? "each" : null),
      active: recipe.active ?? true,
    });
    const versions = recipe.versions || [{ id: `${recipe.id}-V1`, status: "active", yield: recipe.yield ?? null, lines: recipe.lines || [] }];
    versions.forEach((version, index) => {
      out.versions.push({
        id: version.id || `${recipe.id}-V${index + 1}`,
        recipe_id: recipe.id,
        version_number: index + 1,
        status: version.status || "active",
        yield_percentage: version.yield ?? null,
        effective_from: version.effectiveFrom ?? null,
        effective_to: version.effectiveTo ?? null,
      });
      for (const line of version.lines || []) {
        lineSeq += 1;
        out.lines.push({
          id: `SYN-LINE-${lineSeq}`,
          recipe_version_id: version.id || `${recipe.id}-V${index + 1}`,
          ingredient_id: line.ingredientId || null,
          sub_recipe_id: line.subRecipeId || null,
          quantity: line.quantity ?? null,
          unit: line.unit ?? null,
          canonical_quantity: null,
          canonical_unit: null,
        });
      }
    });
  }
  return out;
}

/** Canonical commerce item row (commerce_order_items shape). */
export function synItem({
  id,
  orderId = `SYN-O-${id}`,
  date = "2026-10-10",
  menuItemId = null,
  productId = null,
  name = "SYN item",
  quantity = 1,
  status = "completed",
  source = "foodics",
  branchId = SYN_BRANCH,
} = {}) {
  return {
    source,
    source_order_id: orderId,
    source_order_item_id: id,
    branch_id: branchId,
    business_date: date,
    product_id: productId,
    canonical_menu_item_id: menuItemId,
    item_name: name,
    quantity,
    net_amount: null,
    status,
  };
}

/** Canonical commerce order row (commerce_orders shape). */
export function synOrder({ id, date = "2026-10-10", status = "completed", source = "foodics", branchId = SYN_BRANCH } = {}) {
  return { source, source_order_id: id, branch_id: branchId, business_date: date, status };
}

/** Orders for every item, completed unless overridden. */
export function ordersFor(items, overrides = {}) {
  const seen = new Map();
  for (const item of items) {
    if (seen.has(`${item.source}:${item.source_order_id}`)) continue;
    seen.set(`${item.source}:${item.source_order_id}`, synOrder({
      id: item.source_order_id,
      date: item.business_date,
      source: item.source,
      branchId: item.branch_id,
      status: overrides[item.source_order_id] || "completed",
    }));
  }
  return [...seen.values()];
}

/** Rows of n synthetic completed items (for paging tests). */
export function synItemPage(count, offset = 0, extra = {}) {
  return Array.from({ length: count }, (_, i) => synItem({
    id: `SYN-I-${String(offset + i).padStart(6, "0")}`,
    menuItemId: "SYN-M-LATTE",
    name: "SYN Latte",
    ...extra,
  }));
}

/** Minimal Food Bible with one latte recipe using 100 ml SYN-Milk. */
export function latteGraph() {
  return synGraph([
    { id: "SYN-R-LATTE", name: "SYN Latte", menuItemId: "SYN-M-LATTE", lines: [{ ingredientId: SYN_INGREDIENTS.milk.id, quantity: "100", unit: "Ml" }] },
  ]);
}

/** Supabase tables for a full queryIngredientConsumption run. */
export function consumptionTables({ items = [], orders = null, graph = latteGraph(), freshness = null } = {}) {
  return {
    commerce_order_items: items,
    commerce_orders: orders || ordersFor(items),
    commerce_dataset_freshness: freshness
      ? [{ branch_id: SYN_BRANCH, dataset: "order_items", data_through: freshness }]
      : [],
    inventory_ingredients: graph.ingredients,
    inventory_recipes: graph.recipes,
    inventory_recipe_versions: graph.versions,
    inventory_recipe_version_lines: graph.lines,
  };
}

/** now = 2026-10-12 12:00 AST: latest completed business day is 2026-10-11. */
export const SYN_NOW = "2026-10-12T09:00:00Z";

/** Recovered-export fixtures (T18/T19). */
export const SYN_RECOVERED = Object.freeze({
  products: [
    { id: "SYN-PROD-BURGER", sku: "SYN-sk-A", name: "SYN Burger" },
    { id: "SYN-PROD-COFFEE", sku: "SYN-sk-B", name: "SYN Coffee" },
    { id: "SYN-PROD-SALAD", sku: "SYN-sk-C", name: "SYN Salad" },
    { id: "SYN-PROD-P1", sku: "SYN-sk-P1", name: "SYN-P1" },
    { id: "SYN-PROD-P2", sku: "SYN-sk-P2", name: "SYN-P2" },
  ],
  edges: [
    { parentSku: "SYN-sk-A", parentName: "SYN Burger", childSku: "SYN-sk-BUN", childName: "SYN-Bun", qty: 1, unit: "Pcs" },
    { parentSku: "SYN-sk-A", parentName: "SYN Ice Cream", childSku: "SYN-sk-MILK", childName: "SYN-Milk", qty: 500, unit: "Ml" },
    { parentSku: "SYN-sk-C", parentName: "SYN Salad", childSku: "SYN-sk-B", childName: "SYN-Dressing", qty: 30, unit: "Ml" },
    { parentSku: "SYN-sk-P1", parentName: "SYN-P1", childSku: "SYN-sk-MILK", childName: "SYN-Milk", qty: 100, unit: "Ml" },
    { parentSku: "SYN-sk-P2", parentName: "SYN-P2", childSku: "SYN-sk-SOAK", childName: "SYN-Milk soaking mix", qty: null, unit: null },
  ],
});

/** Authenticated network-wide profile (the consumption tool fails closed without one). */
export const SYN_PROFILE = Object.freeze({ authenticated: true, allBranches: true, role: "owner", branchScope: null });
