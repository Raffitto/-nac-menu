/**
 * Structured commerce query-plan DSL. Planner emits this; executor runs it.
 * No LLM-authored SQL.
 */

import { ALLOWED_DIMENSIONS, COMMERCE_METRIC_REGISTRY, type SemanticMetricId } from "./metrics.ts";
import { getSemanticField } from "./model.ts";

export type CommerceFilterOp = "eq" | "neq" | "gte" | "lte" | "gt" | "in" | "contains" | "exists" | "not_exists";

export type CommercePlanFilter = {
  field: string;
  op: CommerceFilterOp;
  value?: string | number | boolean | Array<string | number>;
};

export type CommerceCohort = {
  kind:
    | "contains_product"
    | "not_contains_product"
    | "spend_gt"
    | "spend_gte"
    | "covers_gte"
    | "covers_lte"
    | "basket_eq"
    | "basket_gt"
    | "basket_gte"
    | "distinct_gte"
    | "has_family"
    | "not_has_family"
    | "archetype"
    | "weekend"
    | "weekday"
    | "hour_gte"
    | "hour_lt"
    | "status";
  value?: string | number;
};

export type CommerceQueryPlan = {
  domain: "commerce";
  entity: "orders" | "items" | "sessions" | "products";
  metric: SemanticMetricId;
  dimensions: string[];
  filters: CommercePlanFilter[];
  period: { startDate: string; endDate: string; label?: string | null } | null;
  compare?: { startDate: string; endDate: string; label?: string | null } | null;
  ranking?: { direction: "desc" | "asc"; limit: number };
  cohort?: CommerceCohort | null;
  compareCohort?: CommerceCohort | null;
  calculation?: "none" | "cooccurrence" | "attach_rate" | "penetration" | "lift" | "cohort_compare" | "distribution";
  outputIntent: "value" | "ranking" | "comparison" | "diagnostic" | "distribution" | "limitation";
  seedProduct?: string | null;
  targetFamily?: "food" | "dessert" | "coffee" | "other_beverage" | null;
  unavailable?: { field: string; reason: string } | null;
};

export type PlanValidation =
  | { ok: true; plan: CommerceQueryPlan }
  | { ok: false; reason: string; field?: string; plan?: CommerceQueryPlan };

const ALLOWED_DIM = new Set<string>(ALLOWED_DIMENSIONS);

export function validateCommercePlan(plan: CommerceQueryPlan): PlanValidation {
  if (plan.domain !== "commerce") {
    return { ok: false, reason: "Plan domain must be commerce.", plan };
  }
  if (plan.unavailable) {
    return { ok: false, reason: plan.unavailable.reason, field: plan.unavailable.field, plan };
  }
  const metric = COMMERCE_METRIC_REGISTRY[plan.metric];
  if (!metric) {
    return { ok: false, reason: `Unknown metric '${plan.metric}'.`, field: plan.metric, plan };
  }
  for (const dim of plan.dimensions || []) {
    if (!ALLOWED_DIM.has(dim)) {
      return { ok: false, reason: `Unknown dimension '${dim}'.`, field: dim, plan };
    }
  }
  for (const filter of plan.filters || []) {
    if (filter.field === "physical_table_number" || filter.field === "table_id" || filter.field === "item_moved" || filter.field === "creator") {
      const spec = getSemanticField(filter.field);
      return {
        ok: false,
        reason: spec?.notes || `Field '${filter.field}' is not available.`,
        field: filter.field,
        plan,
      };
    }
    if (!ALLOWED_DIM.has(filter.field) && !getSemanticField(filter.field) && !["product", "hour", "guests", "spend", "basket", "family", "mapped"].includes(filter.field)) {
      return { ok: false, reason: `Unknown filter field '${filter.field}'.`, field: filter.field, plan };
    }
  }
  if (plan.period) {
    if (plan.period.startDate > plan.period.endDate) {
      return { ok: false, reason: "Period start is after period end.", plan };
    }
  }
  return { ok: true, plan };
}
