import { FOODICS_CLASS } from "./foodicsClassifier";

const MODIFIER_TRACK_CLASSES = new Set([
  FOODICS_CLASS.MODIFIER,
  FOODICS_CLASS.ADDON,
  FOODICS_CLASS.SAUCE_CONDIMENT,
]);

/**
 * Prepare modifier / add-on rows for future attachment-rate analytics.
 * @param {Array} rows matched import rows
 */
export function extractModifierSalesRows(rows) {
  return (rows || [])
    .filter(
      (r) =>
        r.track_as_modifier &&
        (r.import_status === "matched" || r.import_status === "paid_modifier"),
    )
    .map((r) => ({
      raw_item_name: r.raw_item_name,
      normalized_item_name: r.normalized_item_name,
      matched_menu_item_name: r.matched_menu_item_name,
      semantic_class: r.semantic_class || r.foodics_class,
      analytics_category: r.analytics_category,
      quantity_sold: Number(r.quantity_sold) || 0,
      net_sales: Number(r.net_sales) || 0,
    }));
}

export function summarizeModifierIntel(rows) {
  const modifiers = extractModifierSalesRows(rows);
  const byName = {};

  modifiers.forEach((m) => {
    const key = m.matched_menu_item_name || m.normalized_item_name;
    if (!byName[key]) {
      byName[key] = {
        name: key,
        semantic_class: m.semantic_class,
        analytics_category: m.analytics_category,
        quantity: 0,
        net_sales: 0,
        lines: 0,
      };
    }
    byName[key].quantity += m.quantity_sold;
    byName[key].net_sales += m.net_sales;
    byName[key].lines += 1;
  });

  return Object.values(byName).sort((a, b) => b.net_sales - a.net_sales);
}

export function isModifierTrackClass(foodicsClass) {
  return MODIFIER_TRACK_CLASSES.has(foodicsClass);
}
