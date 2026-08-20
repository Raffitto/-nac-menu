/**
 * Deterministic procurement identity → Food Bible canonical ingredient costing.
 * Never invents prices. Never silently merges distinct products.
 * Fuzzy token overlap is candidate-only, never auto-truth.
 */

import {
  areUnitsCompatible,
  convertToCanonicalQuantity,
  divideDecimal,
  multiplyDecimal,
  normalizeText,
  normalizeUnit,
  tokenSimilarity,
} from "./inventoryIntelligence";
import { normalizeIngredientKey, singularVariants } from "./foodBibleCanonicalApply";
import { classifyRecipeCosting, expandRecipeToIngredients, resolveRecipeVersionForDate, withFoodCostPct } from "./recipeGraph";

export const MATCH_STATUS = Object.freeze({
  ALREADY_MAPPED: "already_mapped",
  DETERMINISTIC: "deterministic",
  AMBIGUOUS: "ambiguous",
  UNRESOLVED: "unresolved",
  EXCLUDED: "excluded",
});

const DISTINCT_PAIRS = [
  [/\btomato paste\b|\btomato puree\b/, /\btomato(es)?\b/],
  [/\bdouble cream\b/, /\b(?!double )(whipping |single |cooking )?cream\b/],
  [/\bsour cream\b/, /\b(double |whipping )?cream\b/],
  [/\bcoconut milk\b/, /\bcoconut powder\b|\bcoconut cream\b/],
  [/\bminced beef\b|\bground beef\b/, /\bbeef (fillet|tenderloin|sirloin|ribeye|steak)\b/],
  [/\bunsalted butter\b|\bbutter unsalted\b/, /\bsalted butter\b/],
  [/\bextra virgin olive oil\b/, /\bolive oil\b/],
  [/\bsea salt\b|\bmaldon salt\b/, /\btable salt\b/],
];

export function isExcludedProcurementName(name) {
  return /verification|temp verify|automated production verification|inv-ocr-verify/i.test(String(name || ""));
}

export function namesAreDistinctProducts(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b || a === b) return false;
  for (const [one, two] of DISTINCT_PAIRS) {
    if ((one.test(a) && two.test(b) && !one.test(b)) || (one.test(b) && two.test(a) && !one.test(a))) {
      return true;
    }
  }
  const prawnA = a.match(/prawn|shrimp/);
  const prawnB = b.match(/prawn|shrimp/);
  if (prawnA && prawnB) {
    const specA = a.match(/\d+\s*\d+/)?.[0];
    const specB = b.match(/\d+\s*\d+/)?.[0];
    if (specA && specB && specA !== specB) return true;
  }
  return false;
}

export function canonicalLookupKeys(ingredient) {
  const keys = new Set();
  const push = (value) => {
    for (const variant of singularVariants(normalizeIngredientKey(value))) {
      if (variant) keys.add(variant);
    }
  };
  push(ingredient.canonicalName || ingredient.canonical_name);
  push(ingredient.normalizedSearchName || ingredient.normalized_search_name);
  String(ingredient.description || "")
    .replace(/^food bible aliases:\s*/i, "")
    .split("|")
    .forEach((token) => push(token));
  return [...keys];
}

