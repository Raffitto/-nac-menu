/**
 * Read-only sales readers shared by Ask NAC consumption and Inventory Truth.
 *
 * - One ordered pager (readAllPages). Every request carries .order() on a
 *   unique key, and a read is `complete` only after an empty page. A short
 *   page does not end the read, because the server may cap rows per request
 *   (PostgREST max_rows) below the requested page size.
 * - Canonical commerce is filtered to one source, and item eligibility is
 *   gated on the parent order's status.
 * - Every dropped row is counted in `droppedRows`; nothing is dropped silently.
 *
 * The client is injected. Only select/eq/gte/lte/order/range are used: no writes.
 */

import {
  CANONICAL_COMMERCE_SOURCE,
  classifyCommerceItemRow,
  COMMERCE_CANDIDATE_TABLES,
  COMMERCE_ITEM_ORDER_KEYS,
  COMMERCE_ITEM_SELECT,
  COMMERCE_ORDER_ORDER_KEYS,
  COMMERCE_ORDER_SELECT,
  COMMERCE_ROW_KIND,
  SALES_SOURCE,
} from "./salesSource";

export const DEFAULT_PAGE_SIZE = 1000;
export const DEFAULT_MAX_PAGES = 50;

export async function readAllPages(buildQuery, {
  orderBy = [],
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
} = {}) {
  if (!orderBy.length) throw new Error("readAllPages requires a unique orderBy key");
  const rows = [];
  let from = 0;
  for (let page = 0; page < maxPages; page += 1) {
    let query = buildQuery();
    for (const key of orderBy) query = query.order(key, { ascending: true });
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) return { rows, complete: false, pages: page + 1, error };
    const chunk = data || [];
    if (!chunk.length) return { rows, complete: true, pages: page + 1, error: null };
    rows.push(...chunk);
    from += chunk.length;
  }
  return { rows, complete: false, pages: maxPages, error: null, reason: "page_cap_reached" };
}

export function isMissingRelationError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || error || "").toLowerCase();
  return code === "42P01"
    || code === "PGRST205"
    || message.includes("does not exist")
    || message.includes("schema cache")
    || message.includes("could not find the table");
}

function countReason(target, reason) {
  target.total += 1;
  target.byReason[reason] = (target.byReason[reason] || 0) + 1;
}

/**
 * Classify raw commerce item rows against order statuses.
 * orderStatusById: Map source_order_id -> status, or null when order status
 * could not be read (rows are then not order-gated and the caller must disclose it).
 */
export function classifyCommerceRows(rawRows = [], {
  orderStatusById = null,
  source = CANONICAL_COMMERCE_SOURCE,
} = {}) {
  const rows = [];
  const droppedRows = { total: 0, byReason: {} };
  const refunds = { rows: 0, unnetted: 0 };
  const seen = new Set();
  for (const raw of rawRows || []) {
    const key = `${raw.source || ""}:${raw.source_order_item_id || ""}`;
    if (raw.source_order_item_id && seen.has(key)) {
      countReason(droppedRows, "duplicate_row");
      continue;
    }
    if (raw.source_order_item_id) seen.add(key);
    const orderStatus = orderStatusById
      ? (orderStatusById.has(raw.source_order_id) ? orderStatusById.get(raw.source_order_id) : null)
      : undefined;
    const classified = classifyCommerceItemRow(raw, { orderStatus, source });
    if (classified.kind === COMMERCE_ROW_KIND.DROPPED) {
      countReason(droppedRows, classified.reason);
      if (classified.reason === "unnettable_refund") refunds.unnetted += 1;
      continue;
    }
    if (classified.kind === COMMERCE_ROW_KIND.REFUND) {
      refunds.rows += 1;
      if (!classified.mapped.matched_menu_item_id) refunds.unnetted += 1;
    }
    rows.push({ ...classified.mapped, commerceKind: classified.kind });
  }
  return { rows, droppedRows, refunds };
}

/**
 * Read canonical commerce sales for one branch (or an RBAC-scoped query) and window.
 * Returns { rows, complete, droppedRows, refunds, orderStatusVerified, error, reason }.
 */
export async function readCanonicalCommerceSales(client, {
  branchId = null,
  start,
  end,
  applyScope = null,
  source = CANONICAL_COMMERCE_SOURCE,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
} = {}) {
  const scoped = (query) => {
    let next = query.eq("source", source).gte("business_date", start).lte("business_date", end);
    if (branchId) next = next.eq("branch_id", branchId);
    else if (typeof applyScope === "function") next = applyScope(next);
    return next;
  };
  const items = await readAllPages(
    () => scoped(client.from(COMMERCE_CANDIDATE_TABLES.items).select(COMMERCE_ITEM_SELECT)),
    { orderBy: COMMERCE_ITEM_ORDER_KEYS, pageSize, maxPages },
  );
  if (items.error) {
    return { rows: [], complete: false, error: items.error, droppedRows: { total: 0, byReason: {} }, refunds: { rows: 0, unnetted: 0 } };
  }
  let orderStatusById = null;
  let orderStatusVerified = false;
  let ordersComplete = true;
  let orderError = null;
  if (items.rows.length) {
    const orders = await readAllPages(
      () => scoped(client.from(COMMERCE_CANDIDATE_TABLES.orders).select(COMMERCE_ORDER_SELECT)),
      { orderBy: COMMERCE_ORDER_ORDER_KEYS, pageSize, maxPages },
    );
    if (orders.error) {
      orderError = orders.error;
    } else {
      orderStatusById = new Map(orders.rows.map((row) => [row.source_order_id, row.status]));
      orderStatusVerified = orders.complete;
      ordersComplete = orders.complete;
    }
  } else {
    orderStatusVerified = true;
  }
  const classified = classifyCommerceRows(items.rows, { orderStatusById, source });
  const complete = items.complete && ordersComplete;
  return {
    ...classified,
    complete,
    rawRowCount: items.rows.length,
    orderStatusVerified,
    orderStatusError: orderError,
    source: SALES_SOURCE.CANONICAL_COMMERCE,
    commerceSource: source,
    error: null,
    reason: !items.complete
      ? "The canonical sales read reached its page cap before the period ended."
      : (!ordersComplete ? "The order-status read reached its page cap before the period ended." : null),
  };
}

