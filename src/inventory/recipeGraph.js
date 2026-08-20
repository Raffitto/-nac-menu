/**
 * Recipe graph expansion, cycle detection, temporal version pick,
 * theoretical consumption preview, and costing completeness.
 * Missing cost is never treated as zero. Unknown conversions block.
 */

import {
  areUnitsCompatible,
  convertToCanonicalQuantity,
  multiplyDecimal,
  addDecimal,
  subtractDecimal,
  divideDecimal,
  normalizeUnit,
} from "./inventoryIntelligence";
import { findRecipeForMenuIdentity } from "./foodBible";

export const COSTING_STATES = Object.freeze({
  FULLY_COSTED: "fully costed",
  PARTIALLY_COSTED: "partially costed",
  UNCOSTED: "uncosted",
});

export function detectRecipeCycle(recipeId, linesByRecipeId = {}, stack = []) {
  if (!recipeId) return false;
  if (stack.includes(recipeId)) return true;
  const nextStack = [...stack, recipeId];
  const lines = linesByRecipeId[recipeId] || [];
  for (const line of lines) {
    const child = line.subRecipeId || line.sub_recipe_id;
    if (child && detectRecipeCycle(child, linesByRecipeId, nextStack)) {
      return true;
    }
  }
  return false;
}

export function resolveRecipeVersionForDate(versions = [], businessDate) {
  const asOf = businessDate
    ? new Date(`${String(businessDate).slice(0, 10)}T12:00:00+03:00`).getTime()
    : Date.now();
  const eligible = versions
    .filter((version) => version && version.status !== "draft")
    .filter((version) => {
      const from = version.effectiveFrom ? new Date(version.effectiveFrom).getTime() : 0;
      const to = version.effectiveTo ? new Date(version.effectiveTo).getTime() : Number.POSITIVE_INFINITY;
      return from <= asOf && asOf < to;
    })
    .sort((a, b) => {
      const fromDiff = new Date(b.effectiveFrom || 0).getTime() - new Date(a.effectiveFrom || 0).getTime();
      if (fromDiff) return fromDiff;
      return (b.versionNumber || 0) - (a.versionNumber || 0);
    });
  return eligible[0] || null;
}

export function convertOrBlock(quantity, fromUnit, toUnit) {
  if (quantity == null || quantity === "") {
    return { ok: false, code: "MISSING_QUANTITY", quantity: null };
  }
  if (!fromUnit || !toUnit) {
    return { ok: false, code: "MISSING_UNIT", quantity: null, fromUnit, toUnit };
  }
  try {
    const source = normalizeUnit(fromUnit);
    const target = normalizeUnit(toUnit);
    if (!areUnitsCompatible(source, target)) {
      return { ok: false, code: "UNKNOWN_CONVERSION", quantity: null, fromUnit: source, toUnit: target };
    }
    const converted = convertToCanonicalQuantity({
      quantity: String(quantity),
      originalUnit: source,
      canonicalUnit: target,
      packUnit: source,
    });
    return { ok: true, quantity: Number(converted.canonicalQuantity), unit: converted.canonicalUnit };
  } catch (err) {
    return {
      ok: false,
      code: "UNKNOWN_CONVERSION",
      quantity: null,
      detail: err.message,
      fromUnit,
      toUnit,
    };
  }
}

function recipeServings(recipe, version) {
  const output = Number(version?.outputQuantity ?? recipe?.outputQuantity ?? 1);
  return output > 0 ? output : 1;
}

