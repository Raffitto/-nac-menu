/**
 * Commerce-specific source authority. Cash Up remains headline sales.
 * Do not replace one source with another silently.
 */

export const COMMERCE_SOURCE_AUTHORITY = {
  headline_sales: {
    questionFamily: "headline_management_sales",
    source: "cash_up",
    notes: "Physical Cash Up is canonical for management sales.",
  },
  product_item_mix: {
    questionFamily: "item_mix",
    source: "canonical_commerce_order_items",
    notes: "Published order-item facts after mapping.",
  },
  session_archetype: {
    questionFamily: "session_mix",
    source: "canonical_commerce_sessions",
    notes: "Published dine-in sessions only.",
  },
  covers_by_archetype: {
    questionFamily: "guest_weighted_mix",
    source: "foodics_order_guests",
    notes: "Foodics guests on completed dine-in orders, when validated.",
  },
  reconciliation: {
    questionFamily: "source_reconciliation",
    source: "explicit_comparison",
    notes: "Compare Cash Up vs Foodics totals. Never substitute.",
  },
} as const;

export function authorityForCommerceQuestion(family: keyof typeof COMMERCE_SOURCE_AUTHORITY): string {
  return COMMERCE_SOURCE_AUTHORITY[family].source;
}
