import { normalizeFoodicsName } from "./foodicsNameNormalize";

/** @typedef {'promo_campaign'|'operational'|'sauce_condiment'|'drink'|'addon'|'menu_item'|'unknown'} FoodicsClass */

export const FOODICS_CLASS = {
  PROMO_CAMPAIGN: "promo_campaign",
  OPERATIONAL: "operational",
  SAUCE_CONDIMENT: "sauce_condiment",
  DRINK: "drink",
  ADDON: "addon",
  MENU_ITEM: "menu_item",
  UNKNOWN: "unknown",
};

export const FOODICS_CLASS_LABELS = {
  [FOODICS_CLASS.PROMO_CAMPAIGN]: "Promo / campaign",
  [FOODICS_CLASS.OPERATIONAL]: "Operational",
  [FOODICS_CLASS.SAUCE_CONDIMENT]: "Sauce / condiment",
  [FOODICS_CLASS.DRINK]: "Drink",
  [FOODICS_CLASS.ADDON]: "Add-on",
  [FOODICS_CLASS.MENU_ITEM]: "Menu item",
  [FOODICS_CLASS.UNKNOWN]: "Unknown",
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
  ["title", "date range", "product", "value", "all together", "whatever is done"].map(
    normalizeFoodicsName,
  ),
);

const OPERATIONAL_EXACT = new Set(
  [
    "honey",
    "apple",
    "cranberry",
    "olive oil",
    "chilli flakes",
    "chili flakes",
    "regular ketchup",
    "regular mayo",
    "parmesan",
    "pita bread",
    "extra shot",
    "fresh milk",
    "chocolate sauce",
    "truffle mayo",
    "sriracha sauce",
    "mushrooms",
    "asparagus",
    "water",
    "milk",
    "syrup",
    "tea",
    "avocado",
    "fries",
  ].map(normalizeFoodicsName),
);

const SAUCE_KEYWORDS = [
  "sauce",
  "mayo",
  "ketchup",
  "flakes",
  "dressing",
  "dip",
  "condiment",
  "vinegar",
  "oil",
  "butter",
  "jam",
];

const DRINK_KEYWORDS = [
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
];

const ADDON_HINTS = ["add on", "addon", "extra", "side", "topping", "modifier"];

/**
 * Classify a Foodics product row before matching.
 * @param {string} rawName
 * @param {string|null} [category]
 * @returns {{ class: FoodicsClass, label: string, autoIgnore: boolean, strictMatch: boolean, reason?: string }}
 */
export function classifyFoodicsRow(rawName, category = null) {
  const raw = String(rawName || "").trim();
  const n = normalizeFoodicsName(raw);
  const cat = normalizeFoodicsName(category || "");

  if (!n) {
    return {
      class: FOODICS_CLASS.UNKNOWN,
      label: FOODICS_CLASS_LABELS[FOODICS_CLASS.UNKNOWN],
      autoIgnore: true,
      strictMatch: true,
      reason: "empty",
    };
  }

  if (/^\*+$/.test(raw.replace(/\s/g, ""))) {
    return {
      class: FOODICS_CLASS.UNKNOWN,
      label: FOODICS_CLASS_LABELS[FOODICS_CLASS.UNKNOWN],
      autoIgnore: true,
      strictMatch: true,
      reason: "placeholder",
    };
  }

  if (META_EXACT.has(n) || n.startsWith("sales by product")) {
    return {
      class: FOODICS_CLASS.UNKNOWN,
      label: "Report meta",
      autoIgnore: true,
      strictMatch: true,
      reason: "meta_row",
    };
  }

  if (PROMO_EXACT.has(n) || PROMO_PREFIXES.some((p) => n.startsWith(p))) {
    return {
      class: FOODICS_CLASS.PROMO_CAMPAIGN,
      label: FOODICS_CLASS_LABELS[FOODICS_CLASS.PROMO_CAMPAIGN],
      autoIgnore: true,
      strictMatch: true,
      reason: "promo_campaign",
    };
  }

  if (OPERATIONAL_EXACT.has(n)) {
    return {
      class: FOODICS_CLASS.OPERATIONAL,
      label: FOODICS_CLASS_LABELS[FOODICS_CLASS.OPERATIONAL],
      autoIgnore: false,
      strictMatch: true,
      reason: "operational_simple",
    };
  }

  if (SAUCE_KEYWORDS.some((k) => n.includes(k))) {
    return {
      class: FOODICS_CLASS.SAUCE_CONDIMENT,
      label: FOODICS_CLASS_LABELS[FOODICS_CLASS.SAUCE_CONDIMENT],
      autoIgnore: false,
      strictMatch: true,
      reason: "sauce_keyword",
    };
  }

  if (DRINK_KEYWORDS.some((k) => n.includes(k) || cat.includes(k))) {
    return {
      class: FOODICS_CLASS.DRINK,
      label: FOODICS_CLASS_LABELS[FOODICS_CLASS.DRINK],
      autoIgnore: false,
      strictMatch: n.split(" ").length <= 2,
      reason: "drink_keyword",
    };
  }

  if (ADDON_HINTS.some((k) => n.includes(k) || cat.includes(k))) {
    return {
      class: FOODICS_CLASS.ADDON,
      label: FOODICS_CLASS_LABELS[FOODICS_CLASS.ADDON],
      autoIgnore: false,
      strictMatch: n.split(" ").length <= 2,
      reason: "addon_hint",
    };
  }

  if (n.split(" ").length <= 2) {
    return {
      class: FOODICS_CLASS.MENU_ITEM,
      label: FOODICS_CLASS_LABELS[FOODICS_CLASS.MENU_ITEM],
      autoIgnore: false,
      strictMatch: true,
      reason: "short_menu_name",
    };
  }

  return {
    class: FOODICS_CLASS.MENU_ITEM,
    label: FOODICS_CLASS_LABELS[FOODICS_CLASS.MENU_ITEM],
    autoIgnore: false,
    strictMatch: false,
    reason: "default",
  };
}

/** Re-export for matchers */
export function isPromoOrMetaRow(rawName) {
  return classifyFoodicsRow(rawName).autoIgnore;
}
