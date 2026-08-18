/**
 * Canonical table-mix intelligence — single deterministic aggregator for
 * dine-in session archetypes, shares, conversion, and coverage diagnostics.
 * Cash Up remains headline sales; commerce revenue is session evidence only.
 */

import type { IntelligenceScope } from "../scope.ts";
import { assertBranchScopePreserved } from "../scope.ts";
import { buildEvidenceSummary } from "./lineage.ts";
import { joinRate } from "./idempotency.ts";
import {
  averageCheck,
  buildDineInSessions,
  compareServiceMix,
  summarizeServiceMix,
} from "./metrics.ts";
import { computeQuality, type CommerceQuality } from "./quality.ts";
import type { CommerceStore } from "./semantic/execute.ts";
import type { SemanticItem, SemanticOrder } from "./semantic/operators.ts";
import type {
  CanonicalOrder,
  CanonicalOrderItem,
  CommerceSource,
  MixComparison,
  ServiceMixResult,
  TableArchetype,
} from "./types.ts";

const ARCHETYPES: TableArchetype[] = [
  "dessert_only",
  "coffee_only",
  "dessert_and_coffee",
  "food_only",
  "food_and_beverage",
  "full_service",
  "beverage_only",
  "unclassified",
];

export type TableMixDiagnostics = {
  completedDineInOrders: number;
  orderItemRows: number;
  sessionsBuilt: number;
  orderItemJoinRate: number | null;
  unclassifiedSessionCount: number;
  unclassifiedSessionShare: number | null;
  unmappedItemRows: number;
  unmappedItemRowShare: number | null;
  quality: CommerceQuality;
  coverageComplete: boolean;
  limitation: string | null;
};

export type TableMixResult = {
  mix: ServiceMixResult;
  diagnostics: TableMixDiagnostics;
  averageCheckByArchetype: Partial<Record<TableArchetype, number | null>>;
  totalRevenue: number;
  comparison?: MixComparison | null;
  evidence?: ReturnType<typeof buildEvidenceSummary> | null;
};

export type TableMixPeriod = {
  startDate: string;
  endDate: string;
  label?: string | null;
};

export function orderFromSemantic(o: SemanticOrder, source: CommerceSource = "foodics"): CanonicalOrder {
  return {
    source,
    sourceOrderId: o.source_order_id,
    sourceRevision: "1",
    branchId: o.branch_id,
    businessDate: String(o.business_date).slice(0, 10),
    openedAt: o.opened_at,
    closedAt: o.closed_at,
    orderType: (o.order_type as CanonicalOrder["orderType"]) || "dine_in",
    tableId: o.table_id || null,
    covers: o.covers == null ? null : Number(o.covers),
    subtotal: o.subtotal == null ? null : Number(o.subtotal),
    discount: null,
    tax: o.tax == null ? null : Number(o.tax),
    netSales: o.net_sales == null ? null : Number(o.net_sales),
    status: (o.status as CanonicalOrder["status"]) || "completed",
    ingestedAt: new Date().toISOString(),
  };
}

export function itemFromSemantic(item: SemanticItem, source: CommerceSource = "foodics"): CanonicalOrderItem {
  return {
    source,
    sourceOrderId: item.source_order_id,
    sourceOrderItemId: item.source_order_item_id,
    branchId: item.branch_id,
    businessDate: String(item.business_date).slice(0, 10),
    productId: item.product_id,
    canonicalMenuItemId: item.canonical_menu_item_id,
    itemName: item.item_name,
    sourceCategory: null,
    canonicalCategory: (item.canonical_category as CanonicalOrderItem["canonicalCategory"]) || "unclassified",
    quantity: Number(item.quantity) || 0,
    grossAmount: null,
    discountAmount: null,
    netAmount: item.net_amount == null ? null : Number(item.net_amount),
    status: (item.status as CanonicalOrderItem["status"]) || "completed",
  };
}

function isMappedItem(item: CanonicalOrderItem): boolean {
  return Boolean(item.canonicalMenuItemId)
    || (item.canonicalCategory && item.canonicalCategory !== "unclassified");
}

