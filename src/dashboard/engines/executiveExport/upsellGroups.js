/**
 * Upsell tracking — manual items + operational group modes.
 */

export const UPSELL_GROUP_MODES = [
  {
    id: "sauces",
    label: "Sauces",
    keywords: ["sauce", "mayo", "ketchup", "chocolate", "syrup", "dressing", "dip"],
  },
  {
    id: "modifiers",
    label: "Modifiers",
    match: (item) => Boolean(item.isModifier),
  },
  {
    id: "premium_beverages",
    label: "Premium beverages",
    keywords: ["shot", "milk", "espresso", "oat", "almond", "vanilla", "caramel"],
  },
  {
    id: "desserts",
    label: "Desserts",
    keywords: ["churros", "cake", "dessert", "pancake", "waffle", "cookie", "brownie"],
  },
  {
    id: "addons",
    label: "Add-ons",
    keywords: ["extra", "add", "side", "pita", "bread"],
    match: (item) => item.group === "addon",
  },
];

function labelMatchesKeywords(label, keywords = []) {
  const n = String(label || "").toLowerCase();
  return keywords.some((k) => n.includes(k));
}

/** Resolve catalog labels for selected group ids. */
export function resolveUpsellItemsFromGroups(catalogItems = [], groupIds = []) {
  const selected = new Set(groupIds || []);
  const labels = new Set();

  (catalogItems || []).forEach((item) => {
    for (const mode of UPSELL_GROUP_MODES) {
      if (!selected.has(mode.id)) continue;
      const byKeyword = mode.keywords && labelMatchesKeywords(item.label, mode.keywords);
      const byMatch = mode.match && mode.match(item);
      if (byKeyword || byMatch) labels.add(item.label);
    }
  });

  return [...labels];
}

/** Merge manual picks + group-resolved labels (deduped). */
export function mergeUpsellFocusItems({ manualItems = [], groupIds = [], catalogItems = [] }) {
  const fromGroups = resolveUpsellItemsFromGroups(catalogItems, groupIds);
  const merged = new Set([...(manualItems || []), ...fromGroups]);
  return [...merged];
}

/** Tag catalog items with suggested group for UI. */
export function enrichCatalogWithGroups(catalogItems = []) {
  return (catalogItems || []).map((item) => {
    const groups = UPSELL_GROUP_MODES.filter((mode) => {
      if (mode.match && mode.match(item)) return true;
      return mode.keywords && labelMatchesKeywords(item.label, mode.keywords);
    }).map((g) => g.id);
    return { ...item, upsellGroups: groups };
  });
}