export function expandRecipeToIngredients({
  recipeId,
  linesByRecipeId = {},
  recipesById = {},
  versionsByRecipeId = {},
  businessDate = null,
  soldQuantity = 1,
  visited = [],
} = {}) {
  if (!recipeId) {
    return { ok: false, code: "MISSING_RECIPE", ingredients: [], blockers: ["MISSING_RECIPE"] };
  }
  if (visited.includes(recipeId)) {
    return { ok: false, code: "CIRCULAR_DEPENDENCY", ingredients: [], blockers: ["CIRCULAR_DEPENDENCY"] };
  }
  const recipe = recipesById[recipeId] || {};
  const versions = versionsByRecipeId[recipeId] || [];
  const version = resolveRecipeVersionForDate(versions, businessDate)
    || versions.find((entry) => entry.status !== "draft")
    || versions[0]
    || null;
  const versionKey = version?.id || recipeId;
  const lines = linesByRecipeId[versionKey] || linesByRecipeId[recipeId] || [];
  const servings = recipeServings(recipe, version);
  const scale = Number(divideDecimal(String(soldQuantity || 0), String(servings)));
  const ingredients = [];
  const blockers = [];

  for (const line of lines) {
    const qty = Number(line.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      blockers.push({ code: "INVALID_QUANTITY", lineId: line.id || line.clientId });
      continue;
    }
    const scaledQty = Number(multiplyDecimal(String(qty), String(scale)));
    const childId = line.subRecipeId || line.sub_recipe_id;
    if (childId) {
      const nestedRecipe = recipesById[childId] || {};
      const nestedVersions = versionsByRecipeId[childId] || [];
      const nestedVersion = resolveRecipeVersionForDate(nestedVersions, businessDate)
        || nestedVersions.find((entry) => entry.status !== "draft")
        || nestedVersions[0]
        || null;
      const nestedOutputUnit = nestedVersion?.outputUnit || nestedRecipe.outputUnit || line.unit;
      const converted = convertOrBlock(scaledQty, line.unit, nestedOutputUnit);
      if (!converted.ok) {
        blockers.push({ ...converted, subRecipeId: childId });
        continue;
      }
      const nested = expandRecipeToIngredients({
        recipeId: childId,
        linesByRecipeId,
        recipesById,
        versionsByRecipeId,
        businessDate,
        soldQuantity: converted.quantity,
        visited: [...visited, recipeId],
      });
      if (!nested.ok) {
        blockers.push(...(nested.blockers || [{ code: nested.code }]));
        continue;
      }
      ingredients.push(...nested.ingredients);
      continue;
    }
    if (!line.ingredientId) continue;
    ingredients.push({
      ingredientId: line.ingredientId,
      quantity: scaledQty,
      unit: line.unit,
      name: line.name || null,
    });
  }

  return {
    ok: blockers.length === 0,
    ingredients,
    blockers,
    versionId: version?.id || null,
    recipeId,
  };
}

export function theoreticalConsumptionForSale(args) {
  const expanded = expandRecipeToIngredients(args);
  const totals = new Map();
  for (const line of expanded.ingredients) {
    const key = `${line.ingredientId}::${line.unit}`;
    const prev = totals.get(key);
    if (!prev) {
      totals.set(key, { ...line });
    } else {
      prev.quantity = Number(addDecimal(String(prev.quantity), String(line.quantity)));
    }
  }
  return {
    ...expanded,
    lines: [...totals.values()],
    authoritative: expanded.ok && (expanded.blockers || []).length === 0,
  };
}

export function resolveCanonicalSaleToRecipe({
  orderItem,
  recipes = [],
  menuIdentity = null,
  businessDate,
  linesByRecipeId,
  recipesById,
  versionsByRecipeId,
  soldQuantity = 1,
} = {}) {
  const identity = menuIdentity || (orderItem
    ? {
      identityKey: orderItem.placementGroupId || orderItem.menuItemId || orderItem.productId,
      placementGroupId: orderItem.placementGroupId || null,
      primaryItem: { id: orderItem.menuItemId || orderItem.productId },
      placements: [{ id: orderItem.menuItemId || orderItem.productId }],
    }
    : null);
  const recipe = findRecipeForMenuIdentity(recipes.filter((entry) => entry.active !== false), identity);
  if (!recipe) {
    return { ok: false, code: "NO_ACTIVE_RECIPE", authoritative: false, lines: [], blockers: ["NO_ACTIVE_RECIPE"] };
  }
  return theoreticalConsumptionForSale({
    recipeId: recipe.id,
    linesByRecipeId,
    recipesById,
    versionsByRecipeId,
    businessDate,
    soldQuantity,
  });
}