function buildDiagnostics(
  dineInOrders: CanonicalOrder[],
  basket: CanonicalOrderItem[],
  mix: ServiceMixResult,
): TableMixDiagnostics {
  const join = dineInOrders.length ? joinRate(dineInOrders, basket) : null;
  const unmappedItemRows = basket.filter((i) => !isMappedItem(i)).length;
  const uniqueProducts = new Set(basket.map((i) => i.productId).filter(Boolean));
  const mappedProducts = new Set(
    basket.filter(isMappedItem).map((i) => i.productId).filter(Boolean),
  );
  const mappedItemRows = basket.length - unmappedItemRows;
  const revenue = basket.reduce((s, i) => s + Number(i.netAmount || 0), 0);
  const mappedRevenue = basket.filter(isMappedItem).reduce((s, i) => s + Number(i.netAmount || 0), 0);
  const quality = computeQuality({
    uniqueProducts: uniqueProducts.size,
    mappedProducts: mappedProducts.size,
    itemRows: basket.length,
    mappedItemRows,
    revenue,
    mappedRevenue,
    sessions: mix.totalSessions,
    unclassifiedSessions: mix.byArchetype.unclassified.sessions,
    joinPct: join,
  });
  const limitation = join != null && join < 0.9
    ? `Order–item join is ${(join * 100).toFixed(1)}%; archetype shares may be understated.`
    : (quality.unclassifiedSessionPct != null && quality.unclassifiedSessionPct > 0.15
      ? `${(quality.unclassifiedSessionPct * 100).toFixed(1)}% of sessions are unclassified.`
      : null);
  return {
    completedDineInOrders: dineInOrders.length,
    orderItemRows: basket.length,
    sessionsBuilt: mix.totalSessions,
    orderItemJoinRate: join,
    unclassifiedSessionCount: mix.byArchetype.unclassified.sessions,
    unclassifiedSessionShare: mix.unclassifiedRate,
    unmappedItemRows,
    unmappedItemRowShare: basket.length ? unmappedItemRows / basket.length : null,
    quality,
    coverageComplete: join != null && join >= 0.9 && (quality.unclassifiedSessionPct == null || quality.unclassifiedSessionPct < 0.35),
    limitation,
  };
}

function averageChecksByArchetype(mix: ServiceMixResult): Partial<Record<TableArchetype, number | null>> {
  const out: Partial<Record<TableArchetype, number | null>> = {};
  for (const key of ARCHETYPES) {
    out[key] = averageCheck(mix.byArchetype[key]);
  }
  return out;
}

function archetypeCountsSum(mix: ServiceMixResult): number {
  return ARCHETYPES.reduce((n, k) => n + mix.byArchetype[k].sessions, 0);
}

/** Deterministic table-mix from canonical order + item rows for one period. */
export function computeTableMix(input: {
  orders: CanonicalOrder[];
  items: CanonicalOrderItem[];
  branchId: string;
  periodStart: string;
  periodEnd: string;
  source?: CommerceSource;
  completedThrough?: string | null;
  lastIngestAt?: string | null;
  includeEvidence?: boolean;
}): TableMixResult {
  const dineIn = input.orders.filter((o) =>
    o.branchId === input.branchId
    && o.businessDate >= input.periodStart
    && o.businessDate <= input.periodEnd
    && o.orderType === "dine_in"
    && o.status === "completed");
  const dineIds = new Set(dineIn.map((o) => o.sourceOrderId));
  const basket = input.items.filter((i) => dineIds.has(i.sourceOrderId));
  const sessions = buildDineInSessions(dineIn, basket);
  const mix = summarizeServiceMix(sessions, {
    source: input.source || "foodics",
    branchId: input.branchId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    completedThrough: input.completedThrough || input.periodEnd,
    lastIngestAt: input.lastIngestAt || null,
  });
  const diagnostics = buildDiagnostics(dineIn, basket, mix);
  const totalRevenue = Object.values(mix.byArchetype).reduce((s, row) => s + row.netSales, 0);
  const evidence = input.includeEvidence !== false
    ? buildEvidenceSummary({
      dataThrough: input.completedThrough || input.periodEnd,
      sessionsAnalyzed: mix.totalSessions,
      mappingQuality: diagnostics.quality.confidentlyClassifiedSessionPct,
      quality: diagnostics.quality,
      sourceFreshness: diagnostics.coverageComplete ? "ready" : "warning",
      coverage: `${input.periodStart} to ${input.periodEnd}`,
    })
    : null;
  return {
    mix,
    diagnostics,
    averageCheckByArchetype: averageChecksByArchetype(mix),
    totalRevenue,
    evidence,
  };
}

