import edgesFile from "./data/foodicsRecipeEdges.json";
import productsFile from "./data/foodicsProductIndex.json";
import { EVIDENCE_SOURCE } from "../truth/ingredientConsumption";

/**
 * Recovered Foodics recipe export (PR #43 fixtures).
 * These edges are EVIDENCE, not recipe lines. They are never used to produce
 * a consumption total until an owner-verified mapping to inventory_recipes exists.
 *
 * Identity rules:
 * - Edges are keyed by (parentSku, parentName). A parent SKU that carries more
 *   than one parent name (e.g. sk-0629 = Truffle Burger + NAC-Frosties Ice Cream)
 *   is CONFLICT: parent_sku_multiple_names, for every edge under it.
 * - A child SKU that is itself a sub-recipe parent with a different name is
 *   CONFLICT: parent_name_disagrees_with_ingredient_name.
 * - A child SKU that is a sold product SKU with a different name (e.g. sk-0657
 *   = "Americano" used as "NAC-Truffle Salad Dressing") is
 *   CONFLICT: child_sku_is_other_product. SKU identity is never used for it.
 * - Blank quantity or unit is INCOMPLETE.
 */

export const FOODICS_PRODUCT_INDEX_AS_OF = productsFile.asOf;
export const FOODICS_RECIPE_EXPORT_AS_OF = edgesFile.asOf;

export { EVIDENCE_SOURCE };

export const RECOVERED_EDGE_CLASS = Object.freeze({
  USABLE_UNVERIFIED: "USABLE_UNVERIFIED",
  INCOMPLETE: "INCOMPLETE",
  CONFLICT: "CONFLICT",
});

export const RECOVERED_CONFLICT_REASON = Object.freeze({
  PARENT_SKU_MULTIPLE_NAMES: "parent_sku_multiple_names",
  CHILD_IS_OTHER_SUB_RECIPE: "parent_name_disagrees_with_ingredient_name",
  CHILD_SKU_IS_OTHER_PRODUCT: "child_sku_is_other_product",
});

