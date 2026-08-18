/**
 * Bounded deterministic execution of a validated commerce plan.
 * Parameterized store access only — no LLM SQL.
 */

import type { IntelligenceScope } from "../../scope.ts";
import { assertBranchScopePreserved } from "../../scope.ts";
import type { CommerceQueryPlan } from "./plan.ts";
import {
  applyCohort,
  basketQty,
  distinctProductCount,
  filterOrders,
  guestBand,
  itemsByOrder,
  mean,
  median,
  orderHasFamily,
  productLift,
  rankProducts,
  ratio,
  type SemanticItem,
  type SemanticOrder,
  type SemanticSession,
} from "./operators.ts";

export const COMMERCE_EXEC_LIMITS = {
  maxRangeDays: 62,
  maxOrders: 20000,
  maxItems: 80000,
  maxRanking: 25,
  timeoutMs: 8000,
};

export type CommerceCoverage = {
  branchId: string;
  startDate: string | null;
  endDate: string | null;
  ordersStatus?: string | null;
  itemsStatus?: string | null;
  mappingQuality?: number | null;
};

export type CommerceStore = {
  fetchOrders: (q: { branchId: string; startDate: string; endDate: string }) => Promise<SemanticOrder[]>;
  fetchItems: (q: { branchId: string; startDate: string; endDate: string }) => Promise<SemanticItem[]>;
  fetchSessions?: (q: { branchId: string; startDate: string; endDate: string }) => Promise<SemanticSession[]>;
  fetchCoverage?: (branchId: string) => Promise<CommerceCoverage | null>;
};

export type SemanticExecResult = {
  ok: boolean;
  limitation?: string | null;
  value?: number | null;
  unit?: string | null;
  label?: string | null;
  ranking?: Array<Record<string, unknown>>;
  comparison?: { aLabel: string; aValue: number | null; bLabel: string; bValue: number | null; delta: number | null; causal: false };
  cohortSize?: number;
  baselineSize?: number;
  numerator?: number | null;
  denominator?: number | null;
  coverage?: CommerceCoverage | null;
  mappingNote?: string | null;
  debug: {
    planMetric: string;
    calculation: string | null;
    orderRows: number;
    itemRows: number;
    elapsedMs: number;
    branchId: string;
    period: { startDate: string; endDate: string } | null;
  };
};

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
}

function clampPeriod(start: string, end: string): { startDate: string; endDate: string; clamped: boolean } {
  if (daysBetween(start, end) <= COMMERCE_EXEC_LIMITS.maxRangeDays) {
    return { startDate: start, endDate: end, clamped: false };
  }
  const endMs = Date.parse(`${end}T00:00:00Z`);
  const startMs = endMs - (COMMERCE_EXEC_LIMITS.maxRangeDays - 1) * 86400000;
  return { startDate: new Date(startMs).toISOString().slice(0, 10), endDate: end, clamped: true };
}

function filtersFromPlan(plan: CommerceQueryPlan) {
  const hour = plan.filters.find((f) => f.field === "hour" && f.op === "gte");
  const weekend = plan.filters.find((f) => f.field === "weekend");
  const status = plan.filters.find((f) => f.field === "status");
  const orderType = plan.filters.find((f) => f.field === "order_type");
  const family = plan.filters.find((f) => f.field === "family");
  return {
    hourGte: hour ? Number(hour.value) : null,
    weekend: weekend ? Boolean(weekend.value) : null,
    status: status ? (status.value as string | string[]) : (plan.metric === "completed_order_count" ? "completed" : null),
    orderType: orderType ? String(orderType.value) : null,
    family: family ? String(family.value) : (plan.targetFamily && plan.outputIntent === "ranking" ? plan.targetFamily : null),
  };
}

