/**
 * Deterministic Food Bible → canonical recipe/ingredient apply plan.
 * Persistence is injected so the same logic is idempotent in tests and in authenticated apply.
 */

import { normalizeText, normalizeUnit } from "./inventoryIntelligence";
import { RECONCILE_STATES } from "./recipeMenuReconcile";

export const PACKAGE_ID = "food-bible-2026-08-20";
export const PACKAGE_EFFECTIVE_FROM = "2026-08-20T00:00:00+03:00";

export function recipeImportKey({ sourceFile, title }) {
  return `fb:20260820:${normalizeText(sourceFile || "")}:${normalizeText(title || "")}`;
}

export function normalizeIngredientKey(name) {
  return normalizeText(String(name || ""))
    .replace(/\b(fresh|chopped|sliced|diced|grated|finely|roughly|optional|to taste|hand torn|baby)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function singularVariants(key) {
  const value = String(key || "").trim();
  if (!value) return [];
  const variants = [value];
  if (value.endsWith("ies") && value.length > 4) variants.push(`${value.slice(0, -3)}y`);
  else if (value.endsWith("oes") && value.length > 4) variants.push(value.slice(0, -2));
  else if (value.endsWith("s") && !value.endsWith("ss") && value.length > 3) variants.push(value.slice(0, -1));
  return [...new Set(variants)];
}

function titleCaseName(key) {
  return String(key || "")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function mapSourceUnit(unit) {
  if (!unit) return null;
  try {
    return normalizeUnit(unit);
  } catch {
    return null;
  }
}

export function parseYield(yieldRaw) {
  const text = String(yieldRaw || "").toLowerCase();
  const match = text.match(/([0-9]+(?:[.,][0-9]+)?)\s*(pax|kg|g|l|ml|units?|each)/i);
  if (!match) {
    return { outputQuantity: 1, outputUnit: "each", portionCount: 1, portionSize: 1, portionUnit: "each" };
  }
  const quantity = Number(String(match[1]).replace(",", "."));
  const unitToken = match[2];
  const unit = unitToken === "pax" || unitToken.startsWith("unit")
    ? "each"
    : mapSourceUnit(unitToken) || "each";
  return {
    outputQuantity: quantity || 1,
    outputUnit: unit,
    portionCount: unit === "each" ? quantity || 1 : 1,
    portionSize: unit === "each" ? 1 : quantity || 1,
    portionUnit: unit,
  };
}

export function lineFingerprint(lines = []) {
  return JSON.stringify(
    (lines || [])
      .map((line) => ({
        n: normalizeIngredientKey(line.name || line.sourceName || ""),
        q: String(line.quantity ?? line.sourceQuantity ?? ""),
        u: mapSourceUnit(line.unit || line.sourceUnit) || "",
        s: normalizeText(line.subRecipeName || ""),
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
}

export function matchCanonicalIngredient(name, ingredients = []) {
  const keys = singularVariants(normalizeIngredientKey(name));
  if (!keys.length) return { status: "skip", reason: "EMPTY_NAME" };
  const hits = [];
  for (const ingredient of ingredients) {
    const aliases = singularVariants(normalizeIngredientKey(ingredient.canonicalName));
    const storedAliases = String(ingredient.description || "")
      .replace(/^food bible aliases:\s*/i, "")
      .split("|")
      .map((token) => normalizeIngredientKey(token))
      .filter(Boolean);
    if (
      keys.some((key) => aliases.includes(key) || ingredient.normalizedSearchName === key || storedAliases.includes(key))
    ) {
      hits.push(ingredient);
    }
  }
  const unique = [...new Map(hits.map((hit) => [hit.id || hit.canonicalName, hit])).values()];
  if (unique.length === 1) {
    return { status: "reuse", ingredient: unique[0], key: keys[0] };
  }
  if (unique.length > 1) {
    return { status: "ambiguous", candidates: unique, key: keys[0] };
  }
  return {
    status: "create",
    key: keys[0],
    canonicalName: titleCaseName(keys[0]),
  };
}

function shouldSkipGarbageTitle(title) {
  return /^(utensils used|timing|menu section|ingredients|method|notes|unit|yield)$/i.test(String(title || "").trim());
}

export function buildApplyPlan({
  recipes = [],
  recipeRows = [],
  ingredients = [],
  existingRecipes = [],
} = {}) {
  const recipeByTitleFile = new Map();
  const recipeByTitle = new Map();
  for (const recipe of recipes) {
    const title = recipe.ksaOperationalTitle || recipe.sourceTitle;
    const fileKey = `${recipe.sourceFile || ""}::${title}`;
    const richer = (left, right) => {
      const leftCount = (left?.ksaIngredients || left?.ingredients || []).filter((ing) => ing.sourceQuantity != null).length;
      const rightCount = (right?.ksaIngredients || right?.ingredients || []).filter((ing) => ing.sourceQuantity != null).length;
      return rightCount > leftCount ? right : left;
    };
    recipeByTitleFile.set(fileKey, richer(recipeByTitleFile.get(fileKey), recipe) || recipe);
    recipeByTitle.set(title, richer(recipeByTitle.get(title), recipe) || recipe);
  }
  const existingByKey = new Map(
    (existingRecipes || []).map((recipe) => [recipe.internalName || recipe.importKey, recipe]),
  );
  const persist = [];
  const skipped = [];
  const ingredientActions = [];
  const unresolvedIngredients = [];
  const seenIngredientKeys = new Set();
  const prepKeys = new Set(
    recipeRows
      .filter((row) => row.state === RECONCILE_STATES.SUB_RECIPE_NON_SELLABLE || row.recipeKind === "prep")
      .map((row) => normalizeIngredientKey(row.recipeTitle)),
  );

  for (const row of recipeRows) {
    const title = row.recipeTitle;
    if (shouldSkipGarbageTitle(title)) {
      skipped.push({ title, reason: "NON_RECIPE_TITLE" });
      continue;
    }
    const source = recipeByTitleFile.get(`${row.sourceFile || ""}::${title}`)
      || recipeByTitle.get(title);
    if (!source) {
      skipped.push({ title, reason: "SOURCE_NOT_FOUND" });
      continue;
    }
    const importKey = recipeImportKey({
      sourceFile: source.sourceFile || row.sourceFile,
      title,
    });
    const yieldFields = parseYield(source.yieldRaw);
    const isPrep = row.state === RECONCILE_STATES.SUB_RECIPE_NON_SELLABLE || source.recipeKind === "prep";
    const isLegacy = row.state === RECONCILE_STATES.RECIPE_LEGACY_INACTIVE;
    const isAmbiguous = row.state === RECONCILE_STATES.AMBIGUOUS_MATCH;
    const isConflict = row.state === RECONCILE_STATES.DUPLICATE_VERSION_CONFLICT;
    const isMatched = row.state === RECONCILE_STATES.ACTIVE_MATCHED;
    const live = row.liveItem?.primary || row.liveItem || null;
    const menuItemId = isMatched ? (live.id || null) : null;
    const placementGroupId = isMatched ? (live.placement_group_id || null) : null;

    const lines = [];
    for (const ing of source.ksaIngredients || source.ingredients || []) {
      const sourceName = ing.ksaOperationalName || ing.sourceName;
      const unit = mapSourceUnit(ing.sourceUnit || ing.canonicalUnit);
      const quantity = ing.sourceQuantity ?? ing.canonicalQuantity;
      if (!sourceName) continue;
      const ingredientKey = normalizeIngredientKey(sourceName);
      const isSubRecipe = prepKeys.has(ingredientKey)
        || singularVariants(ingredientKey).some((key) => prepKeys.has(key));
      if (quantity == null || !unit) {
        unresolvedIngredients.push({
          recipeTitle: title,
          sourceName,
          reason: quantity == null ? "MISSING_QUANTITY" : "UNKNOWN_UNIT",
          sourceUnit: ing.sourceUnit || null,
        });
        continue;
      }
      if (isSubRecipe) {
        lines.push({
          sourceName,
          ingredientKey,
          subRecipeName: sourceName,
          quantity,
          unit,
          note: ing.notes || "",
        });
        continue;
      }
      const match = matchCanonicalIngredient(sourceName, ingredients);
      if (match.status === "ambiguous") {
        unresolvedIngredients.push({
          recipeTitle: title,
          sourceName,
          reason: "AMBIGUOUS_INGREDIENT",
          candidates: match.candidates.map((item) => item.canonicalName),
        });
        continue;
      }
      if (match.status === "create" && !seenIngredientKeys.has(match.key)) {
        seenIngredientKeys.add(match.key);
        ingredientActions.push({
          action: "create",
          key: match.key,
          canonicalName: match.canonicalName,
          baseInventoryUnit: unit,
          sourceNames: [sourceName],
        });
      } else if (match.status === "reuse") {
        ingredientActions.push({
          action: "reuse",
          key: match.key,
          ingredientId: match.ingredient.id,
          canonicalName: match.ingredient.canonicalName,
          sourceNames: [sourceName],
        });
      }
      lines.push({
        sourceName,
        ingredientKey: match.key,
        quantity,
        unit,
        note: ing.notes || "",
      });
    }

    persist.push({
      importKey,
      name: title,
      recipeType: isPrep || isLegacy || isAmbiguous || isConflict ? (isPrep ? "preparation" : "menu_item") : "menu_item",
      active: Boolean(isMatched || isPrep) && !isAmbiguous && !isLegacy && !isConflict,
      menuItemId,
      placementGroupId,
      ...yieldFields,
      documentation: {
        preparationMethod: Array.isArray(source.method) ? source.method.join("\n") : (source.method || ""),
        sourceDocument: source.sourceFile,
        sourceLocator: source.sourceLocator,
        importKey,
        packageId: PACKAGE_ID,
        reconcileState: row.state,
        provenance: {
          sha256: source.sha256 || null,
          pages: source.pages || [],
          importDate: "2026-08-20",
        },
      },
      lines,
      fingerprint: lineFingerprint(lines),
      existing: existingByKey.get(importKey) || null,
    });
  }

  const seenImportKeys = new Map();
  const deduped = [];
  for (const row of persist) {
    const previous = seenImportKeys.get(row.importKey);
    if (previous != null) {
      if (row.lines.length > deduped[previous].lines.length) {
        skipped.push({ title: deduped[previous].name, reason: "DUPLICATE_IMPORT_KEY_SUPERSEDED", importKey: row.importKey });
        deduped[previous] = row;
      } else {
        skipped.push({ title: row.name, reason: "DUPLICATE_IMPORT_KEY", importKey: row.importKey });
      }
      continue;
    }
    seenImportKeys.set(row.importKey, deduped.length);
    deduped.push(row);
  }

  return {
    persist: deduped,
    skipped,
    ingredientActions,
    unresolvedIngredients,
    createIngredientCount: ingredientActions.filter((row) => row.action === "create").length,
    reuseIngredientCount: new Set(ingredientActions.filter((row) => row.action === "reuse").map((row) => row.ingredientId)).size,
  };
}

export function applyDecision(existing, nextFingerprint, extras = {}) {
  if (!existing) return "create";
  const existingLineCount = extras.existingLineCount;
  const planned = extras.plannedLineCount || 0;
  if (planned > 0 && (existingLineCount === 0 || existingLineCount == null) && extras.hasLines === false) {
    return "new_version";
  }
  if (planned > 0 && Number(existingLineCount) < planned) return "new_version";
  const previous = existing.fingerprint || existing.documentation?.fingerprint;
  if (previous && previous === nextFingerprint) return "skip_identical";
  return "new_version";
}