function norm(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Build a classifier over an edge list and product index (committed fixtures or SYN- test data). */
export function buildRecoveredEdgeIndex({ edges = [], products = [] } = {}) {
  const productsById = new Map(products.map((row) => [row.id, row]));
  const productNamesBySku = new Map();
  for (const product of products) {
    if (!product.sku) continue;
    if (!productNamesBySku.has(product.sku)) productNamesBySku.set(product.sku, new Set());
    productNamesBySku.get(product.sku).add(norm(product.name));
  }
  const edgesByParent = new Map();
  for (const edge of edges) {
    const list = edgesByParent.get(edge.parentSku) || [];
    list.push(edge);
    edgesByParent.set(edge.parentSku, list);
  }
  const parentNames = (sku) => new Set((edgesByParent.get(sku) || []).map((row) => norm(row.parentName)));

  function classifyEdge(edge) {
    if (parentNames(edge.parentSku).size > 1) {
      return { ...edge, class: RECOVERED_EDGE_CLASS.CONFLICT, reason: RECOVERED_CONFLICT_REASON.PARENT_SKU_MULTIPLE_NAMES };
    }
    if (!edge.qty || !edge.unit) {
      return { ...edge, class: RECOVERED_EDGE_CLASS.INCOMPLETE, reason: "missing_quantity_or_unit" };
    }
    const childAsParent = parentNames(edge.childSku);
    if (childAsParent.size && !childAsParent.has(norm(edge.childName))) {
      return { ...edge, class: RECOVERED_EDGE_CLASS.CONFLICT, reason: RECOVERED_CONFLICT_REASON.CHILD_IS_OTHER_SUB_RECIPE };
    }
    const productNames = productNamesBySku.get(edge.childSku);
    if (productNames && !productNames.has(norm(edge.childName))) {
      return { ...edge, class: RECOVERED_EDGE_CLASS.CONFLICT, reason: RECOVERED_CONFLICT_REASON.CHILD_SKU_IS_OTHER_PRODUCT };
    }
    return { ...edge, class: RECOVERED_EDGE_CLASS.USABLE_UNVERIFIED, reason: null };
  }

  function classifyRecipeEdges(parentSku) {
    const usable = [];
    const incomplete = [];
    const conflicts = [];
    for (const edge of edgesByParent.get(parentSku) || []) {
      const classified = classifyEdge(edge);
      if (classified.class === RECOVERED_EDGE_CLASS.USABLE_UNVERIFIED) usable.push(classified);
      else if (classified.class === RECOVERED_EDGE_CLASS.INCOMPLETE) incomplete.push(classified);
      else conflicts.push(classified);
    }
    const multiName = parentNames(parentSku).size > 1;
    return {
      usable,
      incomplete,
      conflicts,
      parentConflict: multiName ? RECOVERED_CONFLICT_REASON.PARENT_SKU_MULTIPLE_NAMES : null,
      sourceClass: "SOURCE_LINKED",
      verification: "UNVERIFIED",
    };
  }

  function skuForProductId(productId) {
    const hit = productsById.get(productId);
    if (!hit?.sku) return null;
    return {
      sku: hit.sku,
      name: hit.name,
      sourceClass: "SOURCE_LINKED",
      verification: "UNVERIFIED",
    };
  }

  function summarizeFixture() {
    const counts = { edges: edges.length, products: products.length, parentSkus: edgesByParent.size };
    const byClass = {};
    const byReason = {};
    for (const edge of edges) {
      const classified = classifyEdge(edge);
      byClass[classified.class] = (byClass[classified.class] || 0) + 1;
      if (classified.reason) byReason[classified.reason] = (byReason[classified.reason] || 0) + 1;
    }
    return { ...counts, byClass, byReason };
  }

  return { classifyEdge, classifyRecipeEdges, skuForProductId, parentNames, summarizeFixture };
}

const DEFAULT_INDEX = buildRecoveredEdgeIndex({ edges: edgesFile.edges, products: productsFile.products });

export function foodicsSkuForProductId(productId, { index = DEFAULT_INDEX } = {}) {
  const hit = index.skuForProductId(productId);
  return hit ? { ...hit, asOf: FOODICS_PRODUCT_INDEX_AS_OF } : null;
}

export function classifyRecipeEdges(parentSku, { index = DEFAULT_INDEX } = {}) {
  return index.classifyRecipeEdges(parentSku);
}

export function summarizeRecoveredFixture({ index = DEFAULT_INDEX } = {}) {
  return index.summarizeFixture();
}

/**
 * Evidence about one ingredient for sold products, from the recovered export.
 * Returns { links, excluded }:
 * - links: usable-but-unverified edges whose child name matches the ingredient.
 *   They carry source FOODICS_EXPORT_UNVERIFIED and countsTowardTotal=false.
 * - excluded: sold products whose export recipe is CONFLICT or INCOMPLETE in a
 *   way that can hide this ingredient (shared parent SKU, conflicting
 *   sub-recipe, colliding child SKU, or a blank-quantity line naming it).
 */
export function recoveredEvidenceForIngredient(sales = [], ingredientName, { index = DEFAULT_INDEX } = {}) {
  const needle = norm(ingredientName);
  const links = [];
  const excluded = [];
  const seen = new Set();
  for (const sale of sales || []) {
    const productId = sale.foodics_product_id;
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);
    const identity = index.skuForProductId(productId);
    if (!identity) continue;
    const product = sale.raw_item_name || identity.name;
    const classified = index.classifyRecipeEdges(identity.sku);
    if (classified.parentConflict) {
      excluded.push({ productId, product, sku: identity.sku, reason: "conflict", detail: classified.parentConflict });
      continue;
    }
    const hiding = classified.conflicts.find((edge) => (
      edge.reason === RECOVERED_CONFLICT_REASON.CHILD_IS_OTHER_SUB_RECIPE || norm(edge.childName).includes(needle)
    ));
    if (hiding) {
      excluded.push({ productId, product, sku: identity.sku, reason: "conflict", detail: hiding.reason, edge: hiding.childName });
      continue;
    }
    const blank = classified.incomplete.find((edge) => norm(edge.childName).includes(needle));
    if (blank) {
      excluded.push({ productId, product, sku: identity.sku, reason: "incomplete", detail: blank.reason, edge: blank.childName });
      continue;
    }
    for (const edge of classified.usable.filter((row) => norm(row.childName).includes(needle))) {
      links.push({
        productId,
        product,
        sku: identity.sku,
        childName: edge.childName,
        quantityPerUnit: String(edge.qty),
        unit: edge.unit,
        source: EVIDENCE_SOURCE.FOODICS_EXPORT_UNVERIFIED,
        verification: "UNVERIFIED",
        countsTowardTotal: false,
      });
    }
  }
  return { links, excluded };
}

/** Backwards-compatible: unverified evidence links only (never used for totals). */
export function recoveredLinksForIngredient(sales, ingredientName, options = {}) {
  return recoveredEvidenceForIngredient(sales, ingredientName, options).links;
}
