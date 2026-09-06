/**
 * Classify kitchen items that currently have no menu_item_id recipe link.
 * Detect only — never auto-link ambiguous identities.
 */

import { requiresKitchenRecipe } from "../../inventory/foodBible";
import { buildIdentityClusters, normalizeIdentityName } from "./identityClusters";

export { normalizeIdentityName };

export const RECIPE_GAP_CLASS = Object.freeze({
  EXACT_MAPPING_MISSING: "EXACT_MAPPING_MISSING",
  HIGH_CONFIDENCE_NORMALIZED: "HIGH_CONFIDENCE_NORMALIZED",
  AMBIGUOUS: "AMBIGUOUS",
  LEGACY_ONLY: "LEGACY_ONLY",
  SOURCE_CARD_UNLINKED: "SOURCE_CARD_UNLINKED",
  TRUE_MISSING: "TRUE_MISSING",
  FALSE_POSITIVE: "FALSE_POSITIVE",
});

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

  const identity = buildIdentityClusters(menuItems);
  const clusterByName = new Map(identity.clusters.map((c) => [c.normalizedName, c]));

  const rows = [];
  const repairPlan = [];
  for (const item of menuItems || []) {
    if (item.active === false) continue;
    if (linkedMenuIds.has(item.id)) continue;
    const kitchenExpected = requiresKitchenRecipe({
      name: item.name_en || item.name,
      categoryName: item.category_name || item.category || item.section_name,
    });
    const itemName = item.name_en || item.name || item.id;
    const key = normalizeIdentityName(itemName);
    const cluster = clusterByName.get(key);
    const candidates = key ? [...new Set(byName.get(key) || [])] : [];
    const active = candidates.filter((r) => r.active !== false);
    const inactive = candidates.filter((r) => r.active === false);
    const uniqueActiveRecipes = [...new Map(active.map((r) => [r.id, r])).values()];
    const extras = {
      clusterKind: cluster?.kind || null,
      clusterActiveCount: cluster?.activeCount || 1,
      itemIds: cluster?.activeItemIds || [item.id],
    };

    if (!kitchenExpected) {
      rows.push({
        class: RECIPE_GAP_CLASS.FALSE_POSITIVE,
        itemId: item.id,
        itemName,
        confidence: 1,
        reason: "Item is beverage/retail/modifier — not recipe-required",
        candidates: [],
        ...extras,
      });
      continue;
    }

    if (uniqueActiveRecipes.length > 1) {
      rows.push({
        class: RECIPE_GAP_CLASS.AMBIGUOUS,
        itemId: item.id,
        itemName,
        confidence: 0.4,
        reason: `${uniqueActiveRecipes.length} active recipes share this identity cluster`,
        candidates: uniqueActiveRecipes.slice(0, 5).map((r) => ({
          id: r.id,
          name: r.name,
          active: r.active !== false,
        })),
        ...extras,
      });
      continue;
    }

    if (uniqueActiveRecipes.length === 1) {
      const recipe = uniqueActiveRecipes[0];
      const exact = normalizeIdentityName(recipe.name) === key
        || normalizeIdentityName(recipe.normalized_name) === key;
      const siblingLinked = (cluster?.activeItemIds || []).some((id) => linkedMenuIds.has(id));
      rows.push({
        class: exact ? RECIPE_GAP_CLASS.EXACT_MAPPING_MISSING : RECIPE_GAP_CLASS.HIGH_CONFIDENCE_NORMALIZED,
        itemId: item.id,
        itemName,
        confidence: exact ? 0.99 : 0.85,
        reason: siblingLinked
          ? "Unique cluster recipe already linked to a sibling menu row — Food Bible treats the identity as mapped"
          : exact
            ? "Unique active recipe for this identity cluster; menu_item_id is missing"
            : "Unique normalized cluster match; mapping is reviewable, not auto-applied",
        candidates: [{ id: recipe.id, name: recipe.name, active: true }],
        ...extras,
      });
      if (
        exact
        && !recipe.menu_item_id
        && uniqueActiveRecipes.length === 1
        && cluster
        && cluster.kind !== "AMBIGUOUS"
      ) {
        repairPlan.push({
          cluster: cluster.normalizedName,
          duplicateItemIds: cluster.activeItemIds,
          canonicalRecipeId: recipe.id,
          canonicalRecipeName: recipe.name,
          recommendedAction: "link_recipe_menu_item_id_to_primary_only",
          primaryMenuItemId: cluster.activeItemIds[0],
          whyDeterministic: "One unique active recipe for one identity cluster",
          reversible: true,
          applied: false,
        });
      }
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
        ...extras,
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
        ...extras,
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
      ...extras,
    });
  }

  const uniqueRepair = [];
  const seenRepair = new Set();
  for (const plan of repairPlan) {
    if (seenRepair.has(plan.cluster)) continue;
    seenRepair.add(plan.cluster);
    uniqueRepair.push(plan);
  }

  const counts = Object.fromEntries(Object.values(RECIPE_GAP_CLASS).map((k) => [k, 0]));
  for (const row of rows) counts[row.class] += 1;
  const clusterClasses = new Map();
  for (const row of rows) {
    if (row.class === RECIPE_GAP_CLASS.FALSE_POSITIVE) continue;
    const key = normalizeIdentityName(row.itemName);
    if (!clusterClasses.has(key)) clusterClasses.set(key, row.class);
  }
  const clusterCounts = Object.fromEntries(Object.values(RECIPE_GAP_CLASS).map((k) => [k, 0]));
  for (const cls of clusterClasses.values()) clusterCounts[cls] += 1;

  return {
    rows,
    counts,
    clusterCounts,
    identity,
    repairPlan: uniqueRepair,
    originalKitchenNoRecipe: rows.filter((r) => r.class !== RECIPE_GAP_CLASS.FALSE_POSITIVE).length,
    deterministicRepairable: uniqueRepair.length,
    repaired: 0,
  };
}

export function recipeGapIssueCode(classification) {
  return `kitchen_recipe_${String(classification || "").toLowerCase()}`;
}
