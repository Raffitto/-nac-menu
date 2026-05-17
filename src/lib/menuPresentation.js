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

/** English breakfast card icon — must match public/menu-icons/breakfast.jpeg */
export const BREAKFAST_ICON_EN = "/menu-icons/breakfast.jpeg";
export const BREAKFAST_ICON_AR = "/menu-icons-ar/Breakfast.png";

const MENU_TAB_HOSTS = new Set(["evening", "daytime", "breakfast", "brunch"]);

const MENU_TAB_SOURCES = {
  evening: ["evening", "desserts", "drinks"],
  daytime: ["daytime", "desserts", "drinks"],
  breakfast: ["breakfast", "drinks"],
  brunch: ["brunch", "drinks"],
};

const MENU_TAB_LABELS = {
  evening: {
    evening: { en: "Dinner", ar: "العشاء" },
    desserts: { en: "Desserts", ar: "حلى" },
    drinks: { en: "Drinks", ar: "مشروبات" },
  },
  daytime: {
    daytime: { en: "Daytime", ar: "النهار" },
    desserts: { en: "Desserts", ar: "حلى" },
    drinks: { en: "Drinks", ar: "مشروبات" },
  },
  breakfast: {
    breakfast: { en: "Breakfast", ar: "الفطور" },
    drinks: { en: "Drinks", ar: "مشروبات" },
  },
  brunch: {
    brunch: { en: "Brunch", ar: "برانش" },
    drinks: { en: "Drinks", ar: "مشروبات" },
  },
};

const CATEGORY_ICON_OVERRIDES = {
  breakfast: {
    icon: BREAKFAST_ICON_EN,
    iconAr: BREAKFAST_ICON_AR,
  },
};

export function hasMenuLevelTabs(hostCategoryId) {
  return MENU_TAB_HOSTS.has(hostCategoryId);
}

/** Top-level menu tabs (Dinner | Desserts | Drinks, etc.) for a host category. */
export function getMenuLevelTabs(hostCategoryId, isArabic) {
  const sources = MENU_TAB_SOURCES[hostCategoryId];
  if (!sources) return [];
  const labels = MENU_TAB_LABELS[hostCategoryId] || {};
  return sources.map((sourceCategoryId) => ({
    id: sourceCategoryId,
    sourceCategoryId,
    label: isArabic
      ? labels[sourceCategoryId]?.ar || sourceCategoryId
      : labels[sourceCategoryId]?.en || sourceCategoryId,
  }));
}

/** Sections for the selected menu tab (raw catalog — no merged append). */
export function getMenuTabSections(sourceCategoryId, menuData) {
  return menuData?.[sourceCategoryId] || [];
}

export function isDrinksCatalog(sourceCategoryId) {
  return sourceCategoryId === "drinks";
}

/** Resolve English section title for an item across all catalogs. */
export function findSectionTitleEnForItem(categoryId, menuItem, menuData) {
  if (!menuItem || !menuData) return "";
  const catalogs = categoryId && menuData[categoryId]
    ? [categoryId, "evening", "daytime", "breakfast", "brunch", "desserts", "drinks"]
    : Object.keys(menuData);
  const seen = new Set();
  for (const catId of catalogs) {
    if (seen.has(catId)) continue;
    seen.add(catId);
    for (const sec of menuData[catId] || []) {
      if (sec.items?.some((i) => i.en === menuItem.en && i.image === menuItem.image)) {
        return sec.title?.en || "";
      }
    }
  }
  return "";
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
  if (category.id === "breakfast") {
    return isArabic ? BREAKFAST_ICON_AR : BREAKFAST_ICON_EN;
  }
  return isArabic ? normalized.iconAr || "" : normalized.icon || "";
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