export function compareTableMixPeriods(current: TableMixResult, previous: TableMixResult): MixComparison {
  return compareServiceMix(current.mix, previous.mix);
}

export type ComputeTableMixFromStoreResult =
  | { ok: true; result: TableMixResult; rbacBlocked: false }
  | { ok: false; result: null; rbacBlocked: boolean; reason: string };

/** Fetch canonical rows, enforce RBAC, and compute table-mix for arbitrary supported periods. */
export async function computeTableMixFromStore(input: {
  store: CommerceStore;
  scope: IntelligenceScope;
  period: TableMixPeriod;
  comparisonPeriod?: TableMixPeriod | null;
  source?: CommerceSource;
}): Promise<ComputeTableMixFromStoreResult> {
  const branchId = input.scope.primaryBranchId;
  if (!branchId) {
    return { ok: false, result: null, rbacBlocked: false, reason: "branch_scope_required" };
  }
  const scopeOk = assertBranchScopePreserved(input.scope, branchId);
  if (!scopeOk.ok) {
    return { ok: false, result: null, rbacBlocked: true, reason: scopeOk.reason || "rbac_blocked" };
  }
  if (!input.scope.access.canSeeNetwork && !input.scope.access.allowedBranchIds.includes(branchId)) {
    return { ok: false, result: null, rbacBlocked: true, reason: "branch_not_allowed" };
  }
  const { startDate, endDate } = input.period;
  const [orders, items, coverage] = await Promise.all([
    input.store.fetchOrders({ branchId, startDate, endDate }),
    input.store.fetchItems({ branchId, startDate, endDate }),
    input.store.fetchCoverage ? input.store.fetchCoverage(branchId) : Promise.resolve(null),
  ]);
  const canonicalOrders = orders.map((o) => orderFromSemantic(o, input.source || "foodics"));
  const canonicalItems = items.map((i) => itemFromSemantic(i, input.source || "foodics"));
  const result = computeTableMix({
    orders: canonicalOrders,
    items: canonicalItems,
    branchId,
    periodStart: startDate,
    periodEnd: endDate,
    source: input.source || "foodics",
    completedThrough: coverage?.endDate || endDate,
  });
  if (archetypeCountsSum(result.mix) !== result.mix.totalSessions) {
    return { ok: false, result: null, rbacBlocked: false, reason: "archetype_sum_mismatch" };
  }
  if (input.comparisonPeriod) {
    const cmpOrders = await input.store.fetchOrders({
      branchId,
      startDate: input.comparisonPeriod.startDate,
      endDate: input.comparisonPeriod.endDate,
    });
    const cmpItems = await input.store.fetchItems({
      branchId,
      startDate: input.comparisonPeriod.startDate,
      endDate: input.comparisonPeriod.endDate,
    });
    const previous = computeTableMix({
      orders: cmpOrders.map((o) => orderFromSemantic(o, input.source || "foodics")),
      items: cmpItems.map((i) => itemFromSemantic(i, input.source || "foodics")),
      branchId,
      periodStart: input.comparisonPeriod.startDate,
      periodEnd: input.comparisonPeriod.endDate,
      source: input.source || "foodics",
      includeEvidence: false,
    });
    result.comparison = compareTableMixPeriods(result, previous);
  }
  return { ok: true, result, rbacBlocked: false };
}

export function tableMixToPublishedCommerce(result: TableMixResult): {
  mix: ServiceMixResult;
  comparison?: MixComparison | null;
  evidence?: ReturnType<typeof buildEvidenceSummary> | null;
  health?: { mappingQuality: number | null; quality: CommerceQuality };
} {
  return {
    mix: result.mix,
    comparison: result.comparison || null,
    evidence: result.evidence || null,
    health: {
      mappingQuality: result.diagnostics.quality.confidentlyClassifiedSessionPct,
      quality: result.diagnostics.quality,
    },
  };
}
