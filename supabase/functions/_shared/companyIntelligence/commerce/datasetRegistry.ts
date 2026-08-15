/**
 * Foodics dataset registry. Delivery mode is an implementation detail.
 * Observed 2026-08-15: Sales by Creator and Menu Engineering often download
 * immediately; Orders / Order Items POST export-api/v2 and process async.
 * Delivery can still vary by size/range — prefer auto_detect.
 */

export type AcquisitionMode =
  | "direct_download"
  | "async_email"
  | "authenticated_read"
  | "auto_detect";

export type DatasetName =
  | "sales_by_creator"
  | "menu_engineering"
  | "orders"
  | "order_items"
  | "order_payments"
  | "order_tags"
  | "commerce_sessions"
  | "item_mix"
  | "session_mix"
  | "product_mapping"
  | "cash_up";

export type DatasetRegistryEntry = {
  canonicalName: DatasetName;
  sourceReportName: string;
  preferredMode: AcquisitionMode;
  fallbackModes: AcquisitionMode[];
  delivery: "auto_detect" | AcquisitionMode;
  maxRangeDays: number | null;
  requiredCompanions: DatasetName[];
  publicationGroup: string | null;
  revisionOverlapDays: number;
  branchScope: "single" | "export_may_include_all";
  expectedContentType: string[];
  schemaParser: "foodics_csv" | "foodics_console_json" | "cash_up" | "derived";
  freshnessSlaHours: number;
  authority: string;
};

export const FOODICS_DATASET_REGISTRY: Record<string, DatasetRegistryEntry> = {
  sales_by_creator: {
    canonicalName: "sales_by_creator",
    sourceReportName: "Sales by Creator",
    preferredMode: "direct_download",
    fallbackModes: ["authenticated_read"],
    delivery: "auto_detect",
    maxRangeDays: 31,
    requiredCompanions: [],
    publicationGroup: null,
    revisionOverlapDays: 3,
    branchScope: "single",
    expectedContentType: ["text/csv", "application/vnd.ms-excel"],
    schemaParser: "foodics_csv",
    freshnessSlaHours: 36,
    authority: "legacy_external_creator_grain",
  },
  menu_engineering: {
    canonicalName: "menu_engineering",
    sourceReportName: "Menu Engineering",
    preferredMode: "direct_download",
    fallbackModes: ["authenticated_read"],
    delivery: "auto_detect",
    maxRangeDays: 31,
    requiredCompanions: [],
    publicationGroup: null,
    revisionOverlapDays: 3,
    branchScope: "single",
    expectedContentType: ["text/csv", "application/vnd.ms-excel"],
    schemaParser: "foodics_csv",
    freshnessSlaHours: 36,
    authority: "legacy_external_product_period",
  },
  orders: {
    canonicalName: "orders",
    sourceReportName: "Orders",
    preferredMode: "auto_detect",
    fallbackModes: ["authenticated_read"],
    delivery: "auto_detect",
    maxRangeDays: 31,
    requiredCompanions: ["order_items"],
    publicationGroup: "commerce_sessions",
    revisionOverlapDays: 3,
    branchScope: "export_may_include_all",
    expectedContentType: ["text/csv", "application/json"],
    schemaParser: "foodics_console_json",
    freshnessSlaHours: 36,
    authority: "canonical_commerce_orders",
  },
  order_items: {
    canonicalName: "order_items",
    sourceReportName: "Order Items",
    preferredMode: "auto_detect",
    fallbackModes: ["authenticated_read"],
    delivery: "auto_detect",
    maxRangeDays: 31,
    requiredCompanions: ["orders"],
    publicationGroup: "commerce_sessions",
    revisionOverlapDays: 3,
    branchScope: "export_may_include_all",
    expectedContentType: ["text/csv", "application/json"],
    schemaParser: "foodics_console_json",
    freshnessSlaHours: 36,
    authority: "canonical_commerce_items",
  },
  cash_up: {
    canonicalName: "cash_up",
    sourceReportName: "Cash Up",
    preferredMode: "direct_download",
    fallbackModes: [],
    delivery: "direct_download",
    maxRangeDays: null,
    requiredCompanions: [],
    publicationGroup: null,
    revisionOverlapDays: 0,
    branchScope: "single",
    expectedContentType: ["application/json"],
    schemaParser: "cash_up",
    freshnessSlaHours: 36,
    authority: "canonical_headline_sales",
  },
};

export function getDataset(name: string): DatasetRegistryEntry | null {
  return FOODICS_DATASET_REGISTRY[name] || null;
}

export function publicationCompanions(name: string): DatasetName[] {
  const row = getDataset(name);
  if (!row) return [];
  return [row.canonicalName, ...row.requiredCompanions];
}
