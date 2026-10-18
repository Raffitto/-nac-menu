/**
 * Confirmed guest-catalogue identities.
 * menu_items has no SKU column. Foodics SKUs stay on sales rows
 * (foodics_sales_items.product_sku) and in the Foodics catalogue.
 * These rules only decide what guests see. They do not write the database.
 */

function itemName(item) {
  return String(item?.en || item?.name_en || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function amount(value) {
  const match = String(value ?? "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

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
  const name = itemName(item);
  if (name !== "big nac" && name !== "big nac new") return false;
  return amount(item?.calories) === 1115 && amount(item?.price) === 69;
}

/** Previous Big Nac (sk-1955): 1100 cal / 68 SAR. Not served. Row is not deleted. */
export function isRetiredBigNac(item) {
  const name = itemName(item);
  if (name !== "big nac" && name !== "big nac new") return false;
  return !isActiveBigNac(item);
}

export function presentGuestMenuItem(item) {
  if (!isActiveBigNac(item)) return item;
  if (item.en === "Big NAC" && (!item.name_en || item.name_en === "Big NAC")) return item;
  return {
    ...item,
    en: "Big NAC",
    ...(item.name_en ? { name_en: "Big NAC" } : {}),
  };
}
