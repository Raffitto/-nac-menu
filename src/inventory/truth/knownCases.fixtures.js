/**
 * Deterministic fixture for engine acceptance tests.
 * Not a live Foodics/Food Bible dump. Live answers must come from loaded source rows.
 */
export const KNOWN_CASE_FIXTURE = Object.freeze({
  productionEvidence: false,
  branchId: "khobar",
  periodStart: "2026-08-02",
  periodEnd: "2026-08-08",
  ingredients: [
    { id: "maldon", canonical_name: "Maldon Salt", base_inventory_unit: "gram", active: true },
    { id: "honey", canonical_name: "Honey", base_inventory_unit: "gram", active: true },
    { id: "potato", canonical_name: "Sweet Potato", base_inventory_unit: "kilogram", active: true },
    { id: "oil", canonical_name: "Olive Oil", base_inventory_unit: "millilitre", active: true },
  ],
  recipes: [
    { id: "recipe-steak", name: "Steak", menu_item_id: "menu-steak", recipe_type: "menu_item", output_quantity: "1", output_unit: "each", active: true },
    { id: "recipe-dressing", name: "House Dressing", recipe_type: "sub_recipe", output_quantity: "100", output_unit: "gram", active: true },
    { id: "recipe-salad", name: "House Salad", menu_item_id: "menu-salad", recipe_type: "menu_item", output_quantity: "1", output_unit: "each", active: true },
    { id: "recipe-toast", name: "French Toast", menu_item_id: "menu-toast", recipe_type: "menu_item", output_quantity: "1", output_unit: "each", active: true },
    { id: "recipe-potato", name: "Honey Sweet Potato", menu_item_id: "menu-potato", recipe_type: "menu_item", output_quantity: "1", output_unit: "each", active: true },
  ],
  versions: [
    { id: "v-steak", recipe_id: "recipe-steak", status: "active", yield_percentage: 100 },
    { id: "v-dressing", recipe_id: "recipe-dressing", status: "active", yield_percentage: 100 },
    { id: "v-salad", recipe_id: "recipe-salad", status: "active", yield_percentage: 100 },
    { id: "v-toast", recipe_id: "recipe-toast", status: "active", yield_percentage: 100 },
    { id: "v-potato", recipe_id: "recipe-potato", status: "active", yield_percentage: 100 },
  ],
  lines: [
    { id: "ls1", recipe_version_id: "v-steak", ingredient_id: "maldon", quantity: "2", unit: "g" },
    { id: "ls2", recipe_version_id: "v-steak", ingredient_id: "oil", quantity: "10", unit: "ml" },
    { id: "ld1", recipe_version_id: "v-dressing", ingredient_id: "honey", quantity: "10", unit: "g" },
    { id: "ld2", recipe_version_id: "v-dressing", ingredient_id: "maldon", quantity: "1", unit: "g" },
    { id: "lsa1", recipe_version_id: "v-salad", sub_recipe_id: "recipe-dressing", quantity: "20", unit: "g" },
    { id: "lsa2", recipe_version_id: "v-salad", ingredient_id: "potato", quantity: "80", unit: "g" },
    { id: "lt1", recipe_version_id: "v-toast", ingredient_id: "honey", quantity: "15", unit: "g" },
    { id: "lp1", recipe_version_id: "v-potato", ingredient_id: "potato", quantity: "200", unit: "g" },
    { id: "lp2", recipe_version_id: "v-potato", ingredient_id: "honey", quantity: "8", unit: "g" },
  ],
  salesRows: [
    { matched_menu_item_id: "menu-steak", matched_menu_item_name: "Steak", quantity_sold: 5, net_sales: 450, branch_id: "khobar" },
    { matched_menu_item_id: "menu-salad", matched_menu_item_name: "House Salad", quantity_sold: 3, net_sales: 87, branch_id: "khobar" },
    { matched_menu_item_id: "menu-toast", matched_menu_item_name: "French Toast", quantity_sold: 4, net_sales: 220, branch_id: "khobar" },
    { matched_menu_item_id: "menu-potato", matched_menu_item_name: "Honey Sweet Potato", quantity_sold: 2, net_sales: 84, branch_id: "khobar" },
  ],
  costStateByIngredientId: {
    maldon: { weighted_average_cost: "0.85", last_purchase_price: "0.85", last_purchase_at: "2026-07-15T00:00:00Z" },
    honey: { weighted_average_cost: "0.04", last_purchase_price: "0.04", last_purchase_at: "2026-07-10T00:00:00Z" },
    potato: { weighted_average_cost: "8.5", last_purchase_price: "8.5", last_purchase_at: "2026-07-12T00:00:00Z" },
    oil: { weighted_average_cost: "0.03", last_purchase_price: "0.03", last_purchase_at: "2026-07-08T00:00:00Z" },
  },
});
