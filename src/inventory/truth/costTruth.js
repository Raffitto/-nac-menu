import { addDecimal, compareDecimal, multiplyDecimal } from "../inventoryIntelligence";
import { isVerificationFixture } from "../foodBible";
import { COST_CLASS, COST_METHOD, SOURCE_SYSTEM, theoreticalConsumedQuantity } from "./contracts";

function ingredientName(row) {
  return String(row?.canonicalName || row?.canonical_name || row?.name || "").trim();
}

function hasPurchaseEvidence(state) {
  if (!state) return false;
  return Boolean(state.last_purchase_at || state.lastPurchaseAt || state.last_purchase_price != null || state.lastPurchasePrice != null);
}

export function classifyMissingCost(ingredient, evidence = {}) {
  const name = ingredientName(ingredient);
  if (isVerificationFixture(name) || /INV-OCR|\[temp verify/i.test(name)) {
    return COST_CLASS.OCR_PLACEHOLDER;
  }
  if (ingredient?.active === false) return COST_CLASS.LEGACY_SOURCE;
  if (/sub[-\s]?recipe|derived|structural/i.test(name)) {
    return COST_CLASS.SUB_RECIPE_DERIVED_COST_NOT_CALCULATED;
  }
  if (evidence.uomBlocksCost) return COST_CLASS.UOM_CONVERSION_BLOCKS_COST;
  const state = evidence.costState;
  const history = evidence.costHistory || [];
  const catalogue = evidence.catalogueItems || [];
  if (state && hasPurchaseEvidence(state)) {
    const wac = state.weighted_average_cost ?? state.weightedAverageCost;
    const last = state.last_purchase_price ?? state.lastPurchasePrice;
    if ((wac == null || wac === "") && (last == null || last === "")) {
      return COST_CLASS.LATEST_PURCHASE_PRICE_MISSING;
    }
  }
  if (!state && !history.length) {
    if (catalogue.length) return COST_CLASS.PURCHASE_ITEM_NOT_LINKED;
    if (evidence.suppliersExpected && !(evidence.supplierLinks || []).length) {
      return COST_CLASS.SUPPLIER_MAPPING_MISSING;
    }
    return COST_CLASS.NO_PURCHASE_HISTORY;
  }
  if (history.length && !hasPurchaseEvidence(state)) {
    return COST_CLASS.LATEST_PURCHASE_PRICE_MISSING;
  }
  if (state && !hasPurchaseEvidence(state)) {
    return COST_CLASS.INGREDIENT_COST_NULL;
  }
  return COST_CLASS.UNKNOWN;
}

export function resolveCanonicalCost(ingredient, evidence = {}) {
  const state = evidence.costState;
  const currency = evidence.currency || "SAR";
  const unit = ingredient?.baseInventoryUnit || ingredient?.base_inventory_unit || null;

  if (state && hasPurchaseEvidence(state)) {
    const wac = state.weighted_average_cost ?? state.weightedAverageCost;
    const last = state.last_purchase_price ?? state.lastPurchasePrice;
    const value = wac != null && wac !== "" ? wac : last;
    if (value != null && value !== "") {
      const isZero = compareDecimal(String(value), "0") === 0;
      return {
        value: String(value),
        currency,
        unit,
        source: SOURCE_SYSTEM.COST_STATE,
        effectiveDate: state.last_purchase_at || state.lastPurchaseAt || null,
        costMethod: isZero ? COST_METHOD.VERIFIED_ZERO : COST_METHOD.WEIGHTED_AVERAGE,
        coverageStatus: isZero ? COST_CLASS.VERIFIED_ZERO : COST_CLASS.VALID,
      };
    }
  }

  const latestHistory = (evidence.costHistory || [])[0];
  if (latestHistory) {
    const value = latestHistory.canonical_unit_cost ?? latestHistory.weighted_average_cost ?? latestHistory.canonicalUnitCost;
    if (value != null && value !== "") {
      return {
        value: String(value),
        currency: latestHistory.currency || currency,
        unit: latestHistory.canonical_unit || unit,
        source: SOURCE_SYSTEM.COST_HISTORY,
        effectiveDate: latestHistory.effective_at || latestHistory.purchase_date || null,
        costMethod: latestHistory.costing_method || COST_METHOD.WEIGHTED_AVERAGE,
        coverageStatus: COST_CLASS.VALID,
      };
    }
  }

  return {
    value: null,
    currency,
    unit,
    source: null,
    effectiveDate: null,
    costMethod: COST_METHOD.UNAVAILABLE,
    coverageStatus: classifyMissingCost(ingredient, evidence),
  };
}

export function computeTheoreticalFoodCost(ledgerRows = [], costByIngredientId = {}) {
  let calculated = "0";
  let calculatedCount = 0;
  let uncostedCount = 0;
  let uncostedQuantityRows = 0;
  const uncosted = [];
  for (const row of ledgerRows || []) {
    const cost = costByIngredientId[row.canonicalIngredientId] || row.cost;
    if (!cost || cost.value == null || cost.coverageStatus === COST_CLASS.INGREDIENT_COST_NULL) {
      uncostedCount += 1;
      uncostedQuantityRows += 1;
      uncosted.push(row.canonicalIngredientId);
      continue;
    }
    if (cost.coverageStatus !== COST_CLASS.VALID && cost.coverageStatus !== COST_CLASS.VERIFIED_ZERO) {
      uncostedCount += 1;
      uncosted.push(row.canonicalIngredientId);
      continue;
    }
    const quantity = theoreticalConsumedQuantity(row);
    if (quantity == null) {
      uncostedCount += 1;
      uncosted.push(row.canonicalIngredientId);
      continue;
    }
    calculated = addDecimal(calculated, multiplyDecimal(quantity, cost.value));
    calculatedCount += 1;
  }
  const total = calculatedCount + uncostedCount;
  return {
    calculatedTheoreticalFoodCost: calculatedCount ? calculated : null,
    currency: "SAR",
    costedIngredientCount: calculatedCount,
    uncostedIngredientCount: uncostedCount,
    uncostedIngredientIds: uncosted,
    consumptionCostCoveragePct: total ? calculatedCount / total : null,
    uncostedQuantityRows,
  };
}

export function summarizeCostClasses(resolvedCosts = []) {
  const counts = Object.fromEntries(Object.values(COST_CLASS).map((key) => [key, 0]));
  for (const row of resolvedCosts || []) {
    const key = row.coverageStatus || COST_CLASS.UNKNOWN;
    if (counts[key] == null) counts[COST_CLASS.UNKNOWN] += 1;
    else counts[key] += 1;
  }
  const actionable = counts[COST_CLASS.NO_PURCHASE_HISTORY]
    + counts[COST_CLASS.PURCHASE_ITEM_NOT_LINKED]
    + counts[COST_CLASS.LATEST_PURCHASE_PRICE_MISSING]
    + counts[COST_CLASS.INGREDIENT_COST_NULL]
    + counts[COST_CLASS.SUPPLIER_MAPPING_MISSING]
    + counts[COST_CLASS.UOM_CONVERSION_BLOCKS_COST]
    + counts[COST_CLASS.UNKNOWN];
  const valid = counts[COST_CLASS.VALID] + counts[COST_CLASS.VERIFIED_ZERO];
  const total = resolvedCosts.length;
  return {
    counts,
    actionableMissing: actionable,
    valid,
    ocrPlaceholders: counts[COST_CLASS.OCR_PLACEHOLDER],
    coveragePct: total ? valid / total : null,
  };
}
