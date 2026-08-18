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
  categoryMix,
  contributionToSpend,
  distinctProductCount,
    filterOrders,
    guestBand,
    itemsByOrder,
    matchesWeekend,
    mean,
  median,
  orderHasFamily,
  percentile,
  productLift,
  rankProducts,
  ratio,
  shareChange,
  spendBuckets,
  strongestPairs,
  type SemanticItem,
  type SemanticOrder,
  type SemanticSession,
} from "./operators.ts";
import { asCalendarDate, clampInclusiveCompleted } from "./period.ts";

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
  evidenceStrength?: "strong_direct" | "strong_derived" | "directional" | "unavailable";
  diagnostic?: Record<string, unknown> | null;
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

function filterList(plan: CommerceQueryPlan): CommerceQueryPlan["filters"] {
  return Array.isArray(plan.filters) ? plan.filters : [];
}

function splitWeekendWeekday(plan: CommerceQueryPlan): boolean {
  return plan.cohort?.kind === "weekend" && plan.compareCohort?.kind === "weekday";
}

/** Presence of a weekend eq-filter means weekend-only unless explicitly false. Cohort kind is a second source. */
function weekendFlagFromPlan(plan: CommerceQueryPlan): boolean | null {
  if (splitWeekendWeekday(plan)) return null;
  const weekend = filterList(plan).find((f) => f.field === "weekend");
  if (weekend) {
    if (weekend.value === false || weekend.value === "false" || weekend.value === 0) return false;
    return true;
  }
  if (plan.cohort?.kind === "weekend") return true;
  if (plan.cohort?.kind === "weekday") return false;
  return null;
}

function hourGteFromPlan(plan: CommerceQueryPlan): number | null {
  const hour = filterList(plan).find((f) => f.field === "hour" && f.op === "gte");
  if (hour != null && hour.value != null && Number.isFinite(Number(hour.value))) return Number(hour.value);
  if (plan.cohort?.kind === "hour_gte" && plan.cohort.value != null) return Number(plan.cohort.value);
  return null;
}

function filtersFromPlan(plan: CommerceQueryPlan) {
  const status = filterList(plan).find((f) => f.field === "status");
  const orderType = filterList(plan).find((f) => f.field === "order_type");
  const family = filterList(plan).find((f) => f.field === "family");
  return {
    hourGte: hourGteFromPlan(plan),
    weekend: weekendFlagFromPlan(plan),
    status: status ? (status.value as string | string[]) : (plan.metric === "completed_order_count" ? "completed" : null),
    orderType: orderType ? String(orderType.value) : null,
    family: family ? String(family.value) : (plan.targetFamily && plan.outputIntent === "ranking" ? plan.targetFamily : null),
  };
}

function constrainedPopulation(
  plan: CommerceQueryPlan,
  cohort: SemanticOrder[],
  filtered: SemanticOrder[],
): SemanticOrder[] {
  const kind = plan.cohort?.kind;
  if (kind && ["weekend", "weekday", "hour_gte", "hour_lt", "has_family", "contains_product"].includes(kind)) {
    return cohort;
  }
  return cohort.length && plan.cohort ? cohort : filtered;
}

