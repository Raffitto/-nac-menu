/**
 * Classify kitchen items that currently have no menu_item_id recipe link.
 * Detect only — never auto-link ambiguous identities.
 */

import { requiresKitchenRecipe } from "../../inventory/foodBible";

export const RECIPE_GAP_CLASS = Object.freeze({
  EXACT_MAPPING_MISSING: "EXACT_MAPPING_MISSING",
  HIGH_CONFIDENCE_NORMALIZED: "HIGH_CONFIDENCE_NORMALIZED",
  AMBIGUOUS: "AMBIGUOUS",
  LEGACY_ONLY: "LEGACY_ONLY",
  SOURCE_CARD_UNLINKED: "SOURCE_CARD_UNLINKED",
  TRUE_MISSING: "TRUE_MISSING",
  FALSE_POSITIVE: "FALSE_POSITIVE",
});

export function normalizeIdentityName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function recipeNames(recipe) {
  return [recipe.name, recipe.normalized_name, recipe.name_en, recipe.internal_name]
    .map(normalizeIdentityName)
    .filter(Boolean);
}

function hasSourceCard(recipe) {
  return Boolean(
    recipe.source_card_id
    || recipe.source_file_id
    || recipe.source_document_id
    || (recipe.documentation && (
      recipe.documentation.sourceYieldRaw
      || (Array.isArray(recipe.documentation.unresolvedSourceLines)
        && recipe.documentation.unresolvedSourceLines.length)
    )),
  );
}

export function classifyKitchenRecipeGaps({ menuItems = [], recipes = [] } = {}) {
  const linkedMenuIds = new Set((recipes || []).map((r) => r.menu_item_id).filter(Boolean));
  const byName = new Map();
  for (const recipe of recipes || []) {
    for (const key of recipeNames(recipe)) {
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(recipe);
    }
  }

  const menuNameCounts = new Map();
  for (const item of menuItems || []) {
    if (item.active === false) continue;
    const key = normalizeIdentityName(item.name_en || item.name);
    if (!key) continue;
    menuNameCounts.set(key, (menuNameCounts.get(key) || 0) + 1);
  }

  const rows = [];
  for (const item of menuItems || []) {
    if (item.active === false) continue;
    if (linkedMenuIds.has(item.id)) continue;
    const kitchenExpected = requiresKitchenRecipe({
      name: item.name_en || item.name,
      categoryName: item.category_name || item.category || item.section_name,
    });
    const itemName = item.name_en || item.name || item.id;
    const key = normalizeIdentityName(itemName);
    const candidates = key ? [...new Set(byName.get(key) || [])] : [];
    const active = candidates.filter((r) => r.active !== false);
    const inactive = candidates.filter((r) => r.active === false);
    const menuCollisions = menuNameCounts.get(key) || 0;

    if (!kitchenExpected) {
      rows.push({
        class: RECIPE_GAP_CLASS.FALSE_POSITIVE,
        itemId: item.id,
        itemName,
        confidence: 1,
        reason: "Item is beverage/retail/modifier — not recipe-required",
        candidates: [],
      });
      continue;
    }

    if (menuCollisions > 1 || active.length > 1) {
      rows.push({
        class: RECIPE_GAP_CLASS.AMBIGUOUS,
        itemId: item.id,
        itemName,
        confidence: 0.4,
        reason: menuCollisions > 1
          ? `${menuCollisions} active menu identities share this name`
          : `${active.length} active recipes share this name`,
        candidates: (active.length ? active : candidates).slice(0, 5).map((r) => ({
          id: r.id,
          name: r.name,
          active: r.active !== false,
        })),
      });
      continue;
    }

    if (active.length === 1) {
      const recipe = active[0];
      const exact = normalizeIdentityName(recipe.name) === key
        || normalizeIdentityName(recipe.normalized_name) === key;
      rows.push({
        class: exact ? RECIPE_GAP_CLASS.EXACT_MAPPING_MISSING : RECIPE_GAP_CLASS.HIGH_CONFIDENCE_NORMALIZED,
        itemId: item.id,
        itemName,
        confidence: exact ? 0.99 : 0.85,
        reason: exact
          ? "Unique active recipe name matches; menu_item_id is missing"
          : "Unique normalized name match; mapping is reviewable, not auto-applied",
        candidates: [{ id: recipe.id, name: recipe.name, active: true }],
      });
      continue;
    }

    if (inactive.length === 1 && active.length === 0) {
      rows.push({
        class: RECIPE_GAP_CLASS.LEGACY_ONLY,
        itemId: item.id,
        itemName,
        confidence: 0.6,
        reason: "Only an inactive/legacy recipe matches this name",
        candidates: inactive.slice(0, 3).map((r) => ({ id: r.id, name: r.name, active: false })),
      });
      continue;
    }

    const unlinkedSource = (recipes || []).filter((r) => (
      !r.menu_item_id && hasSourceCard(r) && recipeNames(r).includes(key)
    ));
    if (unlinkedSource.length) {
      rows.push({
        class: RECIPE_GAP_CLASS.SOURCE_CARD_UNLINKED,
        itemId: item.id,
        itemName,
        confidence: 0.7,
        reason: "Source card / Food Bible identity exists but canonical menu link is missing",
        candidates: unlinkedSource.slice(0, 3).map((r) => ({ id: r.id, name: r.name, active: r.active !== false })),
      });
      continue;
    }

    rows.push({
      class: RECIPE_GAP_CLASS.TRUE_MISSING,
      itemId: item.id,
      itemName,
      confidence: 0.2,
      reason: "No recipe identity found",
      candidates: [],
    });
  }

  const counts = Object.fromEntries(Object.values(RECIPE_GAP_CLASS).map((k) => [k, 0]));
  for (const row of rows) counts[row.class] += 1;
  return {
    rows,
    counts,
    originalKitchenNoRecipe: rows.filter((r) => r.class !== RECIPE_GAP_CLASS.FALSE_POSITIVE).length,
    deterministicRepairable: rows.filter((r) => (
      r.class === RECIPE_GAP_CLASS.EXACT_MAPPING_MISSING
      && r.candidates.length === 1
      && (menuNameCounts.get(normalizeIdentityName(r.itemName)) || 0) === 1
    )).length,
    repaired: 0,
  };
}

export function recipeGapIssueCode(classification) {
  return `kitchen_recipe_${String(classification || "").toLowerCase()}`;
}
