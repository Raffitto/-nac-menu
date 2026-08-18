/**
 * Pure analytical operators over in-memory canonical commerce rows.
 */

import { isKsaWeekendIso } from "../../managementPresentation.ts";
import {
  classifyTableArchetype,
  flagsFromItems,
  isDessertFocused,
  isFoodContaining,
} from "../archetypes.ts";
import type { CanonicalOrderItem, TableArchetype } from "../types.ts";

export type SemanticOrder = {
  source_order_id: string;
  branch_id: string;
  business_date: string;
  opened_at: string | null;
  closed_at: string | null;
  order_type: string;
  covers: number | null;
  subtotal: number | null;
  tax: number | null;
  net_sales: number | null;
  status: string;
  table_id?: string | null;
};

export type SemanticItem = {
  source_order_id: string;
  source_order_item_id: string;
  branch_id: string;
  business_date: string;
  product_id: string | null;
  canonical_menu_item_id: string | null;
  item_name: string;
  canonical_category: string;
  quantity: number;
  net_amount: number | null;
  status: string;
};

export type SemanticSession = {
  source_order_id: string;
  branch_id: string;
  business_date: string;
  covers: number | null;
  net_sales: number | null;
  item_count: number | null;
  archetype: string;
  flags?: { hasFood?: boolean; hasDessert?: boolean; hasCoffee?: boolean } | null;
};

export function wallHour(iso: string | null | undefined): number | null {
  const s = String(iso || "");
  const m = s.match(/T(\d{2}):/) || s.match(/\s(\d{2}):/);
  return m ? Number(m[1]) : null;
}

export function productKey(item: SemanticItem): string {
  return String(item.canonical_menu_item_id || item.product_id || item.item_name || "").toLowerCase();
}

export function nameMatches(itemName: string, query: string): boolean {
  const a = String(itemName || "").toLowerCase().trim();
  const b = String(query || "").toLowerCase().trim();
  if (!a || !b) return false;
  return a === b || a.includes(b) || (b.length >= 5 && b.includes(a));
}

export function itemsByOrder(items: SemanticItem[]): Map<string, SemanticItem[]> {
  const map = new Map<string, SemanticItem[]>();
  for (const item of items) {
    const list = map.get(item.source_order_id) || [];
    list.push(item);
    map.set(item.source_order_id, list);
  }
  return map;
}

export function distinctProductCount(basket: SemanticItem[]): number {
  return new Set(basket.map(productKey).filter(Boolean)).size;
}

export function basketQty(basket: SemanticItem[]): number {
  return basket.reduce((n, i) => n + (Number(i.quantity) || 0), 0);
}

export function orderHasProduct(basket: SemanticItem[], name: string): boolean {
  return basket.some((i) => nameMatches(i.item_name, name));
}