function bothCohorts(orders: SemanticOrder[], itemsBy: Map<string, SemanticItem[]>, plan: CommerceQueryPlan) {
  const a = applyCohort(orders, itemsBy, plan.cohort);
  let b = orders;
  if (plan.compareCohort) b = applyCohort(orders, itemsBy, plan.compareCohort);
  else if (plan.cohort?.kind === "has_family" && plan.calculation === "cohort_compare") {
    b = applyCohort(orders, itemsBy, { kind: "not_has_family", value: plan.cohort.value });
  } else if (plan.cohort?.kind === "weekend" && plan.compareCohort?.kind === "weekday") {
    b = applyCohort(orders, itemsBy, { kind: "weekday" });
  }
  if (plan.cohort?.kind === "has_family" && plan.compareCohort?.kind === "not_has_family") {
    return {
      a: a.filter((o) => {
        const basket = itemsBy.get(o.source_order_id) || [];
        return !orderHasFamily(basket, String(plan.compareCohort?.value));
      }),
      b,
    };
  }
  return { a, b };
}

export async function executeCommercePlan(input: {
  plan: CommerceQueryPlan;
  store: CommerceStore;
  scope: IntelligenceScope;
  coverageHint?: CommerceCoverage | null;
}): Promise<SemanticExecResult> {
  const started = Date.now();
  const branchId = input.scope.primaryBranchId;
  if (!branchId) {
    return fail("Branch scope is required for commerce queries.", input.plan, started, "", null);
  }
  const scopeOk = assertBranchScopePreserved(input.scope, branchId);
  if (!scopeOk.ok) {
    return fail(`RBAC blocked commerce query: ${scopeOk.reason}`, input.plan, started, branchId, null);
  }
  if (!input.scope.access.canSeeNetwork && !input.scope.access.allowedBranchIds.includes(branchId)) {
    return fail("Your access does not include this branch.", input.plan, started, branchId, null);
  }
  if (input.plan.unavailable) {
    return {
      ok: false,
      limitation: input.plan.unavailable.reason,
      debug: debug(input.plan, started, branchId, 0, 0, input.plan.period),
    };
  }

  const coverage = input.coverageHint || (input.store.fetchCoverage ? await input.store.fetchCoverage(branchId) : null);
  if (!input.plan.period) {
    if (!coverage?.startDate || !coverage?.endDate) {
      return fail("Canonical commerce coverage is unknown for this branch.", input.plan, started, branchId, coverage);
    }
  }
  let start = input.plan.period?.startDate || coverage?.startDate || "";
  let end = input.plan.period?.endDate || coverage?.endDate || "";
  if (coverage?.startDate && start < coverage.startDate) {
    return {
      ok: false,
      limitation: `Canonical commerce for ${branchId} starts ${coverage.startDate}. ${start} is before ingested coverage.`,
      coverage,
      debug: debug(input.plan, started, branchId, 0, 0, { startDate: start, endDate: end }),
    };
  }
  if (coverage?.endDate && end > coverage.endDate) {
    end = coverage.endDate;
  }
  const clamped = clampPeriod(start, end);
  start = clamped.startDate;
  end = clamped.endDate;

  const ordersRaw = await input.store.fetchOrders({ branchId, startDate: start, endDate: end });
  const itemsRaw = await input.store.fetchItems({ branchId, startDate: start, endDate: end });
  const orders = ordersRaw.slice(0, COMMERCE_EXEC_LIMITS.maxOrders);
  const items = itemsRaw.slice(0, COMMERCE_EXEC_LIMITS.maxItems);
  const itemsBy = itemsByOrder(items);
  const filt = filtersFromPlan(input.plan);
  const filtered = filterOrders(orders, itemsBy, filt);
  const { a: cohort, b: baseline } = bothCohorts(filtered, itemsBy, input.plan);
  const mappingUnclass = items.filter((i) => i.canonical_category === "unclassified").length;
  const mappingNote = items.length && mappingUnclass / items.length > 0.15
    ? `Item mapping: ${((1 - mappingUnclass / items.length) * 100).toFixed(0)}% of item rows have a classified family.`
    : null;

  const limit = Math.min(input.plan.ranking?.limit || 10, COMMERCE_EXEC_LIMITS.maxRanking);
  const calc = input.plan.calculation || "none";

  if (calc === "cooccurrence") {
    const ranked = rankProducts(cohort, itemsBy, {
      excludeName: input.plan.seedProduct,
      family: filt.family,
      limit,
      mode: "orders",
    });
    const withLift = productLift(cohort, filtered, itemsBy, limit).filter((r) =>
      !input.plan.seedProduct || r.name.toLowerCase() !== String(input.plan.seedProduct).toLowerCase(),
    );
    return ok({
      ranking: withLift.length ? withLift : ranked,
      cohortSize: cohort.length,
      baselineSize: filtered.length,
      value: cohort.length,
      label: input.plan.seedProduct ? `Orders containing ${input.plan.seedProduct}` : "Cohort orders",
    });
  }

  if (calc === "lift") {
    const ranked = productLift(cohort, filtered, itemsBy, limit);
    return ok({ ranking: ranked, cohortSize: cohort.length, baselineSize: filtered.length });
  }

  if (calc === "attach_rate" && input.plan.entity === "sessions") {
    const food = filtered.filter((o) => orderHasFamily(itemsBy.get(o.source_order_id) || [], "food"));
    const both = food.filter((o) => orderHasFamily(itemsBy.get(o.source_order_id) || [], "dessert"));
    return ok({
      value: ratio(both.length, food.length),
      unit: "rate",
      numerator: both.length,
      denominator: food.length,
      label: "Dessert attach rate on food-containing checks",
      cohortSize: food.length,
    });
  }

  if (calc === "attach_rate" || (calc === "penetration" && input.plan.outputIntent === "ranking")) {
    const ranked = rankProducts(cohort.length ? cohort : filtered, itemsBy, {
      family: filt.family,
      limit,
      mode: "orders",
    });
    return ok({ ranking: ranked, cohortSize: (cohort.length ? cohort : filtered).length });
  }

  if (calc === "penetration" && input.plan.outputIntent === "value") {
    const den = filtered.length;
    const num = cohort.length;
    return ok({
      value: ratio(num, den),
      unit: "rate",
      numerator: num,
      denominator: den,
      label: "Share of checks",
      cohortSize: num,
    });
  }

  if (calc === "cohort_compare") {
    const metricA = metricOver(cohort, itemsBy, input.plan.metric);
    const metricB = metricOver(baseline, itemsBy, input.plan.metric);
    return ok({
      comparison: {
        aLabel: labelCohort(input.plan.cohort?.kind, input.plan.cohort?.value),
        aValue: metricA,
        bLabel: labelCohort(input.plan.compareCohort?.kind, input.plan.compareCohort?.value),
        bValue: metricB,
        delta: metricA != null && metricB != null ? metricA - metricB : null,
        causal: false,
      },
      cohortSize: cohort.length,
      baselineSize: baseline.length,
    });
  }

  if (calc === "distribution" && input.plan.dimensions.includes("guest_band")) {
    const bands = new Map<string, number[]>();
    for (const order of filtered) {
      const band = guestBand(order.covers);
      const list = bands.get(band) || [];
      list.push(Number(order.net_sales) || 0);
      bands.set(band, list);
    }
    const ranking = [...bands.entries()].map(([name, vals]) => ({
      name,
      orders: vals.length,
      average_check: mean(vals),
    }));
    return ok({ ranking, output: "distribution", cohortSize: filtered.length } as SemanticExecResult & { output?: string });
  }

  if (input.plan.outputIntent === "ranking" && input.plan.entity === "orders") {
    const ranked = [...(cohort.length ? cohort : filtered)]
      .sort((a, b) => (Number(b.net_sales) || 0) - (Number(a.net_sales) || 0))
      .slice(0, limit)
      .map((o) => ({
        source_order_id: o.source_order_id,
        business_date: o.business_date,
        net_sales: Number(o.net_sales) || 0,
        covers: o.covers,
      }));
    return ok({ ranking: ranked, cohortSize: ranked.length });
  }

  if (input.plan.outputIntent === "ranking" && input.plan.entity === "items") {
    const ranked = rankProducts(cohort.length ? cohort : filtered, itemsBy, {
      family: filt.family,
      limit,
      mode: input.plan.metric === "revenue" ? "revenue" : "quantity",
    });
    return ok({ ranking: ranked, cohortSize: (cohort.length ? cohort : filtered).length });
  }

  if (input.plan.metric === "open_order_count") {
    const n = filtered.filter((o) => o.status === "open").length;
    return ok({ value: n, unit: "orders", label: "Open/Joined orders", cohortSize: n });
  }

  if (input.plan.cohort?.kind === "has_family" && input.plan.compareCohort?.kind === "not_has_family") {
    return ok({
      value: cohort.length,
      unit: "orders",
      label: "Qualifying checks",
      cohortSize: cohort.length,
      denominator: filtered.length,
    });
  }

  const value = metricOver(cohort.length && input.plan.cohort ? cohort : filtered, itemsBy, input.plan.metric);
  return ok({
    value,
    unit: unitFor(input.plan.metric),
    cohortSize: (cohort.length && input.plan.cohort ? cohort : filtered).length,
    denominator: filtered.length,
  });

  function ok(extra: Partial<SemanticExecResult>): SemanticExecResult {
    return {
      ok: true,
      mappingNote,
      coverage,
      debug: debug(input.plan, started, branchId, orders.length, items.length, { startDate: start, endDate: end }),
      ...extra,
    };
  }
}