export function normalizePurchaseToCanonicalUnitCost({
  unitCostCanonical = null,
  canonicalUnit = null,
  unitPrice = null,
  purchaseQuantity = null,
  purchaseUnit = null,
  packQuantity = null,
  packSize = null,
  packUnit = null,
  conversionFactor = null,
  targetUnit = null,
} = {}) {
  const target = targetUnit ? normalizeUnit(targetUnit) : (canonicalUnit ? normalizeUnit(canonicalUnit) : null);
  if (unitCostCanonical != null && Number(unitCostCanonical) > 0 && canonicalUnit && target && areUnitsCompatible(canonicalUnit, target)) {
    try {
      const one = convertToCanonicalQuantity({
        quantity: "1",
        originalUnit: canonicalUnit,
        packUnit: canonicalUnit,
        canonicalUnit: target,
      });
      const factor = Number(one.canonicalQuantity);
      if (!(factor > 0)) return { ok: false, code: "UNKNOWN_CONVERSION" };
      return {
        ok: true,
        amount: Number(unitCostCanonical) / factor,
        unit: target,
        conversion: "canonical_unit_cost",
      };
    } catch (err) {
      return { ok: false, code: "UNKNOWN_CONVERSION", reason: err.message };
    }
  }

  const packKnown = packSize != null && Number(packSize) > 0 && packQuantity != null && Number(packQuantity) > 0;
  const factorKnown = conversionFactor != null && Number(conversionFactor) > 0;
  if (!target) return { ok: false, code: "MISSING_TARGET_UNIT" };
  if ((/case|carton|box|pack|bottle/i.test(String(purchaseUnit || packUnit || ""))) && !packKnown && !factorKnown) {
    return { ok: false, code: "UNKNOWN_PACK_SIZE", reason: "Pack/case price cannot be normalized without pack size" };
  }
  if (unitPrice == null || Number(unitPrice) <= 0) {
    return { ok: false, code: "MISSING_PRICE" };
  }
  const qty = purchaseQuantity != null && Number(purchaseQuantity) > 0 ? Number(purchaseQuantity) : 1;
  try {
    const converted = convertToCanonicalQuantity({
      quantity: String(qty),
      originalUnit: purchaseUnit || packUnit || target,
      packQuantity: packKnown ? String(packQuantity) : "1",
      packSize: packKnown ? String(packSize) : "1",
      packUnit: packUnit || purchaseUnit || target,
      canonicalUnit: target,
      verifiedConversionFactor: factorKnown ? String(conversionFactor) : null,
    });
    const usable = Number(converted.canonicalQuantity);
    if (!(usable > 0)) return { ok: false, code: "UNKNOWN_PACK_SIZE" };
    const lineTotal = Number(multiplyDecimal(String(unitPrice), String(qty)));
    return {
      ok: true,
      amount: Number(divideDecimal(String(lineTotal), String(usable))),
      unit: target,
      conversion: converted.source,
      usableQuantity: usable,
    };
  } catch (err) {
    return { ok: false, code: "UNKNOWN_CONVERSION", reason: err.message };
  }
}

export function resolveEffectiveCost({
  ingredientId,
  asOf = null,
  historyRows = [],
  mappedIngredientIds = [],
} = {}) {
  const ids = new Set([ingredientId, ...mappedIngredientIds].filter(Boolean));
  const asOfMs = asOf ? new Date(asOf).getTime() : Date.now();
  const eligible = (historyRows || [])
    .filter((row) => ids.has(row.ingredient_id || row.ingredientId))
    .filter((row) => {
      const amount = Number(row.weighted_average_cost ?? row.canonical_unit_cost ?? row.canonicalUnitCost ?? 0);
      return amount > 0;
    })
    .filter((row) => {
      const at = new Date(row.effective_at || row.effectiveAt || row.purchase_date || 0).getTime();
      return Number.isFinite(at) && at <= asOfMs;
    })
    .sort((a, b) => {
      const at = new Date(b.effective_at || b.effectiveAt || 0).getTime() - new Date(a.effective_at || a.effectiveAt || 0).getTime();
      if (at) return at;
      return new Date(b.recorded_at || 0).getTime() - new Date(a.recorded_at || 0).getTime();
    });
  const row = eligible[0];
  if (!row) return null;
  return {
    ingredientId,
    amount: Number(row.weighted_average_cost > 0 ? row.weighted_average_cost : (row.canonical_unit_cost ?? row.canonicalUnitCost)),
    unit: row.canonical_unit || row.canonicalUnit,
    effectiveAt: row.effective_at || row.effectiveAt,
    source: "cost_history",
    method: row.costing_method || "weighted_average",
    supplierId: row.supplier_id || null,
    receiptId: row.receipt_id || null,
    invoiceId: row.invoice_id || null,
  };
}

function buildCanonicalIndex(canonicalIngredients = []) {
  const byId = new Map(canonicalIngredients.map((item) => [item.id, item]));
  const byKey = new Map();
  for (const item of canonicalIngredients) {
    if (isExcludedProcurementName(item.canonicalName || item.canonical_name)) continue;
    for (const key of canonicalLookupKeys(item)) {
      const bucket = byKey.get(key) || [];
      if (!bucket.some((entry) => entry.id === item.id)) bucket.push(item);
      byKey.set(key, bucket);
    }
  }
  return { byId, byKey };
}

