import { resolveConfirmedMenuIdentity, isConfirmedHistoricalBigNac } from "./menuIdentity";

/**
 * Confirmed guest-catalogue identities.
 * menu_items has no SKU column. Foodics SKUs stay on sales rows
 * (foodics_sales_items.product_sku) and in the Foodics catalogue.
 * These rules only decide what guests see. They do not write the database.
 */

export const CONFIRMED_MENU_IDENTITIES = Object.freeze([
  {
    sku: "sk-1320",
    guestNameEn: "2 Eggs Any Style",
    priceSar: 31,
    calories: 461.4,
    portions: "single",
  },
  {
    sku: "sk-2457",
    guestNameEn: "Big NAC",
    foodicsName: "Big NAC New",
    priceSar: 69,
    calories: 1115,
    portions: "single",
    retiredSku: "sk-1955",
  },
  { sku: "sk-0621", guestNameEn: "Quinoa", portion: "large-am" },
  { sku: "sk-0599", guestNameEn: "Quinoa", portion: "small-dinner" },
  { sku: "sk-0622", guestNameEn: "Kale & Cabbage", portion: "large-am" },
  { sku: "sk-0620", guestNameEn: "Kale & Cabbage", portion: "small-dinner" },
]);

export function isActiveBigNac(item) {
  return resolveConfirmedMenuIdentity(item)?.foodicsSku === "sk-2457";
}

/** Historical status needs an explicit external identity, not a name/price guess. */
export function isRetiredBigNac(item) {
  return isConfirmedHistoricalBigNac(item);
}

/** Presentation may normalize a confirmed brand label, never fabricate price or nutrition. */
export function presentGuestMenuItem(item) {
  const identity = resolveConfirmedMenuIdentity(item);
  if (identity?.foodicsSku !== "sk-2457") return item;
  if (item.en === identity.guestNameEn && (!item.name_en || item.name_en === identity.guestNameEn)) return item;
  return {
    ...item,
    en: identity.guestNameEn,
    ...(item.name_en ? { name_en: identity.guestNameEn } : {}),
  };
}