function metricOver(orders: SemanticOrder[], itemsBy: Map<string, SemanticItem[]>, metric: string): number | null {
  if (metric === "order_count" || metric === "completed_order_count" || metric === "session_count" || metric === "frequency") {
    return orders.length;
  }
  if (metric === "covers") {
    const vals = orders.map((o) => Number(o.covers)).filter((n) => Number.isFinite(n));
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  }
  if (metric === "average_check" || metric === "gross_check") {
    const vals = orders.map((o) => Number(o.net_sales)).filter((n) => Number.isFinite(n));
    return metric === "gross_check" ? vals.reduce((a, b) => a + b, 0) : mean(vals);
  }
  if (metric === "median_check") {
    return median(orders.map((o) => Number(o.net_sales) || 0));
  }
  if (metric === "basket_item_count") {
    return mean(orders.map((o) => basketQty(itemsBy.get(o.source_order_id) || [])));
  }
  if (metric === "average_spend_per_cover") {
    const sales = orders.reduce((s, o) => s + (Number(o.net_sales) || 0), 0);
    const covers = orders.reduce((s, o) => s + (Number(o.covers) || 0), 0);
    return ratio(sales, covers);
  }
  if (metric === "distinct_product_count") {
    return mean(orders.map((o) => distinctProductCount(itemsBy.get(o.source_order_id) || [])));
  }
  return orders.length;
}

