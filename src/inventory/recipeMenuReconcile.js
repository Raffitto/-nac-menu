/**
 * Deterministic live-menu ↔ recipe reconciliation.
 * Live online menu is the only source of ACTIVE sellable items.
 * Recipe PDFs never activate an item by themselves.
 */

import { normalizeText } from "./inventoryIntelligence";
import { normalizeFoodBibleText } from "./foodBibleKsaAdaptation";

export const RECONCILE_STATES = Object.freeze({
  ACTIVE_MATCHED: "active + matched",
  ACTIVE_RECIPE_MISSING: "active + recipe missing",
  RECIPE_LEGACY_INACTIVE: "recipe exists + legacy/inactive",
  AMBIGUOUS_MATCH: "ambiguous match",
  DUPLICATE_VERSION_CONFLICT: "duplicate/version conflict",
  SUB_RECIPE_NON_SELLABLE: "sub-recipe/non-sellable",
  UNRESOLVED: "unresolved",
});

/** Explicit documented aliases. Never silent fuzzy truth. */
export const RECIPE_NAME_ALIASES = Object.freeze([
  ["big nac v2", "big nac"],
  ["big nac", "big nac v2"],
  ["prawn rendang grilled lemon", "prawn rendang"],
  ["king prawn rendang", "prawn rendang"],
  ["sea bass creole with pepper cream sauce n a", "sea bass"],
  ["sea bass in baking sheet", "sea bass"],
  ["pan seared seabass", "sea bass"],
  ["seabass", "sea bass"],
  ["watermelon cucumber feta pine nuts balsamic dressing", "watermelon cucumber"],
  ["chocolate brownie with cookie chunk caramel", "chocolate brownie"],
  ["brownies", "chocolate brownie"],
  ["apple bircher muesli", "apple bircher"],
]);

export function normalizeRecipeMatchKey(value) {
  return normalizeText(normalizeFoodBibleText(value))
    .replace(/\b(v2|version 2|daytime|batches|n a)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function aliasKeys(key) {
  const keys = new Set([key]);
  for (const [from, to] of RECIPE_NAME_ALIASES) {
    if (key === from || key.includes(from)) keys.add(normalizeRecipeMatchKey(to));
    if (key === to || key.includes(to)) keys.add(normalizeRecipeMatchKey(from));
  }
  return [...keys].filter(Boolean);
}

function tokenSet(key) {
  return new Set(String(key || "").split(" ").filter((token) => token.length > 2));
}

function isSellableLive(item) {
  if (!item) return false;
  if (item.active === false) return false;
  if (item.sold_out) return true;
  if (item.hidden_until && new Date(item.hidden_until) > new Date()) return false;
  return true;
}

function uniqueLiveIdentities(liveItems = []) {
  const groups = new Map();
  for (const item of liveItems) {
    const key = item.placement_group_id || item.id;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { identityKey: key, primary: item, placements: [item] });
    } else {
      existing.placements.push(item);
    }
  }
  return [...groups.values()];
}

function mostSpecificContainment(recipeKey, liveIdentities) {
  const recipeTokens = tokenSet(recipeKey);
  const hits = [];
  for (const group of liveIdentities) {
    const liveKey = normalizeRecipeMatchKey(group.primary.name || group.primary.name_en);
    const liveTokens = tokenSet(liveKey);
    if (!liveTokens.size) continue;
    const contained = [...liveTokens].every((token) => recipeTokens.has(token));
    if (!contained) continue;
    if (liveTokens.size === 1 && recipeTokens.size > 4) continue;
    hits.push({ group, liveKey, tokenCount: liveTokens.size, keyLength: liveKey.length });
  }
  if (!hits.length) return [];
  hits.sort((a, b) => b.tokenCount - a.tokenCount || b.keyLength - a.keyLength);
  const best = hits[0];
  const tied = hits.filter((hit) => hit.tokenCount === best.tokenCount && hit.liveKey !== best.liveKey);
  if (tied.length) return hits;
  return hits.filter((hit) => hit.liveKey === best.liveKey);
}