export function matchProcurementIdentity({
  identity,
  canonicalIngredients = [],
  existingRelated = [],
} = {}) {
  const names = [
    identity.canonicalName,
    identity.name,
    identity.originalDescription,
    identity.normalizedDescription,
    ...(identity.descriptions || []),
  ].filter(Boolean);
  const procurementId = identity.ingredientId || identity.ingredient_id || identity.id;
  if (names.some((value) => isExcludedProcurementName(value)) || isExcludedProcurementName(identity.notes)) {
    return {
      status: MATCH_STATUS.EXCLUDED,
      reason: "Verification/test procurement identity is not a culinary Food Bible ingredient",
      identity,
      candidates: [],
    };
  }
  const related = (existingRelated || []).find((row) => (
    row.active !== false
    && row.relationship_type === "same_operational_ingredient"
    && (row.related_ingredient_id === procurementId || row.ingredient_id === procurementId)
  ));
  if (related) {
    const canonicalId = related.ingredient_id === procurementId ? related.related_ingredient_id : related.ingredient_id;
    return {
      status: MATCH_STATUS.ALREADY_MAPPED,
      canonicalId,
      reason: "Existing same_operational_ingredient mapping",
      identity,
      candidates: [],
    };
  }

  const { byId, byKey } = buildCanonicalIndex(canonicalIngredients);
  if (procurementId && byId.has(procurementId)) {
    return {
      status: MATCH_STATUS.ALREADY_MAPPED,
      canonicalId: procurementId,
      reason: "Procurement row already uses the canonical ingredient id",
      identity,
      candidates: [],
    };
  }

  const keys = names.flatMap((value) => singularVariants(normalizeIngredientKey(value)));
  const exact = [];
  for (const key of keys) {
    for (const hit of byKey.get(key) || []) {
      if (!exact.some((item) => item.id === hit.id) && names.every((value) => !namesAreDistinctProducts(value, hit.canonicalName || hit.canonical_name))) {
        exact.push(hit);
      }
    }
  }
  if (exact.length === 1) {
    return {
      status: MATCH_STATUS.DETERMINISTIC,
      canonicalId: exact[0].id,
      canonicalName: exact[0].canonicalName || exact[0].canonical_name,
      reason: "Exact normalized name or alias",
      identity,
      candidates: exact,
    };
  }
  if (exact.length > 1) {
    return {
      status: MATCH_STATUS.AMBIGUOUS,
      reason: "Multiple canonical ingredients share this name/alias",
      identity,
      candidates: exact,
    };
  }

  const fuzzy = canonicalIngredients
    .filter((item) => !isExcludedProcurementName(item.canonicalName || item.canonical_name))
    .map((item) => ({
      item,
      score: Math.max(0, ...names.map((value) => tokenSimilarity(value, item.canonicalName || item.canonical_name))),
    }))
    .filter((row) => row.score >= 0.5 && names.every((value) => !namesAreDistinctProducts(value, row.item.canonicalName || row.item.canonical_name)))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  if (fuzzy.length > 1 && fuzzy[0].score < 0.92) {
    return {
      status: MATCH_STATUS.AMBIGUOUS,
      reason: "Procurement description could match more than one culinary ingredient",
      identity,
      candidates: fuzzy.map((row) => row.item),
    };
  }
  return {
    status: MATCH_STATUS.UNRESOLVED,
    reason: exact.length === 0 && !fuzzy.length
      ? "No canonical culinary name/alias match"
      : "Insufficient deterministic evidence",
    identity,
    candidates: fuzzy.map((row) => row.item),
  };
}

