/**
 * Theoretical-consumption sales sources.
 * Precedence is deterministic. Overlapping sources are never summed.
 *
 * Item-mix authority is canonical commerce_order_items (Foodics bridge).
 * Cash Up remains headline sales, not an item-quantity driver.
 * foodics_sales_items is a stale manual import used only as fallback / reconciliation.
 */

import { addDecimal } from "../inventoryIntelligence";
import {
  buildTemporalCoverage,
  latestCompletedBusinessDate,
  listInclusiveIsoDates,
} from "../../intelligence/askNac/coverage/temporalCoverage";

export const SALES_SOURCE = Object.freeze({
  CANONICAL_COMMERCE: "canonical_commerce",
  FOODICS_SALES_ITEMS: "foodics_sales_items",
  NONE: "none",
});

export const SALES_SOURCE_STATUS = Object.freeze({
  AVAILABLE: "AVAILABLE",
  NOT_IN_SCHEMA: "NOT_IN_SCHEMA",
  EMPTY: "EMPTY",
  INSUFFICIENT_IDENTITY: "INSUFFICIENT_IDENTITY",
  UNAVAILABLE: "UNAVAILABLE",
});

export const COMMERCE_CANDIDATE_TABLES = Object.freeze({
  orders: "commerce_orders",
  items: "commerce_order_items",
  freshness: "commerce_dataset_freshness",
  ingestHealth: "commerce_ingest_health",
});

export const COMMERCE_ITEM_SELECT = [
  "source",
  "source_order_id",
  "source_order_item_id",
  "branch_id",
  "business_date",
  "product_id",
  "canonical_menu_item_id",
  "item_name",
  "quantity",
  "net_amount",
  "status",
].join(",");

export const EXCLUDED_COMMERCE_ITEM_STATUSES = Object.freeze([
  "void",
  "cancelled",
  "refunded",
  "open",
]);

export function clipSalesPeriod({
  requestedStart,
  requestedEnd,
  publishedThrough = null,
  referenceDate = new Date(),
} = {}) {
  const latestCompleted = latestCompletedBusinessDate(referenceDate);
  const caps = [publishedThrough, latestCompleted].filter(Boolean);
  const cap = caps.length ? caps.reduce((left, right) => (left < right ? left : right)) : null;
  const availableEnd = requestedEnd && cap && requestedEnd < cap ? requestedEnd : cap;
  const usable = Boolean(
    requestedStart
    && availableEnd
    && requestedStart <= availableEnd,
  );
  const availableStart = usable ? requestedStart : null;
  const availableDates = availableStart && availableEnd
    ? listInclusiveIsoDates(availableStart, availableEnd)
    : [];
  const coverage = buildTemporalCoverage({
    requestedStart,
    requestedEnd,
    availableDates,
    latestAvailableDate: publishedThrough || latestCompleted,
    referenceDate,
    source: "canonical_commerce + temporal_coverage",
  });
  return {
    requestedStart: requestedStart || null,
    requestedEnd: requestedEnd || null,
    availableStart: coverage.availablePeriod?.startDate || availableStart,
    availableEnd: coverage.availablePeriod?.endDate || availableEnd,
    publishedThrough: publishedThrough || latestCompleted,
    latestAvailableDate: coverage.latestAvailableDate || publishedThrough || latestCompleted,
    latestCompletedDate: latestCompleted,
    missingDates: coverage.missingDates || [],
    usable,
    source: coverage.source,
    coverage,
  };
}

export function mapCommerceItemRow(row = {}) {
  const status = String(row.status || "completed").toLowerCase();
  if (EXCLUDED_COMMERCE_ITEM_STATUSES.includes(status)) return null;
  const businessDate = row.business_date || row.sold_on || row.order_date || row.period_start || null;
  const displayName = row.item_name || row.menu_item_name || row.product_name || row.name || "";
  const quantity = row.quantity ?? row.quantity_sold ?? row.qty ?? null;
  return {
    matched_menu_item_id: row.canonical_menu_item_id || row.menu_item_id || row.matched_menu_item_id || null,
    matched_menu_item_name: displayName,
    raw_item_name: displayName,
    quantity_sold: quantity,
    net_sales: row.net_amount ?? row.net_sales ?? row.net_amount ?? null,
    branch_id: row.branch_id || null,
    period_start: businessDate,
    period_end: businessDate,
    foodics_product_id: row.product_id || row.foodics_product_id || null,
    commerceStatus: status,
    identityStrength: row.canonical_menu_item_id
      ? "canonical_menu_item_id"
      : row.product_id
        ? "foodics_product_id"
        : displayName
          ? "item_name"
          : null,
    source: SALES_SOURCE.CANONICAL_COMMERCE,
  };
}

