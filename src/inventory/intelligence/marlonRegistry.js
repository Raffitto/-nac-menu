/**
 * Verified Marlon identities. A blank SKU stays unresolved.
 * This registry does not insert rows into the weekly workbook.
 */
export const MARLON_WASTAGE_ITEMS = [
  { name: "French Toast", sku: "sk-1461", kind: "finished_product" },
  { name: "Beef Tenderloin", sku: "sk-1695", kind: "finished_product" },
  { name: "Pancake", sku: "sk-2200", kind: "finished_product" },
  { name: "Fresh Milk", sku: "sk-2375", kind: "ingredient" },
  { name: "Toasted Sourdough", sku: "sk-2492", kind: "ingredient" },
  { name: "Halloumi", sku: "sk-2519", kind: "ingredient" },
  { name: "Iced Latte", sku: "sk-2548", kind: "finished_product" },
  { name: "Soda Water", sku: "sk-2574", kind: "ingredient" },
];

export const MARLON_INVENTORY_ITEMS = [
  { name: "Pepsi Regular", sku: "sk-1148" },
  { name: "T55 Flour", sku: "sk-1065" },
  { name: "Dry Yeast", sku: "sk-0995" },
  { name: "NAC-Cajun Sauce", sku: "sk-0614" },
  { name: "NAC-French Toast Soaking Mix", sku: "sk-0628" },
  { name: "NAC-Frosties Ice Cream", sku: "sk-0629" },
  { name: "NAC-Mashed Avocado", sku: "sk-0639" },
  { name: "Bell Pepper Red", sku: "sk-0862" },
  { name: "NAC-Lemon Juice (FOH)", sku: "sk-1224" },
  { name: "NAC-Pepper Sauce", sku: "sk-1404" },
];

export const UNRESOLVED_MASTER_ITEMS = [
  { name: "Sumac Powder", sku: null, reason: "item-master SKU is blank" },
];

export function marlonItemByName(name) {
  const key = String(name || "").trim().toLowerCase();
  const known = [...MARLON_WASTAGE_ITEMS, ...MARLON_INVENTORY_ITEMS].find((item) => item.name.toLowerCase() === key);
  if (known) return { status: "verified", sku: known.sku, item: known };
  const unresolved = UNRESOLVED_MASTER_ITEMS.find((item) => item.name.toLowerCase() === key);
  if (unresolved) return { status: "unresolved", sku: null, reason: unresolved.reason };
  return { status: "unknown", sku: null, reason: "not on the verified Marlon list" };
}
