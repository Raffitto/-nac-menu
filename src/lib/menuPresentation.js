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

/** Original NAC brand assets for All Menus selector cards only. */
export const BRAND_CATEGORY_IMAGES = {
  evening: "/evening.png",
  drinks: "/drinks.png",
  desserts: "/desserts.png",
  breakfast: "/breakfast.png",
  brunch: "/brunch.png",
  daytime: "/daytime.png",
};

export function getBrandCategoryImage(categoryId) {
  return BRAND_CATEGORY_IMAGES[categoryId] || "";
}

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