export function collectProcurementIdentities({
  history = [],
  receipts = [],
  invoices = [],
  catalogue = [],
  purchaseOrders = [],
  ingredients = [],
} = {}) {
  const byId = new Map();
  const remember = (ingredientId, extras = {}) => {
    if (!ingredientId) return;
    const ingredient = ingredients.find((item) => item.id === ingredientId) || {};
    const current = byId.get(ingredientId) || {
      ingredientId,
      name: ingredient.canonical_name || ingredient.canonicalName || extras.name || null,
      baseUnit: ingredient.base_inventory_unit || ingredient.baseInventoryUnit || extras.unit || null,
      sources: new Set(),
      descriptions: new Set(),
    };
    current.sources.add(extras.source);
    if (extras.name) current.descriptions.add(extras.name);
    if (extras.desc) current.descriptions.add(extras.desc);
    byId.set(ingredientId, current);
  };
  for (const row of history) remember(row.ingredient_id, { source: "cost_history" });
  for (const row of receipts) {
    remember(row.ingredient_id, {
      source: "purchase_receipt",
      desc: row.original_description || row.normalized_description,
    });
  }
  for (const row of invoices) {
    remember(row.ingredient_id, {
      source: "invoice_line",
      desc: row.original_description || row.normalized_description,
    });
  }
  for (const row of catalogue) {
    remember(row.ingredient_id, {
      source: "supplier_catalogue",
      name: row.original_product_name,
    });
  }
  for (const row of purchaseOrders) {
    remember(row.ingredient_id, {
      source: "purchase_order",
      desc: row.notes,
    });
  }
  return [...byId.values()].map((row) => ({
    ...row,
    sources: [...row.sources],
    descriptions: [...row.descriptions],
    originalDescription: [...row.descriptions][0] || row.name,
  }));
}

export function reconcileProcurementToCanonical({
  identities = [],
  canonicalIngredients = [],
  existingRelated = [],
} = {}) {
  const results = identities.map((identity) => matchProcurementIdentity({
    identity,
    canonicalIngredients,
    existingRelated,
  }));
  return {
    total: results.length,
    alreadyMapped: results.filter((row) => row.status === MATCH_STATUS.ALREADY_MAPPED),
    newlyMapped: results.filter((row) => row.status === MATCH_STATUS.DETERMINISTIC),
    unresolved: results.filter((row) => row.status === MATCH_STATUS.UNRESOLVED || row.status === MATCH_STATUS.EXCLUDED),
    review: results.filter((row) => row.status === MATCH_STATUS.AMBIGUOUS).map((row) => ({
      procurementItem: row.identity.name || row.identity.originalDescription,
      supplierSource: (row.identity.sources || []).join(", "),
      candidates: row.candidates.map((item) => item.canonicalName || item.canonical_name),
      reason: row.reason,
      units: row.identity.baseUnit || null,
      pack: row.identity.pack || null,
    })),
    results,
  };
}

export function mappingIdSet(canonicalId, related = []) {
  const ids = new Set([canonicalId]);
  for (const row of related || []) {
    if (row.active === false || row.relationship_type !== "same_operational_ingredient") continue;
    if (row.ingredient_id === canonicalId) ids.add(row.related_ingredient_id);
    if (row.related_ingredient_id === canonicalId) ids.add(row.ingredient_id);
  }
  return [...ids];
}

export function buildCostByCanonicalId({
  canonicalIngredients = [],
  historyRows = [],
  related = [],
  asOf = null,
} = {}) {
  const costByCanonicalId = {};
  for (const item of canonicalIngredients) {
    const resolved = resolveEffectiveCost({
      ingredientId: item.id,
      asOf,
      historyRows,
      mappedIngredientIds: mappingIdSet(item.id, related),
    });
    if (resolved) costByCanonicalId[item.id] = resolved;
  }
  return costByCanonicalId;
}

export function costFoodBibleRecipe({
  recipeId,
  recipesById,
  versionsByRecipeId,
  linesByRecipeId,
  costByIngredientId,
  sellingPrice = null,
  businessDate = null,
} = {}) {
  const expanded = expandRecipeToIngredients({
    recipeId,
    recipesById,
    versionsByRecipeId,
    linesByRecipeId,
    businessDate,
    soldQuantity: 1,
  });
  const costing = classifyRecipeCosting({
    lines: expanded.ingredients,
    costByIngredientId,
  });
  const version = resolveRecipeVersionForDate(versionsByRecipeId?.[recipeId] || [], businessDate)
    || (versionsByRecipeId?.[recipeId] || []).find((entry) => entry.status !== "draft")
    || null;
  const priced = withFoodCostPct(costing, sellingPrice);
  return {
    ...priced,
    versionId: version?.id || expanded.versionId,
    expansionOk: expanded.ok,
    blockers: expanded.blockers || [],
    expandedLines: expanded.ingredients,
  };
}
