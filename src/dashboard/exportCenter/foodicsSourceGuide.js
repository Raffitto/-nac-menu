import { IMPORT_TYPE } from "../config/foodicsImportTypes";

export const FOODICS_SOURCE_GUIDE = {
  [IMPORT_TYPE.SALES_BY_CREATOR]: {
    label: "Sales by Creator",
    foodicsPath: "Reports → Sales Reports → Sales by Branch → Creator",
  },
  [IMPORT_TYPE.WAITER_PRODUCT_SALES]: {
    label: "Sales by Creator — Grouped by Product",
    foodicsPath: "Reports → Sales Reports → Sales by Creator → Group By → Product",
  },
};

export function foodicsSourceLabel(importType) {
  return FOODICS_SOURCE_GUIDE[importType]?.label || importType;
}

export function formatExportDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[Number(m) - 1];
  if (!month || !d || !y) return iso;
  return `${d} ${month} ${y}`;
}

export function formatExportDateRange(from, to) {
  if (!from || !to) return "";
  return `${formatExportDate(from)} → ${formatExportDate(to)}`;
}
