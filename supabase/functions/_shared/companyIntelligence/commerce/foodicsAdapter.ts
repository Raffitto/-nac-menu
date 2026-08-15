/**
 * Foodics source adapter. Parses Foodics console order JSON (and future
 * Orders/Order Items CSV) into NAC canonical types.
 * Downstream code must not import Foodics column/status numbers.
 */

import { mapCanonicalFamily, type ProductMapRow } from "./productMapping.ts";
import type {
  CanonicalOrder,
  CanonicalOrderItem,
  OrderStatus,
  OrderType,
} from "./types.ts";

/** Observed Foodics console numeric statuses. */
export const FOODICS_STATUS = {
  ACTIVE: 2,
  DONE: 4,
} as const;

/** Observed Foodics console numeric types. */
export const FOODICS_TYPE = {
  DINE_IN: 1,
} as const;

const BRANCH_NAME: Record<string, string> = {
  "nac al khobar": "khobar",
  khobar: "khobar",
  "nac jeddah": "jeddah",
  jeddah: "jeddah",
  "nac riyadh": "riyadh",
  riyadh: "riyadh",
};

export function mapFoodicsStatus(status: number | string | null | undefined): OrderStatus {
  if (status === FOODICS_STATUS.DONE || status === "Done" || status === "done" || status === 4) {
    return "completed";
  }
  if (status === "Void" || status === "void" || status === "Returned" || status === "returned") {
    return "void";
  }
  if (status === "Declined" || status === "declined" || status === "Draft" || status === "draft") {
    return "cancelled";
  }
  if (status === FOODICS_STATUS.ACTIVE || status === "Active" || status === "Pending" || status === 2) {
    return "open";
  }
  return "open";
}

export function mapFoodicsOrderType(type: number | string | null | undefined): OrderType {
  if (type === FOODICS_TYPE.DINE_IN || type === "Dine In" || type === "dine_in" || type === 1) {
    return "dine_in";
  }
  if (type === "Pick Up" || type === "pickup" || type === "PickUp") return "pickup";
  if (type === "Delivery" || type === "delivery") return "delivery";
  if (type === "Drive Thru" || type === "drive_thru") return "other";
  return "other";
}

export function mapFoodicsBranch(nameOrId: string | null | undefined): string {
  const key = String(nameOrId || "").trim().toLowerCase();
  return BRANCH_NAME[key] || key.replace(/\s+/g, "_") || "unknown";
}

export function isCompletedDineInSession(order: CanonicalOrder): boolean {
  return order.status === "completed" && order.orderType === "dine_in";
}

function isSeparatorName(name: string): boolean {
  return /^\*+$/.test(String(name || "").replace(/\s+/g, ""));
}

function revisionFromOrder(raw: Record<string, unknown>): string {
  const closed = String(raw.closed_at || "");
  const total = String(raw.total_price ?? "");
  const status = String(raw.status ?? "");
  return `${status}:${closed}:${total}`;
}

export function adaptFoodicsConsoleOrder(
  raw: Record<string, unknown>,
  productMap: ProductMapRow[] = [],
  ingestedAt = new Date().toISOString(),
): { order: CanonicalOrder; items: CanonicalOrderItem[] } {
  if (!raw?.id) {
    const err = new Error("Foodics order missing stable id");
    err.name = "FOODICS_SCHEMA_DRIFT";
    throw err;
  }
  const branch = raw.branch as { name?: string; id?: string } | undefined;
  const branchId = mapFoodicsBranch(branch?.name);
  const businessDate = String(raw.business_date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    const err = new Error("Foodics order missing business_date");
    err.name = "FOODICS_SCHEMA_DRIFT";
    throw err;
  }
  const order: CanonicalOrder = {
    source: "foodics",
    sourceOrderId: String(raw.id),
    sourceRevision: revisionFromOrder(raw),
    branchId,
    businessDate,
    openedAt: raw.opened_at ? String(raw.opened_at) : null,
    closedAt: raw.closed_at ? String(raw.closed_at) : null,
    orderType: mapFoodicsOrderType(raw.type as number),
    tableId: (raw.table as { id?: string } | null)?.id || null,
    covers: raw.guests == null ? null : Number(raw.guests),
    subtotal: raw.subtotal_price == null ? null : Number(raw.subtotal_price),
    discount: raw.discount_amount == null ? null : Number(raw.discount_amount),
    tax: raw.subtotal_price != null && raw.total_price != null
      ? Number(raw.total_price) - Number(raw.subtotal_price)
      : null,
    netSales: raw.total_price == null ? null : Number(raw.total_price),
    status: mapFoodicsStatus(raw.status as number),
    ingestedAt,
  };

  const mapByProduct = new Map(
    productMap.filter((r) => r.sourceProductId).map((r) => [String(r.sourceProductId), r]),
  );
  const items: CanonicalOrderItem[] = [];
  for (const line of (raw.products as Array<Record<string, unknown>> | undefined) || []) {
    const product = (line.product || {}) as { id?: string; name?: string; is_non_revenue?: boolean };
    const name = String(product.name || "");
    if (!line.id || isSeparatorName(name) || product.is_non_revenue) continue;
    const mapped = mapByProduct.get(String(product.id || "")) || { sourceName: name, sourceProductId: product.id };
    items.push({
      source: "foodics",
      sourceOrderId: String(raw.id),
      sourceOrderItemId: String(line.id),
      branchId,
      businessDate,
      productId: product.id ? String(product.id) : null,
      canonicalMenuItemId: mapped.canonicalMenuItemId || null,
      itemName: name,
      sourceCategory: null,
      canonicalCategory: mapCanonicalFamily(mapped),
      quantity: Number(line.quantity) || 0,
      grossAmount: line.unit_price == null ? null : Number(line.unit_price) * (Number(line.quantity) || 0),
      discountAmount: line.discount_amount == null ? null : Number(line.discount_amount),
      netAmount: line.total_price == null ? null : Number(line.total_price),
      status: Number(line.status) === 3 ? "completed" : mapFoodicsStatus(line.status as number),
    });
  }
  return { order, items };
}

export function adaptFoodicsConsolePayload(
  payload: { data?: Record<string, unknown> } | Record<string, unknown>,
  productMap: ProductMapRow[] = [],
) {
  const raw = (payload as { data?: Record<string, unknown> }).data || (payload as Record<string, unknown>);
  return adaptFoodicsConsoleOrder(raw, productMap);
}