/**
 * Legacy manual Foodics import (period aggregates).
 * Overlap rule (same as Inventory Truth): a batch row is read when its period
 * overlaps the window. A row whose period extends outside the window cannot be
 * split by day, so the read is flagged `unsplittableRows` and consumers must
 * refuse a total (never silently exclude or prorate).
 */
export const LEGACY_SALES_SELECT = "id,raw_item_name,matched_menu_item_id,quantity_sold,is_modifier,semantic_class,period_start,period_end";

export async function readLegacyFoodicsSales(client, {
  branchId,
  start,
  end,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
} = {}) {
  const read = await readAllPages(
    () => client
      .from("foodics_sales_items")
      .select(LEGACY_SALES_SELECT)
      .eq("branch_id", branchId)
      .lte("period_start", end)
      .gte("period_end", start),
    { orderBy: ["id"], pageSize, maxPages },
  );
  if (read.error) return { rows: [], complete: false, error: read.error };
  const unsplittableRows = read.rows.filter((row) => (
    String(row.period_start || "") < start || String(row.period_end || "") > end
  ));
  return {
    rows: read.rows,
    complete: read.complete,
    unsplittableRows: unsplittableRows.length,
    source: SALES_SOURCE.FOODICS_SALES_ITEMS,
    error: null,
    reason: read.complete ? null : "The legacy sales read reached its page cap before the period ended.",
  };
}

/** Food Bible read contract (shared with Inventory Truth). */
export const INGREDIENT_SELECT = "id,canonical_name,active,base_inventory_unit,category,branch_id,scope";
export const RECIPE_SELECT = "id,name,normalized_name,name_en,recipe_type,menu_item_id,branch_id,output_quantity,output_unit,active";
export const VERSION_SELECT = "id,recipe_id,version_number,status,yield_percentage,effective_from,effective_to";
/**
 * Graph reads for Ask NAC consumption also carry the version documentation
 * (existing jsonb column, 20260716190000_food_bible_recipe_foundation.sql) for the
 * explicit noTrackedIngredients flag (D1.2 R6c).
 */
export const GRAPH_VERSION_SELECT = `${VERSION_SELECT},documentation`;
export const LINE_SELECT = "id,recipe_version_id,ingredient_id,sub_recipe_id,quantity,unit,canonical_quantity,canonical_unit";

const IN_CHUNK = 100;

/**
 * Read the Food Bible graph inputs for one branch (network + branch rows) with
 * the ordered pager. Versions are limited to active and retired (dated history);
 * lines are read for those versions only.
 * Returns { recipes, versions, lines, ingredients, complete, error }.
 */
export async function readRecipeGraphInputs(client, {
  branchId = null,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
} = {}) {
  const branchOr = branchId ? `branch_id.is.null,branch_id.eq.${branchId}` : null;
  const scoped = (query) => (branchOr ? query.or(branchOr) : query);
  const options = { orderBy: ["id"], pageSize, maxPages };
  const [recipes, ingredients] = await Promise.all([
    readAllPages(() => scoped(client.from("inventory_recipes").select(RECIPE_SELECT)), options),
    readAllPages(() => scoped(client.from("inventory_ingredients").select(INGREDIENT_SELECT)), options),
  ]);
  const firstError = recipes.error || ingredients.error;
  if (firstError) return { recipes: [], versions: [], lines: [], ingredients: [], complete: false, error: firstError };
  const recipeIds = recipes.rows.map((row) => row.id);
  const versions = [];
  let complete = recipes.complete && ingredients.complete;
  for (let i = 0; i < recipeIds.length; i += IN_CHUNK) {
    const chunk = recipeIds.slice(i, i + IN_CHUNK);
    const read = await readAllPages(
      () => client.from("inventory_recipe_versions").select(GRAPH_VERSION_SELECT).in("recipe_id", chunk).in("status", ["active", "retired"]),
      options,
    );
    if (read.error) return { recipes: [], versions: [], lines: [], ingredients: [], complete: false, error: read.error };
    versions.push(...read.rows);
    complete = complete && read.complete;
  }
  const versionIds = versions.map((row) => row.id);
  const lines = [];
  for (let i = 0; i < versionIds.length; i += IN_CHUNK) {
    const chunk = versionIds.slice(i, i + IN_CHUNK);
    const read = await readAllPages(
      () => client.from("inventory_recipe_version_lines").select(LINE_SELECT).in("recipe_version_id", chunk),
      options,
    );
    if (read.error) return { recipes: [], versions: [], lines: [], ingredients: [], complete: false, error: read.error };
    lines.push(...read.rows);
    complete = complete && read.complete;
  }
  return {
    recipes: recipes.rows,
    versions,
    lines,
    ingredients: ingredients.rows,
    complete,
    error: null,
  };
}