export function computeLineCost(line, costByIngredientId = {}) {
  if (line.subRecipeId || line.sub_recipe_id) {
    return { kind: "sub_recipe", amount: null, status: "nested" };
  }
  const cost = costByIngredientId[line.ingredientId];
  if (!cost || cost.amount == null || cost.amount === "") {
    return { kind: "ingredient", amount: null, status: "MISSING_COST", ingredientId: line.ingredientId, name: line.name || null };
  }
  const converted = convertOrBlock(line.quantity, line.unit, cost.unit || line.unit);
  if (!converted.ok) {
    return {
      kind: "ingredient",
      amount: null,
      status: converted.code,
      ingredientId: line.ingredientId,
      name: line.name || null,
    };
  }
  const amount = Number(multiplyDecimal(String(converted.quantity), String(cost.amount)));
  if (!Number.isFinite(amount)) {
    return { kind: "ingredient", amount: null, status: "MISSING_COST", ingredientId: line.ingredientId, name: line.name || null };
  }
  return { kind: "ingredient", amount, status: "COSTED", ingredientId: line.ingredientId, name: line.name || null };
}

export function classifyRecipeCosting({
  lines = [],
  costByIngredientId = {},
  nestedCostByRecipeId = {},
} = {}) {
  const usable = lines.filter((line) => line.ingredientId || line.subRecipeId || line.sub_recipe_id);
  if (!usable.length) {
    return { state: COSTING_STATES.UNCOSTED, total: null, knownSubtotal: null, coveragePct: 0, missing: ["NO_LINES"], foodCostPct: null };
  }
  let total = 0;
  let costed = 0;
  const missing = [];
  for (const line of usable) {
    const childId = line.subRecipeId || line.sub_recipe_id;
    if (childId) {
      const nested = nestedCostByRecipeId[childId];
      if (!nested || nested.state !== COSTING_STATES.FULLY_COSTED) {
        missing.push({ code: "INCOMPLETE_SUBRECIPE", subRecipeId: childId });
        continue;
      }
      const scale = Number(line.quantity || 1);
      total += Number(nested.total) * scale;
      costed += 1;
      continue;
    }
    const priced = computeLineCost(line, costByIngredientId);
    if (priced.status !== "COSTED") {
      missing.push(priced);
      continue;
    }
    total += priced.amount;
    costed += 1;
  }
  const coveragePct = Math.round((costed / usable.length) * 100);
  const knownSubtotal = costed > 0 ? total : null;
  if (costed === 0) {
    return { state: COSTING_STATES.UNCOSTED, total: null, knownSubtotal: null, coveragePct, missing, foodCostPct: null };
  }
  if (missing.length) {
    return { state: COSTING_STATES.PARTIALLY_COSTED, total: null, knownSubtotal, coveragePct, missing, foodCostPct: null };
  }
  return { state: COSTING_STATES.FULLY_COSTED, total, knownSubtotal: total, coveragePct: 100, missing: [], foodCostPct: null };
}

export function withFoodCostPct(costing, sellingPrice) {
  const price = Number(String(sellingPrice || "").replace(/[^\d.]/g, ""));
  if (costing.state !== COSTING_STATES.FULLY_COSTED || !Number.isFinite(price) || price <= 0) {
    return { ...costing, foodCostPct: null };
  }
  return {
    ...costing,
    foodCostPct: Number(multiplyDecimal(divideDecimal(String(costing.total), String(price)), "100")),
  };
}

export function recipeCostDelta(previous, next) {
  if (previous == null || next == null || !Number.isFinite(Number(previous)) || !Number.isFinite(Number(next))) {
    return { previous, next, difference: null };
  }
  return {
    previous: Number(previous),
    next: Number(next),
    difference: Number(subtractDecimal(String(next), String(previous))),
  };
}