export function commerceRowHasContract(row) {
  const mapped = row?.source === SALES_SOURCE.CANONICAL_COMMERCE && row.quantity_sold != null
    ? row
    : mapCommerceItemRow(row);
  if (!mapped) return false;
  return Boolean(
    mapped.branch_id
    && mapped.period_start
    && (mapped.matched_menu_item_id || mapped.matched_menu_item_name)
    && mapped.quantity_sold != null,
  );
}

export function selectSalesSource({
  commerceProbe = { status: SALES_SOURCE_STATUS.NOT_IN_SCHEMA, rows: [] },
  foodicsRows = [],
  coversRequestedPeriod = false,
} = {}) {
  const mappedCommerce = (commerceProbe.rows || [])
    .map((row) => (row?.source === SALES_SOURCE.CANONICAL_COMMERCE ? row : mapCommerceItemRow(row)))
    .filter((row) => row && commerceRowHasContract(row));
  const schemaPresent = commerceProbe.status === SALES_SOURCE_STATUS.AVAILABLE
    || commerceProbe.status === SALES_SOURCE_STATUS.EMPTY;
  const precedence = {
    primary: SALES_SOURCE.CANONICAL_COMMERCE,
    fallback: SALES_SOURCE.FOODICS_SALES_ITEMS,
    combined: false,
  };

  if (schemaPresent && mappedCommerce.length) {
    return { ...precedence, used: SALES_SOURCE.CANONICAL_COMMERCE, rows: mappedCommerce };
  }
  if (schemaPresent && coversRequestedPeriod) {
    return { ...precedence, used: SALES_SOURCE.CANONICAL_COMMERCE, rows: [] };
  }
  if ((foodicsRows || []).length) {
    return {
      ...precedence,
      used: SALES_SOURCE.FOODICS_SALES_ITEMS,
      rows: (foodicsRows || []).map((row) => ({ ...row, source: SALES_SOURCE.FOODICS_SALES_ITEMS })),
    };
  }
  return { ...precedence, used: SALES_SOURCE.NONE, rows: [] };
}

export function reconcileSalesSources(commerceRows = [], foodicsRows = []) {
  const keyOf = (row) => {
    const id = row.matched_menu_item_id || row.canonical_menu_item_id || row.menu_item_id || "";
    const name = String(row.matched_menu_item_name || row.item_name || row.raw_item_name || row.name || "")
      .toLowerCase()
      .trim();
    return id || `name:${name}`;
  };
  const qty = (row) => String(row.quantity_sold ?? row.quantity ?? 0);
  const left = new Map();
  for (const row of commerceRows) {
    const key = keyOf(row);
    left.set(key, addDecimal(left.get(key) || "0", qty(row)));
  }
  const right = new Map();
  for (const row of foodicsRows) {
    const key = keyOf(row);
    right.set(key, addDecimal(right.get(key) || "0", qty(row)));
  }
  const matches = [];
  const quantityMismatches = [];
  const identityMismatches = [];
  const missingOnCommerce = [];
  const missingOnFoodics = [];
  for (const [key, commerceQty] of left.entries()) {
    if (!right.has(key)) {
      if (key.startsWith("name:")) identityMismatches.push({ key, commerceQty });
      else missingOnFoodics.push({ key, commerceQty });
      continue;
    }
    if (commerceQty === right.get(key)) matches.push({ key, quantity: commerceQty });
    else quantityMismatches.push({ key, commerceQty, foodicsQty: right.get(key) });
  }
  for (const [key, foodicsQty] of right.entries()) {
    if (!left.has(key)) {
      if (key.startsWith("name:")) identityMismatches.push({ key, foodicsQty });
      else missingOnCommerce.push({ key, foodicsQty });
    }
  }
  return {
    matches,
    quantityMismatches,
    identityMismatches,
    missingOnCommerce,
    missingOnFoodics,
    compared: true,
    combined: false,
  };
}
