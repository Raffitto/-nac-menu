import { normalizeFoodicsName } from "./foodicsNameNormalize";

/**
 * Built-in Foodics → NAC menu aliases (exact normalized key).
 * User-confirmed mappings from foodics_name_mapping merge on top at runtime.
 */
export const BUILTIN_FOODICS_ALIASES = {
  aubergine: "Eggplant",
  "kale s": "Kale & Cabbage",
  "kale b": "Kale & Cabbage",
  "quinoa s": "Quinoa",
  "paprika prawn": "Smoked Paprika Prawn",
  "mac cheese": "Truffled Mac & Cheese",
  "mac & cheese": "Truffled Mac & Cheese",
  rigatoni: "Rigatoni Pink Sauce",
  burrata: "Crushed Burrata",
  "french toast": "Speculoos French Toast",
  cookies: "Crushed Milk Chocolate Cookies",
  "granola yoghurt": "Greek Yogurt",
  "granola yogurt": "Greek Yogurt",
  "egg bun": "Scrambled Eggs",
  "passionfruit lemonade": "Passion Fruit Lemonade",
  "passion fruit lemonade": "Passion Fruit Lemonade",
  "passionfruit mojito": "Passion Fruit Mojito",
  "passion fruit mojito": "Passion Fruit Mojito",
  "sparkling water-sm": "Small Sparkling Water",
  "sparkling water sm": "Small Sparkling Water",
  "orange juice": "Orange",
  "carrot, apple, ginger": "Carrot, Apple & Ginger",
  "carrot apple ginger": "Carrot, Apple & Ginger",
  "beetroot, apple, celery": "Apple, Beetroot & Celery",
  "beetroot apple celery": "Apple, Beetroot & Celery",
  "black angus steak au poivre": "Black Angus Steak Au Poivre",
  "pavlova pistachio & raspberry": "Strawberry Pistachio Pavlova",
  "pavlova pistachio and raspberry": "Strawberry Pistachio Pavlova",
  "panier de viennoiserie": "Daily Pastries Basket",
  "sparkling water": "Large Sparkling Water",
};

/** Short codes needing disambiguation */
export const AMBIGUOUS_ALIAS_KEYS = {
  "quinoa s": ["Quinoa"],
  "kale s": ["Kale & Cabbage"],
  "kale b": ["Kale & Cabbage"],
};

/**
 * @param {Array} manualMaps rows from foodics_name_mapping
 * @returns {Map<string, { menu_item_name_en: string, confidence: number, source: string }>}
 */
export function buildAliasLookup(manualMaps = []) {
  const lookup = new Map();

  for (const [key, target] of Object.entries(BUILTIN_FOODICS_ALIASES)) {
    const norm = normalizeFoodicsName(key);
    if (norm) {
      lookup.set(norm, {
        menu_item_name_en: target,
        confidence: 0.96,
        source: "builtin_alias",
      });
    }
  }

  for (const m of manualMaps || []) {
    const norm = normalizeFoodicsName(m.normalized_key || m.normalized_name || m.raw_name);
    if (!norm || !m.menu_item_name_en) continue;
    const conf = Number(m.match_confidence ?? m.confidence) || 1;
    const existing = lookup.get(norm);
    if (!existing || conf >= existing.confidence) {
      lookup.set(norm, {
        menu_item_name_en: m.menu_item_name_en,
        confidence: Math.max(conf, 0.9),
        source: m.match_source || "memory",
      });
    }
  }

  return lookup;
}

export function resolveAliasFromLookup(normalizedKey, lookup) {
  if (!normalizedKey || !lookup) return null;
  return lookup.get(normalizedKey) || null;
}

export function resolveAmbiguousAlias(normalizedKey) {
  const candidates = AMBIGUOUS_ALIAS_KEYS[normalizedKey];
  if (!candidates?.length) return null;
  return { target: candidates[0], ambiguous: true, candidates };
}
