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

export function sortDessertItems(items) {
  if (!items?.length) return items;
  return [...items].sort(
    (a, b) =>
      (DESSERT_ORDER_RANK[a.en] ?? 50) - (DESSERT_ORDER_RANK[b.en] ?? 50),
  );
}

function sectionHasDessertCatalog(items) {
  return items?.some(
    (i) => DESSERT_ORDER_RANK[i.en] !== undefined,
  );
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

function categoryItems(menuData, categoryId) {
  return (menuData[categoryId] || []).flatMap((sec) => sec.items || []).filter((i) => i?.image);
}

/**
 * Category selector icons: Drinks/Desserts use in-category product art only.
 */
export function getCategoryCardIcon(cat, menuData, isArabic) {
  const fallback = (isArabic && cat.iconAr) || cat.icon || "";
  if (cat.id !== "drinks" && cat.id !== "desserts") return fallback;

  const items = categoryItems(menuData, cat.id);
  if (!items.length) return fallback;

  if (cat.id === "drinks") {
    const pick =
      items.find((i) => i.en === "Coca Cola") ||
      items.find((i) => /Espresso|Classic Mojito|Iced Latte/i.test(i.en)) ||
      items[0];
    return pick.image;
  }

  const sorted = sortDessertItems(items);
  return sorted[0]?.image || fallback;
}
