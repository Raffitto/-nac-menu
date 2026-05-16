/** Canonical dessert order: Cookies first, Affogato last (cheapest/lightest). */
const DESSERT_ORDER = [
  "Crushed Milk Chocolate Cookies",
  "Churros, Burnt Milk",
  "Speculoos French Toast",
  "Strawberry Pistachio Pavlova",
  "Ricotta Pancakes",
  "Affogato",
];

const DESSERT_ORDER_RANK = Object.fromEntries(
  DESSERT_ORDER.map((name, index) => [name, index]),
);

const SERVICE_MENUS = new Set(["breakfast", "brunch", "daytime", "evening"]);

export function sortDessertItems(items) {
  if (!items?.length) return items;
  return [...items].sort(
    (a, b) =>
      (DESSERT_ORDER_RANK[a.en] ?? 50) - (DESSERT_ORDER_RANK[b.en] ?? 50),
  );
}

function sectionHasDessertCatalog(items) {
  return items?.some((i) => DESSERT_ORDER_RANK[i.en] !== undefined);
}

/** Apply dessert ordering everywhere dessert catalog items appear. */
export function applyMenuOrdering(menuData) {
  if (!menuData) return menuData;

  const next = {};
  for (const [catId, sections] of Object.entries(menuData)) {
    next[catId] = (sections || []).map((sec) => {
      if (!sectionHasDessertCatalog(sec.items)) return sec;
      return { ...sec, items: sortDessertItems(sec.items) };
    });
  }
  return next;
}

/** Which menu categories feed an All Menus preview card. */
export function getMenuPreviewCategoryIds(categoryId) {
  if (categoryId === "drinks") return ["drinks"];
  if (categoryId === "desserts") return ["desserts"];
  if (SERVICE_MENUS.has(categoryId)) {
    return [categoryId, "drinks", "desserts"];
  }
  return [categoryId];
}

function collectItemsFromCategories(menuData, categoryIds) {
  const items = [];
  for (const catId of categoryIds) {
    for (const sec of menuData[catId] || []) {
      for (const menuItem of sec.items || []) {
        if (menuItem?.image?.trim()) {
          items.push(menuItem);
        }
      }
    }
  }
  return items;
}

/**
 * Preview items for All Menus category cards only.
 * Service menus: primary + drinks + desserts. Drinks/desserts: own catalog only.
 */
export function getMenuPreviewItems(categoryId, menuData, limit = 3) {
  const ids = getMenuPreviewCategoryIds(categoryId);
  const raw = collectItemsFromCategories(menuData, ids);

  const seen = new Set();
  const unique = [];
  for (const menuItem of raw) {
    const key = menuItem.image;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(menuItem);
    if (unique.length >= limit) break;
  }

  if (categoryId === "desserts") {
    return sortDessertItems(unique).slice(0, limit);
  }

  if (categoryId === "drinks") {
    const preferred =
      unique.find((i) => i.en === "Coca Cola") ||
      unique.find((i) => /Espresso|Classic Mojito|Latte/i.test(i.en)) ||
      unique[0];
    return preferred ? [preferred, ...unique.filter((i) => i !== preferred)].slice(0, limit) : unique;
  }

  return unique.slice(0, limit);
}

export function getCategoryFallbackIcon(cat, isArabic) {
  return (isArabic && cat.iconAr) || cat.icon || "";
}
