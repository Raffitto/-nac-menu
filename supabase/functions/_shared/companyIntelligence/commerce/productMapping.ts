/**
 * Map source products onto NAC canonical semantic families.
 * Never infer dessert/food from a product name sounding sweet.
 */

import type { CanonicalSemanticFamily } from "./types.ts";

const MENU_CATEGORY_FAMILY: Record<string, CanonicalSemanticFamily> = {
  evening: "food",
  daytime: "food",
  breakfast: "food",
  brunch: "food",
  desserts: "dessert",
  dessert: "dessert",
  drinks: "other_beverage",
  drink: "other_beverage",
  beverage: "other_beverage",
  coffee: "coffee",
};

const EXPLICIT_ITEM_FAMILY: Record<string, CanonicalSemanticFamily> = {
  affogato: "dessert",
};

const COFFEE_NAME_RE = /\b(espresso|americano|cappuccino|latte|macchiato|flat white|mocha|cortado|piccolo|filter coffee|cold brew|iced latte|spanish latte)\b/i;

export type ProductMapRow = {
  sourceProductId?: string | null;
  sourceName?: string | null;
  canonicalMenuItemId?: string | null;
  nacCategoryId?: string | null;
  explicitFamily?: CanonicalSemanticFamily | null;
};

/**
 * Deterministic mapping order:
 * 1. explicit mapping table family
 * 2. NAC menu category id
 * 3. coffee drink names only when the NAC category is drinks/beverage
 * 4. unclassified
 */
export function mapCanonicalFamily(row: ProductMapRow): CanonicalSemanticFamily {
  if (row.explicitFamily) return row.explicitFamily;
  const cat = String(row.nacCategoryId || "").toLowerCase().trim();
  if (cat && MENU_CATEGORY_FAMILY[cat]) {
    if (MENU_CATEGORY_FAMILY[cat] === "other_beverage" && COFFEE_NAME_RE.test(String(row.sourceName || ""))) {
      return "coffee";
    }
    return MENU_CATEGORY_FAMILY[cat];
  }
  const key = String(row.canonicalMenuItemId || row.sourceName || "").toLowerCase().trim();
  if (key && EXPLICIT_ITEM_FAMILY[key]) return EXPLICIT_ITEM_FAMILY[key];
  return "unclassified";
}

export function familyFromNacCategoryId(categoryId: string | null | undefined): CanonicalSemanticFamily {
  if (!categoryId) return "unclassified";
  return MENU_CATEGORY_FAMILY[String(categoryId).toLowerCase()] || "unclassified";
}

function normName(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function mapFromMenuCatalog(
  sourceProductId: string | null,
  sourceName: string,
  menu: Array<{ id: string; name: string; categoryId: string | null }>,
): ProductMapRow {
  const explicit = EXPLICIT_ITEM_FAMILY[normName(sourceName)];
  if (explicit) {
    return { sourceProductId, sourceName, explicitFamily: explicit };
  }
  const needle = normName(sourceName);
  const hit = menu.find((row) => normName(row.name) === needle);
  if (hit) {
    return {
      sourceProductId,
      sourceName,
      canonicalMenuItemId: hit.id,
      nacCategoryId: hit.categoryId,
    };
  }
  return { sourceProductId, sourceName };
}
