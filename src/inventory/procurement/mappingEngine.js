import { rankIngredientMatches } from "../inventoryIntelligence";
import { MAPPING_STATE, canAffectCanonicalCost } from "./contracts";

const AUTO_METHODS = new Set(["exact_supplier_sku", "exact_verified_alias"]);

export function classifySupplierLineMapping({
  line = {},
  catalogueItems = [],
  ingredients = [],
  approvedMappings = [],
} = {}) {
  const sku = line.supplierSku || line.supplier_sku;
  const supplierId = line.supplierId || line.supplier_id;
  const description = line.originalDescription || line.original_description || line.normalizedDescription;

  const approved = approvedMappings.find((row) => (
    (sku && row.supplierSku === sku && row.supplierId === supplierId)
    || (row.normalizedDescription && normalizeLoose(row.normalizedDescription) === normalizeLoose(description)
      && row.supplierId === supplierId && row.state === MAPPING_STATE.APPROVED)
  ));
  if (approved?.ingredientId) {
    return {
      state: MAPPING_STATE.APPROVED,
      ingredientId: approved.ingredientId,
      catalogueItemId: approved.catalogueItemId || null,
      method: "approved_supplier_product",
      confidence: 1,
      canAffectCanonicalCost: true,
      suggestions: [],
    };
  }

  const ranked = rankIngredientMatches(
    { supplierSku: sku, originalDescription: description, normalizedDescription: description },
    catalogueItems,
    ingredients,
  );
  const top = ranked[0];
  const second = ranked[1];

  if (!top) {
    return {
      state: MAPPING_STATE.NEEDS_REVIEW,
      ingredientId: null,
      method: null,
      confidence: 0,
      canAffectCanonicalCost: false,
      suggestions: [],
    };
  }

  if (second && Math.abs((top.confidence || 0) - (second.confidence || 0)) < 0.05 && (top.confidence || 0) < 0.98) {
    return {
      state: MAPPING_STATE.AMBIGUOUS,
      ingredientId: null,
      method: "ambiguous_candidates",
      confidence: top.confidence,
      canAffectCanonicalCost: false,
      suggestions: ranked.slice(0, 3),
    };
  }

  if (AUTO_METHODS.has(top.method) && (top.confidence || 0) >= 0.95) {
    return {
      state: MAPPING_STATE.AUTO_MATCHED,
      ingredientId: top.ingredientId,
      catalogueItemId: top.catalogueItemId || top.supplierCatalogueItemId || null,
      method: top.method,
      confidence: top.confidence,
      canAffectCanonicalCost: true,
      suggestions: ranked.slice(0, 3),
    };
  }

  return {
    state: MAPPING_STATE.SUGGESTED,
    ingredientId: top.ingredientId,
    method: top.method || "fuzzy_suggestion",
    confidence: top.confidence,
    canAffectCanonicalCost: false,
    suggestions: ranked.slice(0, 3),
  };
}

export function mappingMayPost(result) {
  return canAffectCanonicalCost(result?.state) && result.canAffectCanonicalCost === true;
}

function normalizeLoose(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
