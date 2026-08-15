/**
 * Service-mix, conversion, attachment, and item-mix metrics.
 * One pass over sessions — no per-archetype queries.
 */

import {
  classifyTableArchetype,
  flagsFromItems,
  hasDessertItem,
  isCoffeeLed,
  isDessertFocused,
  isFoodContaining,
} from "./archetypes.ts";
import type {
  ArchetypeTotals,
  CanonicalOrder,
  CanonicalOrderItem,
  DineInSession,
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

function emptyTotals(): ArchetypeTotals {
  return { sessions: 0, netSales: 0, covers: 0, items: 0, dessertItems: 0, foodItems: 0, beverageItems: 0 };
}

export function buildDineInSessions(
  orders: CanonicalOrder[],
  items: CanonicalOrderItem[],
): DineInSession[] {
  const byOrder = new Map<string, CanonicalOrderItem[]>();
  for (const item of items) {
    const list = byOrder.get(item.sourceOrderId) || [];
    list.push(item);
    byOrder.set(item.sourceOrderId, list);
  }
  const sessions: DineInSession[] = [];
  for (const order of orders) {
    if (order.orderType !== "dine_in") continue;
    if (order.status !== "completed") continue;
    const basket = byOrder.get(order.sourceOrderId) || [];
    const flags = flagsFromItems(basket);
    sessions.push({
      sourceOrderId: order.sourceOrderId,
      branchId: order.branchId,
      businessDate: order.businessDate,
      closedAt: order.closedAt,
      covers: order.covers,
      netSales: Number(order.netSales) || 0,
      itemCount: basket.reduce((n, i) => n + (Number(i.quantity) || 0), 0),
      flags,
      archetype: classifyTableArchetype(flags),
      items: basket,
    });
  }
  return sessions;
}

function ratio(num: number, den: number): number | null {
  if (!den) return null;
  return num / den;
}

export function summarizeServiceMix(
  sessions: DineInSession[],
  meta: {
    source?: ServiceMixResult["source"];
    branchId: string;
    periodStart: string;
    periodEnd: string;
    completedThrough?: string | null;
    lastIngestAt?: string | null;
  },
): ServiceMixResult {
  const byArchetype = Object.fromEntries(ARCHETYPES.map((a) => [a, emptyTotals()])) as Record<TableArchetype, ArchetypeTotals>;
  let coversKnown = 0;
  let coversSum = 0;
  for (const session of sessions) {
    const row = byArchetype[session.archetype];
    row.sessions += 1;
    row.netSales += session.netSales;
    row.items += session.itemCount;
    if (session.covers != null) {
      row.covers = (row.covers || 0) + session.covers;
      coversKnown += 1;
      coversSum += session.covers;
    }
    for (const item of session.items) {
      if (item.canonicalCategory === "dessert") row.dessertItems += Number(item.quantity) || 0;
      if (item.canonicalCategory === "food") row.foodItems += Number(item.quantity) || 0;
      if (item.canonicalCategory === "coffee" || item.canonicalCategory === "other_beverage") {
        row.beverageItems += Number(item.quantity) || 0;
      }
    }
  }
  const total = sessions.length;
  const dessertFocused = sessions.filter((s) => isDessertFocused(s.archetype));
  const foodContaining = sessions.filter((s) => isFoodContaining(s.archetype));
  const dessertAtAll = sessions.filter((s) => hasDessertItem(s.archetype));
  const fullService = byArchetype.full_service.sessions;
  const coffeeLed = sessions.filter((s) => isCoffeeLed(s.archetype)).length;
  const coverDen = coversSum;
  const coverOf = (subset: DineInSession[]) => subset.reduce((n, s) => n + (s.covers || 0), 0);
  return {
    source: meta.source || "synthetic",
    branchId: meta.branchId,
    periodStart: meta.periodStart,
    periodEnd: meta.periodEnd,
    completedThrough: meta.completedThrough || null,
    lastIngestAt: meta.lastIngestAt || null,
    totalSessions: total,
    byArchetype,
    dessertFocusedShare: ratio(dessertFocused.length, total),
    foodContainingShare: ratio(foodContaining.length, total),
    fullServiceShare: ratio(fullService, total),
    coffeeLedShare: ratio(coffeeLed, total),
    dessertConversion: ratio(fullService, foodContaining.length),
    dessertAtAllShare: ratio(dessertAtAll.length, total),
    guestWeightedDessertFocusedShare: coversKnown ? ratio(coverOf(dessertFocused), coverDen) : null,
    guestWeightedFoodContainingShare: coversKnown ? ratio(coverOf(foodContaining), coverDen) : null,
    guestWeightedDessertAtAllShare: coversKnown ? ratio(coverOf(dessertAtAll), coverDen) : null,
    unclassifiedRate: ratio(byArchetype.unclassified.sessions, total),
    coversAvailable: coversKnown === total && total > 0,
    totalCovers: coversKnown ? coversSum : null,
  };
}

export function percentagePoints(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null;
  return (current - previous) * 100;
}

export function relativeChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / previous;
}

export function compareServiceMix(current: ServiceMixResult, previous: ServiceMixResult): MixComparison {
  return {
    current,
    previous,
    dessertFocusedPp: percentagePoints(current.dessertFocusedShare, previous.dessertFocusedShare),
    foodContainingPp: percentagePoints(current.foodContainingShare, previous.foodContainingShare),
    fullServicePp: percentagePoints(current.fullServiceShare, previous.fullServiceShare),
    dessertConversionPp: percentagePoints(current.dessertConversion, previous.dessertConversion),
  };
}

export function averageCheck(totals: ArchetypeTotals): number | null {
  if (!totals.sessions) return null;
  return totals.netSales / totals.sessions;
}

/**
 * Attachment: sessions containing target that also contain attached, over sessions containing target.
 */
export function attachmentRate(
  sessions: DineInSession[],
  target: (s: DineInSession) => boolean,
  attached: (s: DineInSession) => boolean,
): number | null {
  const den = sessions.filter(target);
  if (!den.length) return null;
  return den.filter(attached).length / den.length;
}

export function itemMix(
  sessions: DineInSession[],
  basis: "units" | "revenue",
): Array<{ name: string; family: string; value: number; share: number }> {
  const map = new Map<string, { name: string; family: string; value: number }>();
  let total = 0;
  for (const session of sessions) {
    for (const item of session.items) {
      const key = item.canonicalMenuItemId || item.itemName;
      const add = basis === "units" ? (Number(item.quantity) || 0) : (Number(item.netAmount) || 0);
      total += add;
      const cur = map.get(key) || { name: item.itemName, family: item.canonicalCategory, value: 0 };
      cur.value += add;
      map.set(key, cur);
    }
  }
  return [...map.values()]
    .map((row) => ({ ...row, share: total ? row.value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}

export function cooccurrence(
  sessions: DineInSession[],
  anchorName: string,
  limit = 5,
): Array<{ name: string; sessions: number; rate: number }> {
  const needle = anchorName.toLowerCase();
  const withAnchor = sessions.filter((s) => s.items.some((i) => i.itemName.toLowerCase() === needle));
  if (!withAnchor.length) return [];
  const counts = new Map<string, number>();
  for (const session of withAnchor) {
    const names = new Set(session.items.map((i) => i.itemName).filter((n) => n.toLowerCase() !== needle));
    for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, n]) => ({ name, sessions: n, rate: n / withAnchor.length }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, limit);
}
