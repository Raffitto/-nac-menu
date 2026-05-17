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

const DRINKS_APPEND_CATEGORIES = new Set(["breakfast", "brunch", "daytime"]);
const EVENING_APPEND_CATEGORIES = new Set(["evening"]);

export const DRINKS_SECTION_TITLE = { en: "Drinks", ar: "مشروبات" };
const DESSERTS_SECTION_TITLE = { en: "Desserts", ar: "حلى" };

const CATEGORY_ICON_OVERRIDES = {
  breakfast: {
    icon: "/menu-icons/breakfast.jpeg",
    iconAr: "/menu-icons-ar/Breakfast.png",
  },
};

function hasSectionTitle(sections, titleEn) {
  const needle = titleEn.trim().toLowerCase();
  return sections.some((s) => s.title?.en?.trim().toLowerCase() === needle);
}

function buildDrinksSection(menuData) {
  const items = (menuData.drinks || []).flatMap((sec) => sec.items || []);
  if (!items.length) return null;
  return {
    title: { en: DRINKS_SECTION_TITLE.en, ar: DRINKS_SECTION_TITLE.ar },
    items,
    displayAsDrinks: true,
    sourceCategoryId: "drinks",
  };
}

function buildDessertsSection(menuData) {
  const items = (menuData.desserts || []).flatMap((sec) => sec.items || []);
  if (!items.length) return null;
  return {
    title: { en: DESSERTS_SECTION_TITLE.en, ar: DESSERTS_SECTION_TITLE.ar },
    items,
    sourceCategoryId: "desserts",
  };
}

/** Sections shown for a category (merged drinks/desserts per category rules). */
export function getDisplaySections(categoryId, menuData) {
  const base = menuData?.[categoryId] || [];
  if (!menuData) return base;

  if (DRINKS_APPEND_CATEGORIES.has(categoryId)) {
    const drinks = buildDrinksSection(menuData);
    if (!drinks || hasSectionTitle(base, DRINKS_SECTION_TITLE.en)) return base;
    return [...base, drinks];
  }

  if (EVENING_APPEND_CATEGORIES.has(categoryId)) {
    let sections = [...base];
    const desserts = buildDessertsSection(menuData);
    if (desserts && !hasSectionTitle(sections, DESSERTS_SECTION_TITLE.en)) {
      sections = [...sections, desserts];
    }
    const drinks = buildDrinksSection(menuData);
    if (drinks && !hasSectionTitle(sections, DRINKS_SECTION_TITLE.en)) {
      sections = [...sections, drinks];
    }
    return sections;
  }

  return base;
}

/** Menu data with merged sections for breakfast, brunch, daytime, and evening. */
export function buildDisplayMenuData(menuData) {
  if (!menuData) return menuData;
  const next = { ...menuData };
  for (const id of DRINKS_APPEND_CATEGORIES) {
    next[id] = getDisplaySections(id, menuData);
  }
  for (const id of EVENING_APPEND_CATEGORIES) {
    next[id] = getDisplaySections(id, menuData);
  }
  return next;
}

/** Normalize category icons (CMS may ship stale breakfast paths). */
export function normalizeCategoryIcons(category) {
  if (!category) return category;
  const override = CATEGORY_ICON_OVERRIDES[category.id];
  if (!override) return category;
  return {
    ...category,
    icon: override.icon,
    iconAr: override.iconAr,
  };
}

/** Category card icon — language-specific only (no cross-language fallback). */
export function resolveCategoryIcon(category, isArabic) {
  if (!category) return "";
  const normalized = normalizeCategoryIcons(category);
  return isArabic ? normalized.iconAr || "" : normalized.icon || "";
}

/** Resolve English section title for an item (uses display sections when merged). */
export function findSectionTitleEnForItem(categoryId, menuItem, menuDataRef) {
  if (!categoryId || !menuItem) return "";
  for (const sec of menuDataRef?.[categoryId] || []) {
    if (sec.items?.some((i) => i.en === menuItem.en && i.image === menuItem.image)) {
      return sec.title?.en || "";
    }
  }
  return "";
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