export function orderHasFamily(basket: SemanticItem[], family: string): boolean {
  return basket.some((i) => i.canonical_category === family && i.status !== "void" && i.status !== "cancelled");
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function ratio(num: number, den: number): number | null {
  if (!den) return null;
  return num / den;
}

export function matchesWeekend(date: string, weekend: boolean): boolean {
  return isKsaWeekendIso(date) === weekend;
}

export function guestBand(covers: number | null): string {
  if (covers == null || !Number.isFinite(Number(covers))) return "unknown";
  const n = Number(covers);
  if (n <= 1) return "1";
  if (n === 2) return "2";
  if (n === 3) return "3";
  return "4+";
}

export function filterOrders(
  orders: SemanticOrder[],
  itemsBy: Map<string, SemanticItem[]>,
  opts: {
    hourGte?: number | null;
    weekend?: boolean | null;
    status?: string | string[] | null;
    orderType?: string | null;
    family?: string | null;
  },
): SemanticOrder[] {
  return orders.filter((order) => {
    if (opts.status) {
      const allowed = Array.isArray(opts.status) ? opts.status : [opts.status];
      if (!allowed.includes(order.status)) return false;
    }
    if (opts.orderType && order.order_type !== opts.orderType) return false;
    if (opts.weekend != null && !matchesWeekend(String(order.business_date).slice(0, 10), opts.weekend)) return false;
    if (opts.hourGte != null) {
      const h = wallHour(order.opened_at);
      if (h == null || h < opts.hourGte) return false;
    }
    return true;
  });
}

export function applyCohort(
  orders: SemanticOrder[],
  itemsBy: Map<string, SemanticItem[]>,
  cohort: {
    kind: string;
    value?: string | number;
  } | null | undefined,
): SemanticOrder[] {
  if (!cohort) return orders;
  return orders.filter((order) => {
    const basket = itemsBy.get(order.source_order_id) || [];
    const check = Number(order.net_sales) || 0;
    switch (cohort.kind) {
      case "contains_product":
        return orderHasProduct(basket, String(cohort.value || ""));
      case "not_contains_product":
        return !orderHasProduct(basket, String(cohort.value || ""));
      case "spend_gt":
        return check > Number(cohort.value);
      case "spend_gte":
        return check >= Number(cohort.value);
      case "covers_gte":
        return Number(order.covers) >= Number(cohort.value);
      case "covers_lte":
        return order.covers != null && Number(order.covers) <= Number(cohort.value);
      case "basket_eq":
        return distinctProductCount(basket) === Number(cohort.value);
      case "basket_gt":
        return basketQty(basket) > Number(cohort.value);
      case "basket_gte":
        return basketQty(basket) >= Number(cohort.value);
      case "distinct_gte":
        return distinctProductCount(basket) >= Number(cohort.value);
      case "has_family":
        return orderHasFamily(basket, String(cohort.value));
      case "not_has_family":
        return !orderHasFamily(basket, String(cohort.value));
      case "weekend":
        return matchesWeekend(String(order.business_date).slice(0, 10), true);
      case "weekday":
        return matchesWeekend(String(order.business_date).slice(0, 10), false);
      case "hour_gte": {
        const h = wallHour(order.opened_at);
        return h != null && h >= Number(cohort.value);
      }
      case "status":
        return order.status === String(cohort.value);
      case "archetype": {
        const flags = flagsFromItems(basket.map(toCanonicalItem));
        const arch = classifyTableArchetype(flags);
        if (cohort.value === "dessert_focused") return isDessertFocused(arch);
        if (cohort.value === "food_containing") return isFoodContaining(arch);
        return arch === cohort.value;
      }
      default:
        return true;
    }
  });
}

function toCanonicalItem(item: SemanticItem): CanonicalOrderItem {
  return {
    source: "foodics",
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
    netAmount: item.net_amount,
    status: (item.status as CanonicalOrderItem["status"]) || "completed",
  };
}

export function rankProducts(
  orders: SemanticOrder[],
  itemsBy: Map<string, SemanticItem[]>,
  opts: { excludeName?: string | null; family?: string | null; limit: number; mode: "quantity" | "orders" | "revenue" },
): Array<{ name: string; orders: number; quantity: number; revenue: number; penetration: number | null }> {
  const counts = new Map<string, { name: string; orders: Set<string>; quantity: number; revenue: number }>();
  const den = orders.length;
  for (const order of orders) {
    const seen = new Set<string>();
    for (const item of itemsBy.get(order.source_order_id) || []) {
      if (opts.family === "beverage") {
        if (item.canonical_category !== "coffee" && item.canonical_category !== "other_beverage") continue;
      } else if (opts.family && item.canonical_category !== opts.family) continue;
      if (opts.excludeName && nameMatches(item.item_name, opts.excludeName)) continue;
      const key = productKey(item) || item.item_name.toLowerCase();
      const row = counts.get(key) || { name: item.item_name, orders: new Set(), quantity: 0, revenue: 0 };
      if (!seen.has(key)) {
        row.orders.add(order.source_order_id);
        seen.add(key);
      }
      row.quantity += Number(item.quantity) || 0;
      row.revenue += Number(item.net_amount) || 0;
      if (item.item_name.length > row.name.length) row.name = item.item_name;
      counts.set(key, row);
    }
  }
  const scored = [...counts.values()].map((row) => ({
    name: row.name,
    orders: row.orders.size,
    quantity: row.quantity,
    revenue: row.revenue,
    penetration: ratio(row.orders.size, den),
  }));
  const key = opts.mode === "revenue" ? "revenue" : opts.mode === "quantity" ? "quantity" : "orders";
  scored.sort((a, b) => Number(b[key]) - Number(a[key]));
  return scored.slice(0, opts.limit);
}

export function productLift(
  cohort: SemanticOrder[],
  baseline: SemanticOrder[],
  itemsBy: Map<string, SemanticItem[]>,
  limit: number,
): Array<{ name: string; cohortPenetration: number | null; baselinePenetration: number | null; lift: number | null; cohortOrders: number }> {
  const cRank = rankProducts(cohort, itemsBy, { limit: 80, mode: "orders" });
  const bRank = rankProducts(baseline, itemsBy, { limit: 400, mode: "orders" });
  const bMap = new Map(bRank.map((r) => [r.name.toLowerCase(), r]));
  return cRank.map((row) => {
    const base = bMap.get(row.name.toLowerCase());
    const lift = row.penetration != null && base?.penetration ? row.penetration / base.penetration : null;
    return {
      name: row.name,
      cohortPenetration: row.penetration,
      baselinePenetration: base?.penetration ?? ratio(0, baseline.length),
      lift,
      cohortOrders: row.orders,
    };
  }).sort((a, b) => (b.lift || 0) - (a.lift || 0)).slice(0, limit);
}

export function sessionArchetypeFromBasket(basket: SemanticItem[]): TableArchetype {
  return classifyTableArchetype(flagsFromItems(basket.map(toCanonicalItem)));
}
