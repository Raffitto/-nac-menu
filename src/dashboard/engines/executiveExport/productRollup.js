import { isModifierOrAddonRow } from "../../../platform/engines/reportTruthEngine";
import { FOODICS_CLASS } from "../../utils/foodicsClassifier";

const PROMO_CLASSES = new Set([FOODICS_CLASS.PROMO_CAMPAIGN, "promo_campaign", "promo"]);
const IGNORED_STATUS = new Set(["ignored", "ignored_selection", "ignored_free_modifier"]);

function itemDisplayName(row) {
  return (row.matched_menu_item_name || row.raw_item_name || row.item_name || "Unknown").trim();
}

function itemKey(name) {
  return String(name || "").trim().toLowerCase();
}

export function aggregateProductItemsByName(rows = []) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const name = itemDisplayName(row);
    const key = itemKey(name);
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, {
        item_name: name,
        quantity: 0,
        net_sales: 0,
        matched_menu_item_name: row.matched_menu_item_name || null,
        foodics_class: row.foodics_class || row.semantic_class || null,
        import_status: row.import_status || null,
        track_as_modifier: row.track_as_modifier,
      });
    }
    const agg = map.get(key);
    agg.quantity += Number(row.quantity_sold) || 0;
    agg.net_sales += Number(row.net_sales) || 0;
  });
  return [...map.values()];
}

export function includeInBottomItemsList(row) {
  const qty = Number(row.quantity) || 0;
  if (qty <= 0) return false;
  const cls = String(row.foodics_class || "").toLowerCase();
  if (PROMO_CLASSES.has(cls)) return false;
  if (IGNORED_STATUS.has(row.import_status) && !row.matched_menu_item_name) return false;
  if (cls === FOODICS_CLASS.OPERATIONAL || cls === "operational") return false;
  const mapped = Boolean(row.matched_menu_item_name);
  if (mapped) return true;
  if (isModifierOrAddonRow(row)) return true;
  if ([FOODICS_CLASS.MENU_ITEM, FOODICS_CLASS.DRINK, FOODICS_CLASS.ADDON, "menu_item", "drink", "addon"].includes(cls)) {
    return true;
  }
  if (row.import_status === "matched" || row.import_status === "paid_modifier") return true;
  return false;
}
