/**
 * Map source products onto NAC canonical semantic families.
 * Never infer dessert/food from a product name sounding sweet.
 */

import type { CanonicalSemanticFamily } from "./types.ts";

const MENU_SECTION_FAMILY: Record<string, CanonicalSemanticFamily> = {
  desserts: "dessert",
  dessert: "dessert",
  sweets: "dessert",
  sweet: "dessert",
  coffee: "coffee",
  "iced coffee": "coffee",
  mains: "food",
  plates: "food",
  starters: "food",
  brunch: "food",
  breakfast: "food",
};

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
  nacSectionName?: string | null;
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
  const section = String(row.nacSectionName || "").toLowerCase().trim();
  if (section && MENU_SECTION_FAMILY[section]) return MENU_SECTION_FAMILY[section];
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
  menu: Array<{ id: string; name: string; categoryId: string | null; categorySlug?: string | null; sectionName?: string | null }>,
): ProductMapRow {
  const explicit = EXPLICIT_ITEM_FAMILY[normName(sourceName)];
  if (explicit) {
    return { sourceProductId, sourceName, explicitFamily: explicit };
  }
  const needle = normName(sourceName);
  if (!needle) return { sourceProductId, sourceName };
  const exact = menu.filter((row) => normName(row.name) === needle);
  const loose = exact.length ? exact : menu.filter((row) => {
    const n = normName(row.name);
    return n === needle || n.startsWith(`${needle} `) || n.endsWith(` ${needle}`) || n.includes(` ${needle} `);
  });
  if (!loose.length) return { sourceProductId, sourceName };
  const families = loose.map((hit) => mapCanonicalFamily({
    sourceName,
    canonicalMenuItemId: hit.id,
    nacCategoryId: hit.categorySlug || hit.categoryId,
    nacSectionName: hit.sectionName,
  }));
  const unique = [...new Set(families.filter((f) => f !== "unclassified"))];
  const chosen = unique.length === 1 ? loose[0] : (loose.find((h) => /dessert|sweet/i.test(String(h.sectionName || h.categorySlug || ""))) || loose[0]);
  const slug = chosen.categorySlug || chosen.categoryId;
  return {
    sourceProductId,
    sourceName,
    canonicalMenuItemId: chosen.id,
    nacCategoryId: slug,
    nacSectionName: chosen.sectionName,
    explicitFamily: unique.length === 1 ? unique[0] : mapCanonicalFamily({
      sourceName,
      nacCategoryId: slug,
      nacSectionName: chosen.sectionName,
    }),
  };
}
