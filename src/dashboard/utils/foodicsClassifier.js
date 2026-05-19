import { normalizeFoodicsName } from "./foodicsNameNormalize";

/** @typedef {'promo_campaign'|'operational'|'sauce_condiment'|'modifier'|'drink'|'addon'|'menu_item'|'unknown'} FoodicsClass */

export const FOODICS_CLASS = {
  PROMO_CAMPAIGN: "promo_campaign",
  OPERATIONAL: "operational",
  SAUCE_CONDIMENT: "sauce_condiment",
  MODIFIER: "modifier",
  DRINK: "drink",
  ADDON: "addon",
  MENU_ITEM: "menu_item",
  UNKNOWN: "unknown",
};

export const FOODICS_CLASS_LABELS = {
  [FOODICS_CLASS.PROMO_CAMPAIGN]: "Promo / campaign",
  [FOODICS_CLASS.OPERATIONAL]: "Operational",
  [FOODICS_CLASS.SAUCE_CONDIMENT]: "Sauce / condiment",
  [FOODICS_CLASS.MODIFIER]: "Modifier",
  [FOODICS_CLASS.DRINK]: "Drink",
  [FOODICS_CLASS.ADDON]: "Add-on",
  [FOODICS_CLASS.MENU_ITEM]: "Menu item",
  [FOODICS_CLASS.UNKNOWN]: "Unknown",
};

/** Analytics grouping for future beverage / modifier intelligence */
export const ANALYTICS_CATEGORY = {
  BEVERAGE: "beverage",
  MODIFIER: "modifier",
  CONDIMENT: "condiment",
  ADDON: "addon",
  FOOD: "food",
  PROMO: "promo",
};

const PROMO_EXACT = new Set(
  [
    "love your main course",
    "love your desserts",
    "love your drinks",
    "all together",
    "whatever is done",
  ].map(normalizeFoodicsName),
);

const PROMO_PREFIXES = ["love your ", "sales by product"];

const META_EXACT = new Set(
  ["title", "date range", "product", "value"].map(normalizeFoodicsName),
);

/** True operational / prep ingredients (not modifiers sold as extras) */
const OPERATIONAL_EXACT = new Set(
  [
    "cranberry",
    "olive oil",
    "chilli flakes",
    "chili flakes",
    "mushrooms",
    "asparagus",
    "fries",
    "water",
    "milk",
  ].map(normalizeFoodicsName),
);

const MODIFIER_EXACT = new Set(
  [
    "honey",
    "parmesan",
    "extra shot",
    "maple syrup",
    "dulce de leche",
    "fresh milk",
    "syrup",
  ].map(normalizeFoodicsName),
);

const SAUCE_EXACT = new Set(
  [
    "chocolate sauce",
    "truffle mayo",
    "sriracha sauce",
    "regular ketchup",
    "regular mayo",
  ].map(normalizeFoodicsName),
);

const ADDON_EXACT = new Set(["pita bread", "pita"].map(normalizeFoodicsName));

/** Drink bar ingredients (not whole menu dishes) */
const BEVERAGE_INGREDIENT_EXACT = new Set(
  ["apple", "cucumber", "spinach"].map(normalizeFoodicsName),
);

const MODIFIER_KEYWORDS = ["extra shot", "shot", "syrup", "dulce", "leche", "parmesan", "honey"];

const SAUCE_KEYWORDS = [
  "sauce",
  "mayo",
  "ketchup",
  "flakes",
  "dressing",
  "dip",
  "condiment",
  "vinegar",
  "jam",
];

const BEVERAGE_KEYWORDS = [
  "coffee",
  "latte",
  "cappuccino",
  "espresso",
  "mocha",
  "tea",
  "juice",
  "lemonade",
  "mojito",
  "water",
  "cola",
  "soda",
  "shake",
  "smoothie",
  "drink",
  "cocktail",
  "mocktail",
  "americano",
  "macchiato",
  "frapp",
  "iced",
];

const ADDON_HINTS = ["add on", "addon", "extra", "side", "topping", "modifier", "pita"];

function tokenCount(n) {
  return n.split(" ").filter(Boolean).length;
}

function resolveAnalyticsCategory(foodicsClass, n, cat) {
  if (foodicsClass === FOODICS_CLASS.PROMO_CAMPAIGN) return ANALYTICS_CATEGORY.PROMO;
  if (foodicsClass === FOODICS_CLASS.DRINK || BEVERAGE_INGREDIENT_EXACT.has(n)) {
    return ANALYTICS_CATEGORY.BEVERAGE;
  }
  if (foodicsClass === FOODICS_CLASS.MODIFIER) return ANALYTICS_CATEGORY.MODIFIER;
  if (foodicsClass === FOODICS_CLASS.SAUCE_CONDIMENT) return ANALYTICS_CATEGORY.CONDIMENT;
  if (foodicsClass === FOODICS_CLASS.ADDON) return ANALYTICS_CATEGORY.ADDON;
  if (cat && BEVERAGE_KEYWORDS.some((k) => cat.includes(k))) return ANALYTICS_CATEGORY.BEVERAGE;
  return ANALYTICS_CATEGORY.FOOD;
}

