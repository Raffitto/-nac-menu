/**
 * NAC-owned commerce intelligence types.
 * Foodics (or a future NAC POS) is only a source adapter feeding these shapes.
 */

export type CommerceSource = "foodics" | "nac_pos" | "synthetic";

export type OrderType =
  | "dine_in"
  | "takeaway"
  | "delivery"
  | "pickup"
  | "other";

export type OrderStatus = "completed" | "void" | "refunded" | "cancelled" | "open";

export type CanonicalSemanticFamily =
  | "food"
  | "dessert"
  | "coffee"
  | "other_beverage"
  | "unclassified";

export type TableArchetype =
  | "dessert_only"
  | "coffee_only"
  | "dessert_and_coffee"
  | "food_only"
  | "food_and_beverage"
  | "full_service"
  | "beverage_only"
  | "unclassified";

export type CommerceFocus =
  | "session_mix"
  | "dessert_focused"
  | "food_containing"
  | "full_service"
  | "coffee_only"
  | "dessert_conversion"
  | "attachment"
  | "item_mix"
  | "rank_items"
  | "basket"
  | "opportunity"
  | "branch_decomposition"
  | "guest_weighted"
  | "freshness"
  | "health"
  | "data_used"
  | "attention"
  | null;

export type CanonicalOrder = {
  source: CommerceSource;
  sourceOrderId: string;
  sourceRevision: string;
  branchId: string;
  businessDate: string;
  openedAt: string | null;
  closedAt: string | null;
  orderType: OrderType;
  tableId: string | null;
  covers: number | null;
  subtotal: number | null;
  discount: number | null;
  tax: number | null;
  netSales: number | null;
  status: OrderStatus;
  ingestedAt: string;
};

export type CanonicalOrderItem = {
  source: CommerceSource;
  sourceOrderId: string;
  sourceOrderItemId: string;
  branchId: string;
  businessDate: string;
  productId: string | null;
  canonicalMenuItemId: string | null;
  itemName: string;
  sourceCategory: string | null;
  canonicalCategory: CanonicalSemanticFamily;
  quantity: number;
  grossAmount: number | null;
  discountAmount: number | null;
  netAmount: number | null;
  status: OrderStatus;
};

export type BasketFlags = {
  hasFood: boolean;
  hasDessert: boolean;
  hasCoffee: boolean;
  hasOtherBeverage: boolean;
  hasUnclassified: boolean;
  knownItemCount: number;
};

export type DineInSession = {
  sourceOrderId: string;
  branchId: string;
  businessDate: string;
  closedAt: string | null;
  covers: number | null;
  netSales: number;
  itemCount: number;
  flags: BasketFlags;
  archetype: TableArchetype;
  items: CanonicalOrderItem[];
};

export type ArchetypeTotals = {
  sessions: number;
  netSales: number;
  covers: number | null;
  items: number;
  dessertItems: number;
  foodItems: number;
  beverageItems: number;
};

export type ServiceMixResult = {
  source: CommerceSource;
  branchId: string;
  periodStart: string;
  periodEnd: string;
  completedThrough: string | null;
  lastIngestAt: string | null;
  totalSessions: number;
  byArchetype: Record<TableArchetype, ArchetypeTotals>;
  dessertFocusedShare: number | null;
  foodContainingShare: number | null;
  fullServiceShare: number | null;
  coffeeLedShare: number | null;
  dessertConversion: number | null;
  dessertAtAllShare: number | null;
  guestWeightedDessertFocusedShare: number | null;
  guestWeightedFoodContainingShare: number | null;
  guestWeightedDessertAtAllShare: number | null;
  unclassifiedRate: number | null;
  coversAvailable: boolean;
  totalCovers: number | null;
};

export type MixComparison = {
  current: ServiceMixResult;
  previous: ServiceMixResult;
  dessertFocusedPp: number | null;
  foodContainingPp: number | null;
  fullServicePp: number | null;
  dessertConversionPp: number | null;
};

export type OpportunityEstimate = {
  label: string;
  estimateNetSales: number;
  deltaVsCurrent: number;
  method: string;
  isEstimate: true;
};
