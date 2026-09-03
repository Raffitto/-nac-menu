/** Foodics import lane metadata */

import { operationalBrandDisplay, CANONICAL_BRANCH_IDS } from "../utils/branchIdentity";
export const IMPORT_TYPE = {
  PRODUCT_SALES: "product_sales",
  WAITER_PRODUCT_SALES: "waiter_product_sales",
  SALES_BY_CREATOR: "sales_by_creator",
};

export const BRANCH_OPTIONS = CANONICAL_BRANCH_IDS.map((id) => ({
  value: id,
  label: operationalBrandDisplay(id),
}));

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
    title: "Sales by Creator — Grouped by Product",
    subtitle: "Canonical sales truth — Foodics Sales by Creator, Group By Product",
    icon: "waiter",
    foodicsReport: "Reports → Sales Reports → Sales by Creator → Group By → Product",
    instructions: [
      "Foodics: Reports → Sales Reports → Sales by Creator → Group By → Product",
      "Use the exact requested date range",
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
      "Executive export top / least items",
      "Waiter leaderboards & upsell %",
      "Modifier / attachment intelligence",
      "Menu visibility correlation",
    ],
  },
  [IMPORT_TYPE.SALES_BY_CREATOR]: {
    id: IMPORT_TYPE.SALES_BY_CREATOR,
    title: "Sales by Creator",
    subtitle: "Staff-level guests, orders, and sales totals",
    icon: "waiter",
    foodicsReport: "Reports → Sales Reports → Sales by Branch → Creator",
    instructions: [
      "Foodics: Reports → Sales Reports → Sales by Branch → Creator",
      "Use the exact requested date range",
      "Columns typically include Creator, Guests, Orders, Net Sales / Gross Sales",
    ],
    usedFor: [
      "Average check",
      "Staff order and guest counts",
      "Staff Performance ranking",
    ],
  },
};

export function normalizeImportType(batch) {
  if (!batch) return null;
  return batch.import_type || IMPORT_TYPE.WAITER_PRODUCT_SALES;
}

export function laneLabel(importType) {
  return IMPORT_LANES[importType]?.title || importType;
}
