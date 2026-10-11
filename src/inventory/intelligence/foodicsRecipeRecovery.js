import edgesFile from "./data/foodicsRecipeEdges.json";
import productsFile from "./data/foodicsProductIndex.json";

export const FOODICS_PRODUCT_INDEX_AS_OF = productsFile.asOf;
export const FOODICS_RECIPE_EXPORT_AS_OF = edgesFile.asOf;

function norm(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

const productsById = new Map(productsFile.products.map((row) => [row.id, row]));
const edgesByParent = new Map();
for (const edge of edgesFile.edges) {
  const list = edgesByParent.get(edge.parentSku) || [];
  list.push(edge);
  edgesByParent.set(edge.parentSku, list);
}

export function foodicsSkuForProductId(productId) {
  const hit = productsById.get(productId);
  if (!hit?.sku) return null;
  return {
    sku: hit.sku,
    name: hit.name,
    sourceClass: "SOURCE_LINKED",
    verification: "UNVERIFIED",
    asOf: productsFile.asOf,
  };
}

export function classifyRecipeEdges(parentSku) {
  const edges = edgesByParent.get(parentSku) || [];
  const usable = [];
  const incomplete = [];
  const conflicts = [];
  for (const edge of edges) {
    if (!edge.qty || !edge.unit) {
      incomplete.push({ ...edge, reason: "missing_quantity_or_unit" });
      continue;
    }
    const childParents = edgesByParent.get(edge.childSku) || [];
    if (childParents.length) {
      const names = new Set(childParents.map((row) => norm(row.parentName)));
      if (!names.has(norm(edge.childName))) {
        conflicts.push({ ...edge, reason: "parent_name_disagrees_with_ingredient_name" });
        continue;
      }
    }
    usable.push(edge);
  }
  return { usable, incomplete, conflicts, sourceClass: "SOURCE_LINKED", verification: "UNVERIFIED" };
}

export function recoveredLinksForIngredient(sales, ingredientName) {
  const needle = norm(ingredientName);
  const links = [];
  for (const sale of sales) {
    const identity = foodicsSkuForProductId(sale.foodics_product_id);
    if (!identity) continue;
    const classified = classifyRecipeEdges(identity.sku);
    const hits = classified.usable.filter((edge) => norm(edge.childName).includes(needle));
    if (!hits.length) continue;
    if (hits.length > 1 && new Set(hits.map((edge) => edge.unit)).size > 1) continue;
    const qty = hits.reduce((sum, edge) => sum + Number(edge.qty), 0);
    links.push({
      productId: sale.foodics_product_id,
      outputQuantity: "1",
      canonicalQuantity: String(qty),
      canonicalUnit: hits[0].unit,
      sourceClass: "SOURCE_LINKED",
      verification: "UNVERIFIED",
    });
  }
  return links;
}
