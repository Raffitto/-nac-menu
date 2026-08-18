/**
 * Machine-readable canonical commerce semantic model.
 * Only fields that exist in NAC canonical stores. Do not invent columns.
 */

export type FieldAvailability = "available" | "unavailable" | "partial";

export type SemanticField = {
  id: string;
  entity: "orders" | "items" | "sessions" | "products";
  store: "commerce_orders" | "commerce_order_items" | "commerce_sessions" | "commerce_product_map" | "none";
  column: string | null;
  availability: FieldAvailability;
  notes: string;
};

export const COMMERCE_SEMANTIC_FIELDS: Record<string, SemanticField> = {
  source_order_id: {
    id: "source_order_id", entity: "orders", store: "commerce_orders",
    column: "source_order_id", availability: "available",
    notes: "Canonical order identity (Foodics UUID when ingested from console).",
  },
  foodics_reference: {
    id: "foodics_reference", entity: "orders", store: "commerce_orders",
    column: "source_metadata.foodics_reference", availability: "partial",
    notes: "Present when official-CSV ingest stored foodics_reference in source_metadata.",
  },
  check_number: {
    id: "check_number", entity: "orders", store: "commerce_orders",
    column: "check_number", availability: "partial",
    notes: "Column exists; may be null on older authenticated-read rows.",
  },
  branch_id: {
    id: "branch_id", entity: "orders", store: "commerce_orders",
    column: "branch_id", availability: "available", notes: "khobar | riyadh | jeddah",
  },
  business_date: {
    id: "business_date", entity: "orders", store: "commerce_orders",
    column: "business_date", availability: "available", notes: "Foodics business date",
  },
  opened_at: {
    id: "opened_at", entity: "orders", store: "commerce_orders",
    column: "opened_at", availability: "available",
    notes: "Stored wall-clock hour is used for daypart; do not assume UTC conversion.",
  },
  closed_at: {
    id: "closed_at", entity: "orders", store: "commerce_orders",
    column: "closed_at", availability: "available", notes: "May be null on open orders",
  },
  status: {
    id: "status", entity: "orders", store: "commerce_orders",
    column: "status", availability: "available",
    notes: "completed | open | void | cancelled | refunded. Official CSV Joined maps to open.",
  },
  order_type: {
    id: "order_type", entity: "orders", store: "commerce_orders",
    column: "order_type", availability: "available", notes: "Observed Khobar: dine_in",
  },
  covers: {
    id: "covers", entity: "orders", store: "commerce_orders",
    column: "covers", availability: "available", notes: "Foodics guests when present",
  },
  subtotal: {
    id: "subtotal", entity: "orders", store: "commerce_orders",
    column: "subtotal", availability: "available", notes: "Order subtotal",
  },
  tax: {
    id: "tax", entity: "orders", store: "commerce_orders",
    column: "tax", availability: "available", notes: "Order tax",
  },
  net_sales: {
    id: "net_sales", entity: "orders", store: "commerce_orders",
    column: "net_sales", availability: "available",
    notes: "Check amount. Not Cash Up headline net_sales.",
  },
  discount: {
    id: "discount", entity: "orders", store: "commerce_orders",
    column: "discount", availability: "available", notes: "Order discount",
  },
  physical_table_number: {
    id: "physical_table_number", entity: "orders", store: "none",
    column: null, availability: "unavailable",
    notes: "Physical dining-table number is not stored. table_id exists but is unused/null in current Khobar ingest.",
  },
  table_id: {
    id: "table_id", entity: "orders", store: "commerce_orders",
    column: "table_id", availability: "unavailable",
    notes: "Column exists; current Khobar canonical rows do not populate a usable physical table identity.",
  },
  creator: {
    id: "creator", entity: "orders", store: "none",
    column: null, availability: "unavailable",
    notes: "Official CSV created_by is not a canonical commerce_orders column.",
  },
  item_name: {
    id: "item_name", entity: "items", store: "commerce_order_items",
    column: "item_name", availability: "available", notes: "Source product name",
  },
  product_id: {
    id: "product_id", entity: "items", store: "commerce_order_items",
    column: "product_id", availability: "partial", notes: "Foodics product UUID or SKU depending on ingest",
  },
  canonical_menu_item_id: {
    id: "canonical_menu_item_id", entity: "items", store: "commerce_order_items",
    column: "canonical_menu_item_id", availability: "partial", notes: "Mapped when catalog match exists",
  },
  canonical_category: {
    id: "canonical_category", entity: "items", store: "commerce_order_items",
    column: "canonical_category", availability: "available",
    notes: "food | dessert | coffee | other_beverage | unclassified",
  },
  quantity: {
    id: "quantity", entity: "items", store: "commerce_order_items",
    column: "quantity", availability: "available", notes: "Line quantity",
  },
  net_amount: {
    id: "net_amount", entity: "items", store: "commerce_order_items",
    column: "net_amount", availability: "available", notes: "Line net",
  },
  gross_amount: {
    id: "gross_amount", entity: "items", store: "commerce_order_items",
    column: "gross_amount", availability: "partial", notes: "May be null",
  },
  item_status: {
    id: "item_status", entity: "items", store: "commerce_order_items",
    column: "status", availability: "available",
    notes: "Canonical item status. Official CSV Moved was mapped to completed for ingest parity.",
  },
  item_moved: {
    id: "item_moved", entity: "items", store: "none",
    column: null, availability: "unavailable",
    notes: "Moved vs Done is not retained as a distinct canonical item status.",
  },
  mapping_status: {
    id: "mapping_status", entity: "items", store: "commerce_order_items",
    column: "canonical_category", availability: "available",
    notes: "unclassified family means unmapped for mix purposes.",
  },
  session_archetype: {
    id: "session_archetype", entity: "sessions", store: "commerce_sessions",
    column: "archetype", availability: "available", notes: "Published dine-in session archetype",
  },
  session_flags: {
    id: "session_flags", entity: "sessions", store: "commerce_sessions",
    column: "flags", availability: "available", notes: "hasFood/hasDessert/hasCoffee when published",
  },
  session_item_count: {
    id: "session_item_count", entity: "sessions", store: "commerce_sessions",
    column: "item_count", availability: "available", notes: "Basket quantity sum",
  },
};

export const UNAVAILABLE_FIELD_IDS = Object.values(COMMERCE_SEMANTIC_FIELDS)
  .filter((f) => f.availability === "unavailable")
  .map((f) => f.id);

export function getSemanticField(id: string): SemanticField | null {
  return COMMERCE_SEMANTIC_FIELDS[id] || null;
}
