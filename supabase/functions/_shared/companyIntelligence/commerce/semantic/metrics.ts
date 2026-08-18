/**
 * Reusable commerce metrics. Definitions must not compete with Cash Up headline sales.
 */

export type SemanticMetricId =
  | "order_count"
  | "completed_order_count"
  | "open_order_count"
  | "session_count"
  | "covers"
  | "item_quantity"
  | "distinct_product_count"
  | "basket_item_count"
  | "gross_check"
  | "average_check"
  | "average_spend_per_cover"
  | "attach_rate"
  | "penetration_rate"
  | "cooccurrence_count"
  | "cooccurrence_rate"
  | "category_share"
  | "conversion_rate"
  | "frequency"
  | "revenue"
  | "quantity"
  | "average_quantity"
  | "median_check"
  | "high_spend_share"
  | "mapping_coverage"
  | "unclassified_share"
  | "lift_vs_baseline";

export type SemanticMetricDef = {
  id: SemanticMetricId;
  entity: "orders" | "items" | "sessions";
  aggregation: "count" | "sum" | "mean" | "median" | "ratio" | "rank";
  dimensions: string[];
  filters: string[];
  numerator?: string;
  denominator?: string;
  nullZero: string;
  authority: string;
  aliases: string[];
};

const ORDER_DIMS = ["branch", "date", "weekday", "weekend", "daypart", "hour", "status", "order_type", "guest_band", "spend_band", "basket_band"];
const ITEM_DIMS = [...ORDER_DIMS, "product", "category", "mapped"];
const SESSION_DIMS = [...ORDER_DIMS, "archetype", "food_presence", "dessert_presence", "coffee_presence"];

