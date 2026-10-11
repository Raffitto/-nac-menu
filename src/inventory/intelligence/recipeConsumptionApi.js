import { consumptionWindow, parseConsumptionQuestion } from "./consumptionEvidence";

const PAGE = 1000;

function branchAllowed(profile, branchId) {
  if (profile?.branchScope && profile.branchScope !== branchId && !profile?.allBranches) {
    return false;
  }
  return true;
}

/**
 * Read-only. Uses the menu-item id already stored on a recipe.
 * A matching name is not treated as identity.
 */
export async function queryIngredientConsumption(supabase, {
  question,
  profile = null,
  today,
} = {}) {
  const parsed = parseConsumptionQuestion(question);
  if (!parsed) return null;
  const window = consumptionWindow(parsed.period, today);
  if (!parsed.branch || !window) {
    return {
      status: "UNAVAILABLE",
      postsStock: false,
      quantity: null,
      reason: "Name the branch and whether you mean yesterday, today, or last week.",
    };
  }
  if (!branchAllowed(profile, parsed.branch)) {
    return { status: "UNAVAILABLE", postsStock: false, quantity: null, reason: "This account cannot read that branch.", postsStockNote: true };
  }
  const { data: ingredients, error: ingredientError } = await supabase
    .from("inventory_ingredients")
    .select("id, canonical_name")
    .eq("active", true)
    .ilike("canonical_name", `%${parsed.ingredient}%`)
    .limit(8);
  if (ingredientError) throw ingredientError;
  const { summarizeIngredientConsumption } = await import("./consumptionEvidence");
  if (!ingredients?.length) {
    return {
      status: "UNAVAILABLE",
      postsStock: false,
      quantity: null,
      branchId: parsed.branch,
      periodLabel: window.label,
      reason: `No active ingredient is named like “${parsed.ingredient}”.`,
    };
  }
  if (ingredients.length > 1) {
    return summarizeIngredientConsumption({
      ingredients: ingredients.map((item) => ({ name: item.canonical_name })),
      branchId: parsed.branch,
      window,
    });
  }
  const ingredient = { id: ingredients[0].id, name: ingredients[0].canonical_name };
  const { data: lines, error: lineError } = await supabase
    .from("inventory_recipe_version_lines")
    .select("canonical_quantity, canonical_unit, recipe_version_id")
    .eq("ingredient_id", ingredient.id)
    .limit(200);
  if (lineError) throw lineError;
  const versionIds = [...new Set((lines || []).map((line) => line.recipe_version_id))];
  const { data: versions, error: versionError } = versionIds.length
    ? await supabase
      .from("inventory_recipe_versions")
      .select("id, status, effective_from, effective_to, recipe_id")
      .in("id", versionIds)
      .limit(200)
    : { data: [], error: null };
  if (versionError) throw versionError;
  const recipeIds = [...new Set((versions || []).map((version) => version.recipe_id))];
  const { data: recipes, error: recipeError } = recipeIds.length
    ? await supabase
      .from("inventory_recipes")
      .select("id, menu_item_id, output_quantity, active")
      .in("id", recipeIds)
      .limit(200)
    : { data: [], error: null };
  if (recipeError) throw recipeError;
  const recipeById = Object.fromEntries((recipes || []).map((recipe) => [recipe.id, recipe]));
  const versionById = Object.fromEntries((versions || []).map((version) => [version.id, version]));
  const recipeLinks = (lines || []).flatMap((line) => {
    const version = versionById[line.recipe_version_id];
    const recipe = version ? recipeById[version.recipe_id] : null;
    if (!version || version.status !== "active" || !recipe?.active || !recipe.menu_item_id) return [];
    const from = String(version.effective_from || "").slice(0, 10);
    const to = version.effective_to ? String(version.effective_to).slice(0, 10) : null;
    if (from > window.end || (to && to <= window.start)) return [];
    return [{
      menuItemId: recipe.menu_item_id,
      outputQuantity: recipe.output_quantity,
      canonicalQuantity: line.canonical_quantity,
      canonicalUnit: line.canonical_unit,
    }];
  });
  const { data: sales, error: salesError } = await supabase
    .from("foodics_sales_items")
    .select("raw_item_name, matched_menu_item_id, quantity_sold, is_modifier, semantic_class, period_start, period_end")
    .eq("branch_id", parsed.branch)
    .gte("period_start", window.start)
    .lte("period_end", window.end)
    .limit(PAGE);
  if (salesError) throw salesError;
  let latestSalesDate = null;
  if (!sales?.length) {
    const { data: latest } = await supabase
      .from("foodics_sales_items")
      .select("period_end")
      .eq("branch_id", parsed.branch)
      .order("period_end", { ascending: false })
      .limit(1);
    latestSalesDate = latest?.[0]?.period_end || null;
  }
  return summarizeIngredientConsumption({
    ingredient,
    ingredients: [ingredient],
    branchId: parsed.branch,
    window,
    sales: sales || [],
    recipeLinks,
    latestSalesDate,
  });
}