export function reconcileRecipesToLiveMenu({
  liveItems = [],
  recipes = [],
  importDate = null,
  brand = "NAC",
} = {}) {
  const liveIdentities = uniqueLiveIdentities(liveItems).filter((group) => isSellableLive(group.primary));
  const liveByKey = new Map();
  for (const group of liveIdentities) {
    const key = normalizeRecipeMatchKey(group.primary.name || group.primary.name_en);
    const bucket = liveByKey.get(key) || [];
    bucket.push(group);
    liveByKey.set(key, bucket);
  }

  const finished = recipes
    .filter((recipe) => recipe.recipeKind !== "prep")
    .slice()
    .sort((a, b) => String(b.ksaOperationalTitle || b.sourceTitle || "").length - String(a.ksaOperationalTitle || a.sourceTitle || "").length);
  const prep = recipes.filter((recipe) => recipe.recipeKind === "prep");

  const recipeRows = [];
  const matchedLiveKeys = new Set();
  const reviewQueue = [];

  for (const recipe of prep) {
    recipeRows.push({
      state: RECONCILE_STATES.SUB_RECIPE_NON_SELLABLE,
      recipeTitle: recipe.ksaOperationalTitle || recipe.sourceTitle,
      sourceFile: recipe.sourceFile,
      sourceLocator: recipe.sourceLocator,
      recipeKind: "prep",
      liveItem: null,
      candidates: [],
      brand,
      importDate,
      operationallyActive: false,
    });
  }

  for (const recipe of finished) {
    const title = recipe.ksaOperationalTitle || recipe.sourceTitle;
    const recipeKey = normalizeRecipeMatchKey(title);
    const keys = aliasKeys(recipeKey);
    const exactByName = new Map();
    const seen = new Set();
    for (const key of keys) {
      for (const group of liveByKey.get(key) || []) {
        if (seen.has(group.identityKey)) continue;
        seen.add(group.identityKey);
        const liveKey = normalizeRecipeMatchKey(group.primary.name || group.primary.name_en);
        const bucket = exactByName.get(liveKey) || [];
        bucket.push(group);
        exactByName.set(liveKey, bucket);
      }
    }

    let candidates = [];
    let matchedGroups = [];
    let state = RECONCILE_STATES.RECIPE_LEGACY_INACTIVE;
    const distinctNames = [...exactByName.keys()];
    if (distinctNames.length === 1) {
      matchedGroups = (exactByName.get(distinctNames[0]) || []).filter((group) => !matchedLiveKeys.has(group.identityKey));
      if (matchedGroups.length) state = RECONCILE_STATES.ACTIVE_MATCHED;
      else {
        state = RECONCILE_STATES.DUPLICATE_VERSION_CONFLICT;
        reviewQueue.push({
          code: "DUPLICATE_VERSION_CONFLICT",
          recipeTitle: title,
          liveNames: distinctNames,
        });
      }
    } else if (distinctNames.length > 1) {
      state = RECONCILE_STATES.DUPLICATE_VERSION_CONFLICT;
      matchedGroups = distinctNames.flatMap((name) => exactByName.get(name));
      reviewQueue.push({
        code: "DUPLICATE_VERSION_CONFLICT",
        recipeTitle: title,
        liveNames: distinctNames,
      });
    } else {
      const contained = mostSpecificContainment(recipeKey, liveIdentities);
      const distinctContained = [...new Set(contained.map((hit) => hit.liveKey))];
      if (distinctContained.length === 1) {
        matchedGroups = contained.map((hit) => hit.group).filter((group) => !matchedLiveKeys.has(group.identityKey));
        if (matchedGroups.length) state = RECONCILE_STATES.ACTIVE_MATCHED;
        else {
          state = RECONCILE_STATES.DUPLICATE_VERSION_CONFLICT;
          reviewQueue.push({
            code: "DUPLICATE_VERSION_CONFLICT",
            recipeTitle: title,
            liveNames: distinctContained,
          });
        }
      } else if (distinctContained.length > 1) {
        state = RECONCILE_STATES.AMBIGUOUS_MATCH;
        candidates = contained.map((hit) => ({ group: hit.group, score: hit.tokenCount }));
        reviewQueue.push({
          code: "AMBIGUOUS_MATCH",
          recipeTitle: title,
          candidates: distinctContained,
        });
      }
    }

    for (const group of matchedGroups) matchedLiveKeys.add(group.identityKey);
    const liveItem = matchedGroups[0] || null;

    recipeRows.push({
      state,
      recipeTitle: title,
      sourceFile: recipe.sourceFile,
      sourceLocator: recipe.sourceLocator,
      recipeKind: recipe.recipeKind || "finished",
      liveItem,
      matchedIdentityKeys: matchedGroups.map((group) => group.identityKey),
      candidates: candidates.map((c) => ({
        name: c.group.primary.name || c.group.primary.name_en,
        score: c.score,
      })),
      brand,
      importDate,
      operationallyActive: state === RECONCILE_STATES.ACTIVE_MATCHED,
      issues: recipe.issues || [],
      yieldRaw: recipe.yieldRaw || null,
      ingredientCount: (recipe.ksaIngredients || recipe.ingredients || []).length,
    });
  }

  const liveRows = liveIdentities.map((group) => {
    const matched = recipeRows.find(
      (row) => row.state === RECONCILE_STATES.ACTIVE_MATCHED
        && (
          row.liveItem?.identityKey === group.identityKey
          || (row.matchedIdentityKeys || []).includes(group.identityKey)
        ),
    );
    if (matched) {
      return {
        state: RECONCILE_STATES.ACTIVE_MATCHED,
        liveName: group.primary.name || group.primary.name_en,
        liveId: group.primary.id,
        identityKey: group.identityKey,
        recipeTitle: matched.recipeTitle,
        operationallyActive: true,
        price: group.primary.price || null,
      };
    }
    return {
      state: RECONCILE_STATES.ACTIVE_RECIPE_MISSING,
      liveName: group.primary.name || group.primary.name_en,
      liveId: group.primary.id,
      identityKey: group.identityKey,
      recipeTitle: null,
      operationallyActive: true,
      price: group.primary.price || null,
    };
  });

  for (const row of liveRows) {
    if (row.state === RECONCILE_STATES.ACTIVE_RECIPE_MISSING) {
      reviewQueue.push({
        code: "ACTIVE_RECIPE_MISSING",
        liveName: row.liveName,
        liveId: row.liveId,
      });
    }
  }

  const activeMatched = liveRows.filter((row) => row.state === RECONCILE_STATES.ACTIVE_MATCHED).length;
  const activeMissing = liveRows.filter((row) => row.state === RECONCILE_STATES.ACTIVE_RECIPE_MISSING).length;
  const legacy = recipeRows.filter((row) => row.state === RECONCILE_STATES.RECIPE_LEGACY_INACTIVE).length;
  const appleBircher = recipeRows.find((row) => /apple bircher/i.test(row.recipeTitle || "")) || null;

  return {
    liveRows,
    recipeRows,
    reviewQueue,
    appleBircher: appleBircher
      ? {
          title: appleBircher.recipeTitle,
          state: appleBircher.state,
          operationallyActive: false,
        }
      : { title: null, state: "NOT_FOUND_IN_PACKAGE", operationallyActive: false },
    summary: {
      liveActiveCount: liveIdentities.length,
      finishedRecipeCount: finished.length,
      prepRecipeCount: prep.length,
      activeMatched,
      activeMissing,
      activeMatchPct: liveIdentities.length ? Math.round((activeMatched / liveIdentities.length) * 100) : 0,
      legacyInactiveCount: legacy,
      ambiguousCount: recipeRows.filter((row) => row.state === RECONCILE_STATES.AMBIGUOUS_MATCH).length,
      duplicateConflictCount: recipeRows.filter((row) => row.state === RECONCILE_STATES.DUPLICATE_VERSION_CONFLICT).length,
      subRecipeCount: prep.length,
      reviewQueueCount: reviewQueue.length,
    },
  };
}
