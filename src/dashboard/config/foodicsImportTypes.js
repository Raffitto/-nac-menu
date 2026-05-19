/** Foodics import lane metadata */

export const IMPORT_TYPE = {
  PRODUCT_SALES: "product_sales",
  WAITER_PRODUCT_SALES: "waiter_product_sales",
};

export const BRANCH_OPTIONS = [
  { value: "khobar", label: "Khobar" },
  { value: "riyadh", label: "Riyadh" },
  { value: "jeddah", label: "Jeddah" },
];

export const IMPORT_LANES = {
  [IMPORT_TYPE.PRODUCT_SALES]: {
    id: IMPORT_TYPE.PRODUCT_SALES,
    title: "Product Sales Import",
    subtitle: "Branch-level product / menu performance",
    icon: "product",
    foodicsReport: "Product sales report — grouped by product",
    instructions: [
      "Export from Foodics: Product Sales (grouped by product)",
      "Include: Product, Net Quantity, Net Sales, Gross Sales, Discount Amount",
      "Use the same From / To dates as your business week",
      "Select the correct branch before uploading",
    ],
    usedFor: [
      "Item performance & top sellers",
      "Menu engineering & heat score",
      "Viewed vs sold correlation",
      "Modifier / attachment intelligence (product rollups)",
    ],
  },
  [IMPORT_TYPE.WAITER_PRODUCT_SALES]: {
    id: IMPORT_TYPE.WAITER_PRODUCT_SALES,
    title: "Waiter Product Sales Import",
    subtitle: "Staff-level selling performance",
    icon: "waiter",
    foodicsReport: "Sales by Creator Report — Group By: product",
    instructions: [
      "Export from Foodics: Sales by Creator Report",
      "Group By: product",
      "Columns: Creator, Product, Product SKU, Gross Sales, Net Sales, Net Quantity",
      "Creator = waiter/server name · Product = item sold",
    ],
    columnMap: {
      waiter_name: "Creator",
      item_name: "Product",
      sku: "Product SKU",
      gross_sales: "Gross Sales",
      net_sales: "Net Sales",
      quantity: "Net Quantity",
    },
    usedFor: [
      "Waiter leaderboards & upsell %",
      "Weekly staff target reports",
      "Dessert / beverage champion tracking",
      "Per-waiter export targeting",
    ],
  },
};

export function normalizeImportType(batch) {
  if (!batch) return null;
  return batch.import_type || IMPORT_TYPE.PRODUCT_SALES;
}

export function laneLabel(importType) {
  return IMPORT_LANES[importType]?.title || importType;
}
