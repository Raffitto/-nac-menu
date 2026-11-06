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

/** Previous Big Nac (sk-1955) is stored as 1100 cal / 68 SAR. Guests see sk-2457 instead. */
export function isRetiredBigNac(item) {
  const name = itemName(item);
  if (name !== "big nac" && name !== "big nac new") return false;
  return !isActiveBigNac(item);
}

/**
 * One sellable identity per branch and portion.
 * Price separates legitimate portions (Kale & Cabbage / Quinoa at 59 vs 45).
 * A missing price is not an identity, so unnamed or unpriced rows are never merged.
 */
export function canonicalPlacementKey(item) {
  const name = itemName(item);
  if (!name) return null;
  const price = amount(item?.price);
  if (price == null) return null;
  const branch = String(item?.branch_id || item?.branchId || "");
  return `${branch}|${name}|${price}`;
}

export function isSameCanonicalPlacement(left, right) {
  const leftKey = canonicalPlacementKey(left);
  const rightKey = canonicalPlacementKey(right);
  return Boolean(leftKey) && leftKey === rightKey;
}

/** Khobar is the reference guest presentation. Branch ids on the row stay unchanged. */
export function presentGuestMenuItem(item) {
  const name = itemName(item);
  if (name !== "big nac" && name !== "big nac new") return item;
  const alreadyNamed = (item.en === "Big NAC" || item.name_en === "Big NAC");
  if (isActiveBigNac(item) && alreadyNamed && (!item.name_en || item.name_en === "Big NAC") && item.en === "Big NAC") {
    return item;
  }
  return {
    ...item,
    en: "Big NAC",
    ...(item.name_en ? { name_en: "Big NAC" } : {}),
    price: "69 SAR",
    calories: 1115,
  };
}