function unitFor(metric: string): string {
  if (/rate|share|penetration|attach|conversion/.test(metric)) return "rate";
  if (/check|sales|revenue|spend/.test(metric)) return "SAR";
  if (/covers/.test(metric)) return "covers";
  return "count";
}

function labelCohort(kind?: string, value?: string | number): string {
  if (kind === "weekend") return "weekend (Fri–Sat)";
  if (kind === "weekday") return "weekday (Sun–Thu)";
  if (kind === "has_family") return `with ${value}`;
  if (kind === "not_has_family") return `without ${value}`;
  if (kind === "contains_product") return `containing ${value}`;
  if (kind === "spend_gt") return `checks > ${value} SAR`;
  return String(kind || "cohort");
}

function debug(plan: CommerceQueryPlan, started: number, branchId: string, orderRows: number, itemRows: number, period: { startDate: string; endDate: string } | null) {
  return {
    planMetric: plan.metric,
    calculation: plan.calculation || null,
    orderRows,
    itemRows,
    elapsedMs: Date.now() - started,
    branchId,
    period,
  };
}

function fail(limitation: string, plan: CommerceQueryPlan, started: number, branchId: string, coverage: CommerceCoverage | null): SemanticExecResult {
  return {
    ok: false,
    limitation,
    coverage,
    debug: debug(plan, started, branchId, 0, 0, plan.period),
  };
}

