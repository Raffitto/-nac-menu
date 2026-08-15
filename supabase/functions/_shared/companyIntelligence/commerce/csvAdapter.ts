/**
 * Official Foodics CSV → adapter structures. Canonical types stay stable
 * even when export headers differ from console JSON.
 */

import { mapFoodicsBranch, mapFoodicsOrderType, mapFoodicsStatus } from "./foodicsAdapter.ts";
import { mapCanonicalFamily, type ProductMapRow } from "./productMapping.ts";
import type { CanonicalOrder, CanonicalOrderItem } from "./types.ts";

const ORDER_ID = ["order id", "order_id", "id", "order uuid"];
const LINE_ID = ["order item id", "order_item_id", "item id", "line id", "id"];
const PRODUCT_ID = ["product id", "product_id", "item product id"];
const BRANCH = ["branch", "branch name", "branch_id"];
const DATE = ["business date", "business_date", "date"];
const STATUS = ["status", "order status"];
const TYPE = ["type", "order type"];
const GUESTS = ["guests", "covers", "persons", "persons count"];
const QTY = ["quantity", "qty"];
const TOTAL = ["total", "total price", "net", "net amount"];
const NAME = ["product", "product name", "item", "item name", "name"];
const OPENED = ["opened at", "opened_at"];
const CLOSED = ["closed at", "closed_at"];

function norm(h: string): string {
  return String(h || "").trim().toLowerCase();
}

function pick(row: Record<string, string>, aliases: string[]): string | null {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const hit = keys.find((k) => norm(k) === alias);
    if (hit && row[hit]) return row[hit];
  }
  return null;
}

export function parseDelimitedTable(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cells[i] || ""; });
    return row;
  });
  return { headers, rows };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i += 1; }
      else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function adaptFoodicsOrdersCsv(
  text: string,
  ingestedAt = new Date().toISOString(),
): { headers: string[]; orders: CanonicalOrder[] } {
  const { headers, rows } = parseDelimitedTable(text);
  const orders = rows.map((row) => {
    const id = pick(row, ORDER_ID);
    if (!id) throw Object.assign(new Error("csv_missing_order_id"), { name: "FOODICS_SCHEMA_DRIFT" });
    return {
      source: "foodics" as const,
      sourceOrderId: id,
      sourceRevision: `${pick(row, STATUS) || ""}:${pick(row, CLOSED) || ""}:${pick(row, TOTAL) || ""}`,
      branchId: mapFoodicsBranch(pick(row, BRANCH)),
      businessDate: String(pick(row, DATE) || "").slice(0, 10),
      openedAt: pick(row, OPENED),
      closedAt: pick(row, CLOSED),
      orderType: mapFoodicsOrderType(pick(row, TYPE)),
      tableId: pick(row, ["table id", "table_id", "table"]),
      covers: pick(row, GUESTS) == null ? null : Number(pick(row, GUESTS)),
      subtotal: null,
      discount: null,
      tax: null,
      netSales: pick(row, TOTAL) == null ? null : Number(pick(row, TOTAL)),
      status: mapFoodicsStatus(pick(row, STATUS)),
      ingestedAt,
    };
  });
  return { headers, orders };
}

export function adaptFoodicsOrderItemsCsv(
  text: string,
  productMap: ProductMapRow[] = [],
): { headers: string[]; items: CanonicalOrderItem[] } {
  const { headers, rows } = parseDelimitedTable(text);
  const mapByProduct = new Map(
    productMap.filter((r) => r.sourceProductId).map((r) => [String(r.sourceProductId), r]),
  );
  const items = rows.map((row, idx) => {
    const orderId = pick(row, ORDER_ID);
    const lineId = pick(row, LINE_ID) || `${orderId}:${idx}`;
    const productId = pick(row, PRODUCT_ID);
    const name = pick(row, NAME) || "unknown";
    const mapped = (productId && mapByProduct.get(productId)) || { sourceName: name, sourceProductId: productId };
    return {
      source: "foodics" as const,
      sourceOrderId: String(orderId || ""),
      sourceOrderItemId: String(lineId),
      branchId: mapFoodicsBranch(pick(row, BRANCH)),
      businessDate: String(pick(row, DATE) || "").slice(0, 10),
      productId,
      canonicalMenuItemId: mapped.canonicalMenuItemId || null,
      itemName: name,
      sourceCategory: pick(row, ["category", "source category"]),
      canonicalCategory: mapCanonicalFamily(mapped),
      quantity: Number(pick(row, QTY) || 0),
      grossAmount: null,
      discountAmount: null,
      netAmount: pick(row, TOTAL) == null ? null : Number(pick(row, TOTAL)),
      status: mapFoodicsStatus(pick(row, STATUS)),
    };
  });
  return { headers, items };
}
