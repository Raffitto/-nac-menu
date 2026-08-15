import type { CanonicalOrder, CanonicalOrderItem } from "./types.ts";

export function orderKey(order: Pick<CanonicalOrder, "source" | "sourceOrderId">): string {
  return `${order.source}:${order.sourceOrderId}`;
}

export function itemKey(item: Pick<CanonicalOrderItem, "source" | "sourceOrderItemId">): string {
  return `${item.source}:${item.sourceOrderItemId}`;
}

export function upsertOrders(existing: CanonicalOrder[], incoming: CanonicalOrder[]): CanonicalOrder[] {
  const map = new Map(existing.map((o) => [orderKey(o), o]));
  for (const row of incoming) {
    const prev = map.get(orderKey(row));
    if (!prev || shouldSupersede(prev.sourceRevision, row.sourceRevision)) map.set(orderKey(row), row);
  }
  return [...map.values()];
}

export function upsertItems(existing: CanonicalOrderItem[], incoming: CanonicalOrderItem[]): CanonicalOrderItem[] {
  const map = new Map(existing.map((o) => [itemKey(o), o]));
  for (const row of incoming) map.set(itemKey(row), row);
  return [...map.values()];
}

export function shouldSupersede(previousRevision: string, nextRevision: string): boolean {
  return nextRevision !== previousRevision;
}

export function duplicateRate(ids: string[]): number {
  if (!ids.length) return 0;
  return (ids.length - new Set(ids).size) / ids.length;
}

export function joinRate(orders: CanonicalOrder[], items: CanonicalOrderItem[]): number {
  if (!orders.length) return 0;
  const itemOrders = new Set(items.map((i) => i.sourceOrderId));
  const joined = orders.filter((o) => itemOrders.has(o.sourceOrderId)).length;
  return joined / orders.length;
}
