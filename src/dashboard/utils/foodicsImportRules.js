import { normalizeFoodicsName } from "./foodicsNameNormalize";

/** Tea variants sold as selections — not standalone menu SKUs */
export const TEA_SELECTION_KEYS = new Set(
  [
    "breakfast tea",
    "peppermint tea",
    "chamomile tea",
    "green tea",
    "english breakfast tea",
    "mint tea",
  ].map(normalizeFoodicsName),
);

/** Condiments/modifiers ignored when net/gross sales are zero */
export const FREE_CONDIMENT_KEYS = new Set(
  [
    "spicy mayo",
    "regular ketchup",
    "regular mayo",
    "balsamic vinegar",
    "sriracha sauce",
    "olive oil",
    "chilli flakes",
    "chili flakes",
    "honey",
  ].map(normalizeFoodicsName),
);

/** Not on menu yet — do not fuzzy-match */
export const FUTURE_MENU_ITEM_KEYS = new Set(["big nac"].map(normalizeFoodicsName));

/**
 * Paid upsell modifiers — track without requiring a main menu item FK.
 * @type {Array<{ keys: string[], trackName: string, upsellHint: string, analyticsCategory: string }>}
 */
export const PAID_MODIFIER_RULES = [
  {
    keys: ["chocolate sauce", "extra dark chocolate", "dark chocolate sauce"],
    trackName: "Chocolate Sauce",
    upsellHint: "Churros & pancakes",
    analyticsCategory: "modifier",
  },
  {
    keys: ["extra shot"],
    trackName: "Extra Shot",
    upsellHint: "Hot & cold coffee drinks",
    analyticsCategory: "modifier",
  },
  {
    keys: ["fresh milk", "extra milk"],
    trackName: "Fresh Milk",
    upsellHint: "Hot & cold coffee drinks",
    analyticsCategory: "modifier",
  },
];

export const IGNORE_REASON = {
  PROMO: "promo_campaign",
  META: "report_meta",
  TEA_SELECTION: "tea_selection",
  FREE_MODIFIER: "free_modifier",
  PLACEHOLDER: "placeholder",
};

export const IMPORT_STATUS = {
  IGNORED: "ignored",
  IGNORED_SELECTION: "ignored_selection",
  IGNORED_FREE_MODIFIER: "ignored_free_modifier",
  PAID_MODIFIER: "paid_modifier",
  FUTURE_MENU: "future_menu",
  NEEDS_REVIEW: "needs_review",
  MATCHED: "matched",
};

export function isZeroRevenue(row) {
  const net = Number(row?.net_sales);
  const gross = Number(row?.gross_sales);
  if (Number.isFinite(net) && net > 0) return false;
  if (Number.isFinite(gross) && gross > 0) return false;
  return true;
}

export function isTeaSelection(rawName) {
  const n = normalizeFoodicsName(rawName);
  if (TEA_SELECTION_KEYS.has(n)) return true;
  if (n.endsWith(" tea") && n.split(" ").length <= 3) {
    const base = n.replace(/\s+tea$/, "");
    return base.length > 0 && !["hot", "iced", "milk"].includes(base);
  }
  return false;
}

export function isFutureMenuItem(rawName) {
  return FUTURE_MENU_ITEM_KEYS.has(normalizeFoodicsName(rawName));
}

export function isFreeCondimentName(rawName) {
  return FREE_CONDIMENT_KEYS.has(normalizeFoodicsName(rawName));
}

export function resolvePaidModifierRule(rawName) {
  const n = normalizeFoodicsName(rawName);
  for (const rule of PAID_MODIFIER_RULES) {
    if (rule.keys.some((k) => n === normalizeFoodicsName(k) || n.includes(normalizeFoodicsName(k)))) {
      return rule;
    }
  }
  return null;
}

export function ignoreReasonLabel(reason) {
  const labels = {
    [IGNORE_REASON.TEA_SELECTION]: "Tea selection",
    [IGNORE_REASON.FREE_MODIFIER]: "Free modifier / condiment",
    [IGNORE_REASON.PROMO]: "Promo / campaign",
    [IGNORE_REASON.META]: "Report row",
    [IGNORE_REASON.PLACEHOLDER]: "Placeholder",
  };
  return labels[reason] || "Ignored";
}

/** Group ignored rows for UI sections */
export function groupIgnoredRows(rows) {
  const groups = {
    tea: [],
    freeModifier: [],
    promo: [],
    other: [],
  };

  for (const row of rows || []) {
    const reason = row.ignore_reason || "";
    if (reason === IGNORE_REASON.TEA_SELECTION || row.import_status === IMPORT_STATUS.IGNORED_SELECTION) {
      groups.tea.push(row);
    } else if (
      reason === IGNORE_REASON.FREE_MODIFIER ||
      row.import_status === IMPORT_STATUS.IGNORED_FREE_MODIFIER
    ) {
      groups.freeModifier.push(row);
    } else if (reason === IGNORE_REASON.PROMO) {
      groups.promo.push(row);
    } else {
      groups.other.push(row);
    }
  }

  return groups;
}