function bothCohorts(orders: SemanticOrder[], itemsBy: Map<string, SemanticItem[]>, plan: CommerceQueryPlan) {
  let a = applyCohort(orders, itemsBy, plan.cohort);
  if (
    plan.seedProduct
    && (plan.calculation === "cooccurrence" || plan.calculation === "lift")
    && plan.cohort?.kind !== "contains_product"
  ) {
    a = applyCohort(a, itemsBy, { kind: "contains_product", value: plan.seedProduct });
  }
  let b = orders;
  if (plan.compareCohort) b = applyCohort(orders, itemsBy, plan.compareCohort);
  else if (plan.cohort?.kind === "has_family" && plan.calculation === "cohort_compare") {
    b = applyCohort(orders, itemsBy, { kind: "not_has_family", value: plan.cohort.value });
  } else if (plan.cohort?.kind === "weekend" && plan.compareCohort?.kind === "weekday") {
    b = applyCohort(orders, itemsBy, { kind: "weekday" });
  }
  if (
    plan.cohort?.kind === "has_family"
    && plan.compareCohort?.kind === "not_has_family"
    && String(plan.cohort.value) !== String(plan.compareCohort.value)
  ) {
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
  let start = asCalendarDate(input.plan.period?.startDate) || input.plan.period?.startDate || coverage?.startDate || "";
  let end = asCalendarDate(input.plan.period?.endDate) || input.plan.period?.endDate || coverage?.endDate || "";
  start = asCalendarDate(start) || start;
  end = asCalendarDate(end) || end;
  const covStart = asCalendarDate(coverage?.startDate) || coverage?.startDate;
  const covEnd = asCalendarDate(coverage?.endDate) || coverage?.endDate;
  if (covStart && end && end < covStart) {
    return {
      ok: false,
      limitation: `Canonical commerce for ${branchId} starts ${covStart}. ${start}–${end} is before ingested coverage.`,
      coverage,
      evidenceStrength: "unavailable",
      debug: debug(input.plan, started, branchId, 0, 0, { startDate: start, endDate: end }),
    };
  }
  const completed = clampInclusiveCompleted({
    startDate: start,
    endDate: end,
    coverageStart: covStart,
    coverageEnd: covEnd,
  });
  if (completed.beforeCoverage || completed.startDate > completed.endDate) {
    return {
      ok: false,
      limitation: `Canonical commerce for ${branchId} does not cover ${start}–${end}. Coverage is ${covStart || "unknown"}–${covEnd || "unknown"}.`,
      coverage,
      evidenceStrength: "unavailable",
      debug: debug(input.plan, started, branchId, 0, 0, { startDate: start, endDate: end }),
    };
  }
  start = completed.startDate;
  end = completed.endDate;
  const clamped = clampPeriod(start, end);
  start = clamped.startDate;
  end = clamped.endDate;

  const ordersRaw = await input.store.fetchOrders({ branchId, startDate: start, endDate: end });
  const itemsRaw = await input.store.fetchItems({ branchId, startDate: start, endDate: end });
  if (!ordersRaw.length) {
    return fail(
      `Canonical order-level commerce is not available for ${branchId} in ${start}–${end}.`,
      input.plan,
      started,
      branchId,
      coverage,
    );
  }
  const orders = ordersRaw.slice(0, COMMERCE_EXEC_LIMITS.maxOrders).map((o) => ({
    ...o,
    business_date: asCalendarDate(o.business_date) || String(o.business_date).slice(0, 10),
  }));
  const items = itemsRaw.slice(0, COMMERCE_EXEC_LIMITS.maxItems).map((i) => ({
    ...i,
    business_date: asCalendarDate(i.business_date) || String(i.business_date).slice(0, 10),
  }));
  const itemsBy = itemsByOrder(items);
  const filt = filtersFromPlan(input.plan);
  if (
    filt.weekend == null
    && !splitWeekendWeekday(input.plan)
    && (
      (Array.isArray(input.plan.filters) && input.plan.filters.some((f) => f.field === "weekend" && f.value !== false))
      || input.plan.cohort?.kind === "weekend"
    )
  ) {
    filt.weekend = true;
  }
  let filtered = filterOrders(orders, itemsBy, filt);
  if (filt.weekend != null) {
    filtered = filtered.filter((order) =>
      matchesWeekend(String(order.business_date).slice(0, 10), Boolean(filt.weekend))
    );
  }
  const { a: cohort, b: baseline } = bothCohorts(filtered, itemsBy, input.plan);
  const mappingUnclass = items.filter((i) => i.canonical_category === "unclassified").length;
  let mappingNote = items.length && mappingUnclass / items.length > 0.15
    ? `Item mapping: ${((1 - mappingUnclass / items.length) * 100).toFixed(0)}% of item rows have a classified family.`
    : null;
  if (filt.weekend != null) {
    const note = `Weekend (Fri–Sat) constraint kept ${filtered.length} of ${orders.length} checks.`;
    mappingNote = mappingNote ? `${mappingNote} ${note}` : note;
  }

  const limit = Math.min(input.plan.ranking?.limit || 10, COMMERCE_EXEC_LIMITS.maxRanking);
  const calc = input.plan.calculation || "none";
  const mappingPct = items.length ? 1 - mappingUnclass / items.length : 1;
  const evidenceStrength: SemanticExecResult["evidenceStrength"] = !filtered.length
    ? "unavailable"
    : mappingPct < 0.7 || (cohort.length > 0 && cohort.length < 20)
      ? "directional"
      : (calc === "none" || calc === "penetration" || calc === "percentile" || calc === "spend_buckets")
        ? "strong_direct"
        : "strong_derived";

  let prevOrders: SemanticOrder[] = [];
  let prevItemsBy = itemsBy;
  if ((calc === "share_change" || calc === "diagnostic") && input.plan.compare?.startDate && input.plan.compare.endDate) {
    const prevClamp = clampInclusiveCompleted({
      startDate: input.plan.compare.startDate,
      endDate: input.plan.compare.endDate,
      coverageStart: covStart,
      coverageEnd: covEnd,
    });
    if (!prevClamp.beforeCoverage && prevClamp.startDate <= prevClamp.endDate) {
      const pOrders = await input.store.fetchOrders({ branchId, startDate: prevClamp.startDate, endDate: prevClamp.endDate });
      const pItems = await input.store.fetchItems({ branchId, startDate: prevClamp.startDate, endDate: prevClamp.endDate });
      prevOrders = filterOrders(
        pOrders.slice(0, COMMERCE_EXEC_LIMITS.maxOrders).map((o) => ({ ...o, business_date: asCalendarDate(o.business_date) || String(o.business_date).slice(0, 10) })),
        itemsByOrder(pItems.slice(0, COMMERCE_EXEC_LIMITS.maxItems)),
        filt,
      );
      prevItemsBy = itemsByOrder(pItems.slice(0, COMMERCE_EXEC_LIMITS.maxItems).map((i) => ({
        ...i,
        business_date: asCalendarDate(i.business_date) || String(i.business_date).slice(0, 10),
      })));
    }
  }

  if (calc === "cooccurrence") {
    const ranked = rankProducts(cohort, itemsBy, {
      excludeName: input.plan.seedProduct,
      family: filt.family,
      limit,
      mode: "orders",
    });
    const withLift = productLift(cohort, filtered, itemsBy, limit, {
      family: filt.family,
      excludeName: input.plan.seedProduct,
    }).filter((r) =>
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
    const ranked = productLift(cohort.length ? cohort : filtered, filtered, itemsBy, limit, {
      family: filt.family,
      excludeName: input.plan.seedProduct,
    });
    return ok({ ranking: ranked, cohortSize: (cohort.length ? cohort : filtered).length, baselineSize: filtered.length });
  }

  if (calc === "contribution") {
    const ranked = contributionToSpend(cohort.length ? cohort : filtered, baseline.length ? baseline : filtered, itemsBy, limit);
    return ok({ ranking: ranked, cohortSize: (cohort.length ? cohort : filtered).length, baselineSize: (baseline.length ? baseline : filtered).length });
  }

  if (calc === "share_change") {
    if (!prevOrders.length) {
      return fail(
        `No comparable canonical commerce coverage exists for ${input.plan.compare?.label || input.plan.compare?.startDate || "the baseline period"}. Share-change is not estimated without an aligned baseline.`,
        input.plan,
        started,
        branchId,
        coverage,
      );
    }
    const ranked = shareChange(filtered, prevOrders, itemsBy, prevItemsBy, limit, { family: filt.family });
    return ok({ ranking: ranked, cohortSize: filtered.length, baselineSize: prevOrders.length || baseline.length });
  }

  if (calc === "spend_buckets") {
    const ranking = spendBuckets(filtered);
    return ok({ ranking, cohortSize: filtered.length, unit: "rate" });
  }

  if (calc === "percentile") {
    const vals = filtered.map((o) => Number(o.net_sales) || 0);
    return ok({
      value: median(vals),
      unit: "SAR",
      label: "median check",
      ranking: [
        { name: "median", net_sales: median(vals) },
        { name: "p90", net_sales: percentile(vals, 90) },
      ],
      cohortSize: filtered.length,
    });
  }

  if (calc === "pairs") {
    return ok({ ranking: strongestPairs(cohort.length ? cohort : filtered, itemsBy, limit), cohortSize: (cohort.length ? cohort : filtered).length });
  }

  if (calc === "diagnostic") {
    const scoped = constrainedPopulation(input.plan, cohort, filtered);
    const vals = scoped.map((o) => Number(o.net_sales) || 0);
    const movers = prevOrders.length
      ? shareChange(scoped, prevOrders, itemsBy, prevItemsBy, 5, { family: filt.family })
      : productLift(applyCohort(scoped, itemsBy, { kind: "spend_gt", value: 300 }), scoped, itemsBy, 5, { family: filt.family });
    const mix = categoryMix(scoped, itemsBy);
    const buckets = spendBuckets(scoped);
    const dessert = scoped.filter((o) => orderHasFamily(itemsBy.get(o.source_order_id) || [], "dessert")).length;
    const food = scoped.filter((o) => orderHasFamily(itemsBy.get(o.source_order_id) || [], "food")).length;
    return ok({
      diagnostic: {
        orders: scoped.length,
        averageCheck: mean(vals),
        medianCheck: median(vals),
        p90Check: percentile(vals, 90),
        basketSize: mean(scoped.map((o) => basketQty(itemsBy.get(o.source_order_id) || []))),
        covers: scoped.reduce((s, o) => s + (Number(o.covers) || 0), 0),
        highSpendShare: ratio(scoped.filter((o) => (Number(o.net_sales) || 0) > 300).length, scoped.length),
        dessertShare: ratio(dessert, scoped.length),
        foodShare: ratio(food, scoped.length),
        mix: mix.slice(0, 5),
        buckets,
        movers: movers.slice(0, 5),
      },
      cohortSize: scoped.length,
      ranking: movers.slice(0, 5),
    });
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

  const scoped = constrainedPopulation(input.plan, cohort, filtered);
  const value = metricOver(scoped, itemsBy, input.plan.metric);
  return ok({
    value,
    unit: unitFor(input.plan.metric),
    cohortSize: scoped.length,
    denominator: filtered.length,
  });

  function ok(extra: Partial<SemanticExecResult>): SemanticExecResult {
    return {
      ok: true,
      mappingNote,
      coverage,
      evidenceStrength,
      debug: debug(input.plan, started, branchId, orders.length, items.length, { startDate: start, endDate: end }),
      ...extra,
      evidenceStrength: extra.evidenceStrength || evidenceStrength,
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
  if (kind === "covers_between") return `${value} guest checks`;
  if (kind === "covers_gte") return `${value}+ guest checks`;
  if (kind === "covers_lte") return `${value} or fewer guest checks`;
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

