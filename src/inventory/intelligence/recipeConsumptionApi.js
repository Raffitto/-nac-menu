import { consumptionWindow, parseConsumptionQuestion, summarizeIngredientConsumption } from "./consumptionEvidence";
import { COMMERCE_ITEM_SELECT, mapCommerceItemRow, SALES_SOURCE } from "../truth/salesSource";
import { recoveredLinksForIngredient, FOODICS_RECIPE_EXPORT_AS_OF } from "./foodicsRecipeRecovery";

export async function pageCommerceSales(supabase, branch, window, { pageSize = 1000, maxPages = 20 } = {}) {
  const rows = [];
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const commerce = await supabase
      .from("commerce_order_items")
      .select(COMMERCE_ITEM_SELECT)
      .eq("branch_id", branch)
      .gte("business_date", window.start)
      .lte("business_date", window.end)
      .order("source_order_item_id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (commerce.error) return { error: commerce.error, rows, complete: false };
    const chunk = commerce.data || [];
    rows.push(...chunk.map(mapCommerceItemRow).filter(Boolean));
    if (chunk.length < pageSize) return { error: null, rows, complete: true };
  }
  return { error: null, rows, complete: false };
}

async function loadAuthoritativeSales(supabase, branch, window) {
  const commerce = await pageCommerceSales(supabase, branch, window);
  if (!commerce.error) {
    let latestSalesDate = null;
    if (!commerce.rows.length) {
      const fresh = await supabase
        .from("commerce_dataset_freshness")
        .select("data_through")
        .eq("branch_id", branch)
        .eq("dataset", "order_items")
        .limit(1);
      latestSalesDate = fresh.data?.[0]?.data_through || null;
    }
    return {
      rows: commerce.rows,
      complete: commerce.complete,
      source: SALES_SOURCE.CANONICAL_COMMERCE,
      latestSalesDate,
    };
  }
  if (!/does not exist|schema cache/i.test(String(commerce.error.message || commerce.error))) {
    throw commerce.error;
  }
  const legacy = await supabase
    .from("foodics_sales_items")
    .select("raw_item_name, matched_menu_item_id, quantity_sold, is_modifier, semantic_class, period_start, period_end")
    .eq("branch_id", branch)
    .gte("period_start", window.start)
    .lte("period_end", window.end)
    .limit(5000);
  if (legacy.error) throw legacy.error;
  let latestSalesDate = null;
  if (!legacy.data?.length) {
    const latest = await supabase
      .from("foodics_sales_items")
      .select("period_end")
      .eq("branch_id", branch)
      .order("period_end", { ascending: false })
      .limit(1);
    latestSalesDate = latest.data?.[0]?.period_end || null;
  }
  return { rows: legacy.data || [], complete: true, source: SALES_SOURCE.FOODICS_SALES_ITEMS, latestSalesDate };
}

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
  const recipeLinks = [];
  const notYetEffective = [];
  (lines || []).forEach((line) => {
    const version = versionById[line.recipe_version_id];
    const recipe = version ? recipeById[version.recipe_id] : null;
    if (!version || version.status !== "active" || !recipe?.active || !recipe.menu_item_id) return;
    const from = String(version.effective_from || "").slice(0, 10);
    const to = version.effective_to ? String(version.effective_to).slice(0, 10) : null;
    if (from > window.end || (to && to <= window.start)) {
      if (from > window.end) notYetEffective.push({ from, menuItemId: recipe.menu_item_id });
      return;
    }
    recipeLinks.push({
      menuItemId: recipe.menu_item_id,
      outputQuantity: recipe.output_quantity,
      canonicalQuantity: line.canonical_quantity,
      canonicalUnit: line.canonical_unit,
    });
  });
  const salesLoad = await loadAuthoritativeSales(supabase, parsed.branch, window);
  if (window.start >= FOODICS_RECIPE_EXPORT_AS_OF) {
    recipeLinks.push(...recoveredLinksForIngredient(salesLoad.rows, ingredient.name));
  }
  const summary = summarizeIngredientConsumption({
    ingredient,
    ingredients: [ingredient],
    branchId: parsed.branch,
    window,
    sales: salesLoad.rows,
    recipeLinks,
    latestSalesDate: salesLoad.latestSalesDate,
    source: salesLoad.source,
    salesComplete: salesLoad.complete,
  });
  if (!summary.quantity && notYetEffective.length) {
    summary.reason = `${summary.reason} A later recipe version starts ${notYetEffective[0].from} and was not applied to this date.`;
  }
  if (window.start < FOODICS_RECIPE_EXPORT_AS_OF) {
    summary.reason = `${summary.reason} The recovered Foodics recipe export is dated ${FOODICS_RECIPE_EXPORT_AS_OF} and has no effective date covering ${window.start}.`;
  }
  return summary;
}