export const COMMERCE_METRIC_REGISTRY: Record<SemanticMetricId, SemanticMetricDef> = {
  order_count: {
    id: "order_count", entity: "orders", aggregation: "count",
    dimensions: ORDER_DIMS, filters: ORDER_DIMS,
    nullZero: "zero", authority: "canonical_commerce_orders",
    aliases: ["orders", "checks", "how many checks", "how many orders"],
  },
  completed_order_count: {
    id: "completed_order_count", entity: "orders", aggregation: "count",
    dimensions: ORDER_DIMS, filters: ORDER_DIMS,
    nullZero: "zero", authority: "canonical_commerce_orders",
    aliases: ["completed checks", "completed dine-in", "done orders"],
  },
  open_order_count: {
    id: "open_order_count", entity: "orders", aggregation: "count",
    dimensions: ORDER_DIMS, filters: ORDER_DIMS,
    nullZero: "zero", authority: "canonical_commerce_orders",
    aliases: ["open orders", "joined orders", "open checks"],
  },
  session_count: {
    id: "session_count", entity: "sessions", aggregation: "count",
    dimensions: SESSION_DIMS, filters: SESSION_DIMS,
    nullZero: "zero", authority: "canonical_commerce_sessions",
    aliases: ["sessions", "tables", "dine-in sessions"],
  },
  covers: {
    id: "covers", entity: "orders", aggregation: "sum",
    dimensions: ORDER_DIMS, filters: ORDER_DIMS,
    nullZero: "null if covers missing", authority: "canonical_commerce_orders",
    aliases: ["guests", "guest count", "covers"],
  },
  item_quantity: {
    id: "item_quantity", entity: "items", aggregation: "sum",
    dimensions: ITEM_DIMS, filters: ITEM_DIMS,
    nullZero: "zero", authority: "canonical_commerce_order_items",
    aliases: ["quantity sold", "units"],
  },
  distinct_product_count: {
    id: "distinct_product_count", entity: "items", aggregation: "count",
    dimensions: ITEM_DIMS, filters: ITEM_DIMS,
    nullZero: "zero", authority: "canonical_commerce_order_items",
    aliases: ["distinct products", "unique products", "only one product"],
  },
  basket_item_count: {
    id: "basket_item_count", entity: "orders", aggregation: "mean",
    dimensions: ORDER_DIMS, filters: ORDER_DIMS,
    nullZero: "zero", authority: "canonical_commerce_order_items",
    aliases: ["basket size", "items per check", "average basket"],
  },
  gross_check: {
    id: "gross_check", entity: "orders", aggregation: "sum",
    dimensions: ORDER_DIMS, filters: ORDER_DIMS,
    nullZero: "zero", authority: "canonical_commerce_orders",
    aliases: ["check total", "check amount"],
  },
  average_check: {
    id: "average_check", entity: "orders", aggregation: "mean",
    dimensions: ORDER_DIMS, filters: ORDER_DIMS,
    nullZero: "null if no orders", authority: "canonical_commerce_orders",
    aliases: ["average check", "avg check", "average spend", "mean check"],
  },
  average_spend_per_cover: {
    id: "average_spend_per_cover", entity: "orders", aggregation: "ratio",
    dimensions: ORDER_DIMS, filters: ORDER_DIMS,
    numerator: "net_sales", denominator: "covers",
    nullZero: "null if covers missing or zero", authority: "canonical_commerce_orders",
    aliases: ["spend per guest", "average spend per cover"],
  },
  attach_rate: {
    id: "attach_rate", entity: "orders", aggregation: "ratio",
    dimensions: ITEM_DIMS, filters: ITEM_DIMS,
    numerator: "orders_with_target_and_seed", denominator: "orders_with_seed",
    nullZero: "null if seed cohort empty", authority: "canonical_commerce_order_items",
    aliases: ["attach rate", "attachment"],
  },
  penetration_rate: {
    id: "penetration_rate", entity: "orders", aggregation: "ratio",
    dimensions: ITEM_DIMS, filters: ITEM_DIMS,
    numerator: "orders_with_product", denominator: "orders_in_cohort",
    nullZero: "null if cohort empty", authority: "canonical_commerce_order_items",
    aliases: ["penetration", "share of checks contain", "percentage of checks"],
  },
  cooccurrence_count: {
    id: "cooccurrence_count", entity: "items", aggregation: "count",
    dimensions: ["product"], filters: ITEM_DIMS,
    nullZero: "zero", authority: "canonical_commerce_order_items",
    aliases: ["ordered with", "together", "alongside", "combinations"],
  },
  cooccurrence_rate: {
    id: "cooccurrence_rate", entity: "items", aggregation: "ratio",
    dimensions: ["product"], filters: ITEM_DIMS,
    numerator: "orders_with_both", denominator: "orders_with_seed",
    nullZero: "null if seed empty", authority: "canonical_commerce_order_items",
    aliases: ["how often together", "pair rate"],
  },
  category_share: {
    id: "category_share", entity: "items", aggregation: "ratio",
    dimensions: ["category"], filters: ITEM_DIMS,
    numerator: "category_quantity", denominator: "total_quantity",
    nullZero: "null if no items", authority: "canonical_commerce_order_items",
    aliases: ["category share", "family share"],
  },
  conversion_rate: {
    id: "conversion_rate", entity: "sessions", aggregation: "ratio",
    dimensions: SESSION_DIMS, filters: SESSION_DIMS,
    numerator: "food_and_dessert_sessions", denominator: "food_containing_sessions",
    nullZero: "null if no food sessions", authority: "canonical_commerce_sessions",
    aliases: ["dessert conversion", "dessert attach rate on food"],
  },
  frequency: {
    id: "frequency", entity: "items", aggregation: "count",
    dimensions: ITEM_DIMS, filters: ITEM_DIMS,
    nullZero: "zero", authority: "canonical_commerce_order_items",
    aliases: ["how often", "frequency"],
  },
  revenue: {
    id: "revenue", entity: "items", aggregation: "sum",
    dimensions: ITEM_DIMS, filters: ITEM_DIMS,
    nullZero: "zero", authority: "canonical_commerce_order_items",
    aliases: ["item revenue", "line sales"],
  },
  quantity: {
    id: "quantity", entity: "items", aggregation: "sum",
    dimensions: ITEM_DIMS, filters: ITEM_DIMS,
    nullZero: "zero", authority: "canonical_commerce_order_items",
    aliases: ["qty"],
  },
  average_quantity: {
    id: "average_quantity", entity: "items", aggregation: "mean",
    dimensions: ITEM_DIMS, filters: ITEM_DIMS,
    nullZero: "null if empty", authority: "canonical_commerce_order_items",
    aliases: ["average quantity"],
  },
  median_check: {
    id: "median_check", entity: "orders", aggregation: "median",
    dimensions: ORDER_DIMS, filters: ORDER_DIMS,
    nullZero: "null if empty", authority: "canonical_commerce_orders",
    aliases: ["median check"],
  },
  high_spend_share: {
    id: "high_spend_share", entity: "orders", aggregation: "ratio",
    dimensions: ORDER_DIMS, filters: ORDER_DIMS,
    numerator: "orders_above_threshold", denominator: "orders",
    nullZero: "null if empty", authority: "canonical_commerce_orders",
    aliases: ["high-spend share"],
  },
  mapping_coverage: {
    id: "mapping_coverage", entity: "items", aggregation: "ratio",
    dimensions: ["mapped"], filters: ITEM_DIMS,
    numerator: "mapped_item_rows", denominator: "item_rows",
    nullZero: "null if no items", authority: "canonical_commerce_order_items",
    aliases: ["mapping coverage"],
  },
  unclassified_share: {
    id: "unclassified_share", entity: "sessions", aggregation: "ratio",
    dimensions: ["archetype"], filters: SESSION_DIMS,
    numerator: "unclassified_sessions", denominator: "sessions",
    nullZero: "null if no sessions", authority: "canonical_commerce_sessions",
    aliases: ["unclassified share"],
  },
  lift_vs_baseline: {
    id: "lift_vs_baseline", entity: "items", aggregation: "ratio",
    dimensions: ["product"], filters: ITEM_DIMS,
    numerator: "cohort_penetration", denominator: "baseline_penetration",
    nullZero: "null if baseline zero", authority: "canonical_commerce_order_items",
    aliases: ["lift", "disproportionately", "associated with"],
  },
};

export const ALLOWED_DIMENSIONS = [
  "branch", "date", "period", "weekday", "weekend", "daypart", "hour",
  "status", "order_type", "product", "category", "section", "archetype",
  "guest_band", "spend_band", "basket_band", "mapped",
  "food_presence", "dessert_presence", "coffee_presence",
] as const;

export type SemanticDimensionId = (typeof ALLOWED_DIMENSIONS)[number];

export function metricByAlias(text: string): SemanticMetricId | null {
  const q = String(text || "").toLowerCase();
  let best: { id: SemanticMetricId; len: number } | null = null;
  for (const def of Object.values(COMMERCE_METRIC_REGISTRY)) {
    for (const alias of def.aliases) {
      if (q.includes(alias) && alias.length >= (best?.len || 0)) {
        best = { id: def.id, len: alias.length };
      }
    }
  }
  return best?.id || null;
}
