import { normalizeFoodicsName } from "../utils/foodicsNameNormalize";

function tokenSimilarity(a, b) {
  const ta = new Set(
    normalizeFoodicsName(a)
      .split(" ")
      .filter((t) => t.length > 1),
  );
  const tb = new Set(
    normalizeFoodicsName(b)
      .split(" ")
      .filter((t) => t.length > 1),
  );
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => {
    if (tb.has(t)) inter += 1;
  });
  return inter / Math.max(ta.size, tb.size);
}

function rowLabel(row) {
  return (row.matched_menu_item_name || row.raw_item_name || "").trim();
}

function isModifierRow(row) {
  return (
    row.is_modifier === true ||
    row.track_as_modifier === true ||
    row.import_status === "paid_modifier" ||
    ["modifier", "sauce_condiment", "addon"].includes(row.semantic_class) ||
    ["modifier", "sauce_condiment", "addon"].includes(row.foodics_class)
  );
}

function indexFoodicsSales(salesItems = []) {
  const map = new Map();
  (salesItems || [])
    .filter((r) => !isModifierRow(r))
    .forEach((r) => {
      const key = normalizeFoodicsName(rowLabel(r));
      if (!key) return;
      map.set(key, (map.get(key) || 0) + (Number(r.quantity_sold) || 0));
    });
  return map;
}

function lookupFoodicsQty(itemName, index) {
  const norm = normalizeFoodicsName(itemName);
  if (!norm) return null;
  if (index.has(norm)) return index.get(norm);

  let best = null;
  let bestScore = 0;
  index.forEach((qty, key) => {
    const score = tokenSimilarity(norm, key);
    if (score >= 0.72 && score > bestScore) {
      bestScore = score;
      best = qty;
    }
  });
  return best;
}

/**
 * Menu visibility export rows — never claim 0 Foodics orders when sales exist.
 */
export function buildMenuVisibilitySignals({
  funnels = [],
  salesItems = [],
  menuEngineering = [],
}) {
  const foodicsIndex = indexFoodicsSales(salesItems);
  const rows = (funnels || []).map((f) => {
    const menuViews = Number(f.item_opens || f.item_impressions || 0);
    const menuOrders = Number(f.orders || 0);
    const foodicsQty = lookupFoodicsQty(f.item_name, foodicsIndex);
    const foodicsMatched = foodicsQty != null && foodicsQty > 0;
    return {
      item_name: f.item_name,
      menuViews,
      menuOrders,
      foodicsQty: foodicsQty ?? null,
      foodicsMatched,
      showZeroMenuOrders: menuOrders === 0 && !foodicsMatched,
    };
  });

  let mismatches = 0;
  let checked = 0;
  (menuEngineering || []).forEach((m) => {
    const fq = lookupFoodicsQty(m.item_name, foodicsIndex);
    if (fq == null) return;
    checked += 1;
    if ((m.orders || 0) === 0 && fq > 0) mismatches += 1;
  });

  const orderMatchingConfidence =
    checked === 0 ? "low" : mismatches / checked >= 0.25 ? "low" : "medium";

  return {
    rows: rows.sort((a, b) => b.menuViews - a.menuViews),
    orderMatchingConfidence,
    hideMenuEngineeringQuadrant: orderMatchingConfidence === "low",
    disclaimer:
      "Menu views are tracked separately from Foodics sales. Product-level sales matching requires validated SKU/name mapping.",
  };
}