function buildResult(partial) {
  const track_as_modifier = [FOODICS_CLASS.MODIFIER, FOODICS_CLASS.ADDON, FOODICS_CLASS.SAUCE_CONDIMENT].includes(
    partial.class,
  );
  const analytics_category = resolveAnalyticsCategory(partial.class, partial._n || "", partial._cat || "");
  const inherited_category = partial.inherited_category ?? analytics_category;

  return {
    class: partial.class,
    label: partial.label || FOODICS_CLASS_LABELS[partial.class],
    autoIgnore: partial.autoIgnore ?? false,
    strictMatch: partial.strictMatch ?? false,
    reason: partial.reason,
    track_as_modifier,
    analytics_category,
    inherited_category,
    semantic_class: partial.class,
  };
}

/**
 * Classify a Foodics product row before matching.
 */
export function classifyFoodicsRow(rawName, category = null) {
  const raw = String(rawName || "").trim();
  const n = normalizeFoodicsName(raw);
  const cat = normalizeFoodicsName(category || "");

  if (!n) {
    return buildResult({
      class: FOODICS_CLASS.UNKNOWN,
      label: FOODICS_CLASS_LABELS[FOODICS_CLASS.UNKNOWN],
      autoIgnore: true,
      strictMatch: true,
      reason: "empty",
      _n: n,
      _cat: cat,
    });
  }

  if (/^\*+$/.test(raw.replace(/\s/g, ""))) {
    return buildResult({
      class: FOODICS_CLASS.UNKNOWN,
      autoIgnore: true,
      strictMatch: true,
      reason: "placeholder",
      _n: n,
      _cat: cat,
    });
  }

  if (META_EXACT.has(n) || n.startsWith("sales by product")) {
    return buildResult({
      class: FOODICS_CLASS.UNKNOWN,
      label: "Report meta",
      autoIgnore: true,
      strictMatch: true,
      reason: "meta_row",
      _n: n,
      _cat: cat,
    });
  }

  if (PROMO_EXACT.has(n) || PROMO_PREFIXES.some((p) => n.startsWith(p))) {
    return buildResult({
      class: FOODICS_CLASS.PROMO_CAMPAIGN,
      autoIgnore: true,
      strictMatch: true,
      reason: "promo_campaign",
      _n: n,
      _cat: cat,
    });
  }

  if (MODIFIER_EXACT.has(n) || MODIFIER_KEYWORDS.some((k) => n === k || n.endsWith(` ${k}`))) {
    return buildResult({
      class: FOODICS_CLASS.MODIFIER,
      autoIgnore: false,
      strictMatch: true,
      reason: "modifier_exact",
      _n: n,
      _cat: cat,
    });
  }

  if (SAUCE_EXACT.has(n)) {
    return buildResult({
      class: FOODICS_CLASS.SAUCE_CONDIMENT,
      autoIgnore: false,
      strictMatch: true,
      reason: "sauce_exact",
      _n: n,
      _cat: cat,
    });
  }

  if (ADDON_EXACT.has(n)) {
    return buildResult({
      class: FOODICS_CLASS.ADDON,
      autoIgnore: false,
      strictMatch: true,
      reason: "addon_exact",
      _n: n,
      _cat: cat,
    });
  }

  if (BEVERAGE_INGREDIENT_EXACT.has(n)) {
    return buildResult({
      class: FOODICS_CLASS.DRINK,
      autoIgnore: false,
      strictMatch: true,
      reason: "beverage_ingredient",
      inherited_category: ANALYTICS_CATEGORY.BEVERAGE,
      _n: n,
      _cat: cat,
    });
  }

  if (SAUCE_KEYWORDS.some((k) => n.includes(k))) {
    return buildResult({
      class: FOODICS_CLASS.SAUCE_CONDIMENT,
      autoIgnore: false,
      strictMatch: true,
      reason: "sauce_keyword",
      _n: n,
      _cat: cat,
    });
  }

  if (BEVERAGE_KEYWORDS.some((k) => n.includes(k) || cat.includes(k))) {
    return buildResult({
      class: FOODICS_CLASS.DRINK,
      autoIgnore: false,
      strictMatch: tokenCount(n) <= 3,
      reason: "beverage_keyword",
      inherited_category: ANALYTICS_CATEGORY.BEVERAGE,
      _n: n,
      _cat: cat,
    });
  }

  if (ADDON_HINTS.some((k) => n.includes(k) || cat.includes(k))) {
    return buildResult({
      class: FOODICS_CLASS.ADDON,
      autoIgnore: false,
      strictMatch: tokenCount(n) <= 2,
      reason: "addon_hint",
      _n: n,
      _cat: cat,
    });
  }

  if (OPERATIONAL_EXACT.has(n)) {
    return buildResult({
      class: FOODICS_CLASS.OPERATIONAL,
      autoIgnore: false,
      strictMatch: true,
      reason: "operational_ingredient",
      _n: n,
      _cat: cat,
    });
  }

  if (tokenCount(n) <= 2) {
    return buildResult({
      class: FOODICS_CLASS.MENU_ITEM,
      autoIgnore: false,
      strictMatch: true,
      reason: "short_menu_name",
      _n: n,
      _cat: cat,
    });
  }

  return buildResult({
    class: FOODICS_CLASS.MENU_ITEM,
    autoIgnore: false,
    strictMatch: false,
    reason: "default",
    _n: n,
    _cat: cat,
  });
}

/** Optional category inheritance for rows that inherit beverage grouping */
export function inheritFoodicsCategory(rawName, category = null) {
  const c = classifyFoodicsRow(rawName, category);
  return c.inherited_category || c.analytics_category;
}

export function isPromoOrMetaRow(rawName) {
  return classifyFoodicsRow(rawName).autoIgnore;
}
