/**
 * Oracle D1 — B. Paging and completeness (T4-T8).
 * Shared pager: src/inventory/truth/readers.js readAllPages. Every request is
 * ordered on a unique key; a read is complete only after an empty page.
 */
import { readAllPages, readCanonicalCommerceSales, readLegacyFoodicsSales } from "../truth/readers";
import { summarizeIngredientConsumptionWithTruth } from "../truth/ingredientConsumption";
import { loadAuthoritativeSales, queryIngredientConsumption } from "../intelligence/recipeConsumptionApi";
import { allTrackedWriteCalls, trackedStub } from "../__fixtures__/oracle-d1/supabaseStub";
import {
  consumptionTables,
  latteGraph,
  ordersFor,
  SYN_BRANCH,
  SYN_INGREDIENTS,
  SYN_NOW,
  synItemPage,
  SYN_PROFILE,
} from "../__fixtures__/oracle-d1/synFixtures";

const DAY = { start: "2026-10-10", end: "2026-10-10", label: "2026-10-10" };
const MILK = { id: SYN_INGREDIENTS.milk.id, name: SYN_INGREDIENTS.milk.canonical_name };

function expectUnavailable(result, pattern) {
  expect(result.status).toBe("UNAVAILABLE");
  expect(result.quantity).toBeNull();
  expect(result.reason).toEqual(expect.any(String));
  expect(result.reason.length).toBeGreaterThan(0);
  if (pattern) expect(result.reason).toMatch(pattern);
  expect(result.postsStock).toBe(false);
}

function rangeCalls(stub, table) {
  return stub.readsOf(table, "range");
}

/** Every range() on a table must come after order() on each unique key in the same request. */
function expectOrderedRequests(stub, table, keys) {
  const tableCalls = stub.calls.filter((call) => call.table === table);
  let pendingOrders = [];
  let requests = 0;
  for (const call of tableCalls) {
    if (call.method === "from") pendingOrders = [];
    if (call.method === "order") pendingOrders.push(call.args[0]);
    if (call.method === "range") {
      requests += 1;
      expect(pendingOrders).toEqual(keys);
    }
  }
  expect(requests).toBeGreaterThan(0);
}

describe("T4 ordered pager, exact-multiple boundary", () => {
  test("1000 rows then 0 rows: complete, 1000 rows, every request ordered", async () => {
    const page = synItemPage(1000, 0, { date: "2026-10-10" });
    const stub = trackedStub({
      pages: { commerce_order_items: ({ call }) => (call === 0 ? page : []) },
      tables: { commerce_orders: ordersFor(page) },
    });
    const read = await readCanonicalCommerceSales(stub, { branchId: SYN_BRANCH, start: DAY.start, end: DAY.end });
    expect(read.complete).toBe(true);
    expect(read.rows).toHaveLength(1000);
    expect(read.droppedRows.total).toBe(0);
    expect(rangeCalls(stub, "commerce_order_items")).toHaveLength(2);
    expectOrderedRequests(stub, "commerce_order_items", ["source", "source_order_item_id"]);
    expectOrderedRequests(stub, "commerce_orders", ["source", "source_order_id"]);
  });

  test("readAllPages refuses an unordered read", async () => {
    await expect(readAllPages(() => null, { orderBy: [] })).rejects.toThrow(/unique orderBy/);
  });
});

describe("T5 cap reached means UNAVAILABLE", () => {
  test("every page full, maxPages 2: complete false", async () => {
    const stub = trackedStub({
      pages: { commerce_order_items: ({ from }) => synItemPage(1000, from) },
      tables: { commerce_orders: ordersFor(synItemPage(2000)) },
    });
    const read = await readCanonicalCommerceSales(stub, { branchId: SYN_BRANCH, start: DAY.start, end: DAY.end, maxPages: 2 });
    expect(read.complete).toBe(false);
    expect(read.rows).toHaveLength(2000);
    const summary = summarizeIngredientConsumptionWithTruth({
      ingredient: MILK,
      branchId: SYN_BRANCH,
      window: DAY,
      salesRows: read.rows,
      graphInput: latteGraph(),
      sales: { complete: read.complete, source: read.source, reason: read.reason, orderStatusVerified: read.orderStatusVerified },
    });
    expectUnavailable(summary, /incomplete sales read/);
  });

  test("end to end: the Ask NAC tool refuses a total when the sales pager hits its cap", async () => {
    const stub = trackedStub({
      pages: { commerce_order_items: ({ from }) => synItemPage(1000, from, { date: "2026-10-11" }) },
      tables: consumptionTables({ items: [], orders: ordersFor(synItemPage(50000, 0, { date: "2026-10-11" })) }),
    });
    const result = await queryIngredientConsumption(stub, {
      question: "How much SYN-milk should Khobar have consumed yesterday?",
      now: SYN_NOW,
      profile: SYN_PROFILE,
    });
    expectUnavailable(result, /incomplete sales read/);
  });
});

describe("T6 short server page (max_rows below pageSize)", () => {
  test("500-row pages x3 then empty: complete, 1500 rows", async () => {
    const all = synItemPage(1500);
    const stub = trackedStub({
      pages: { commerce_order_items: ({ call }) => (call < 3 ? all.slice(call * 500, call * 500 + 500) : []) },
      tables: { commerce_orders: ordersFor(all) },
    });
    const read = await readCanonicalCommerceSales(stub, { branchId: SYN_BRANCH, start: DAY.start, end: DAY.end, pageSize: 1000 });
    expect(read.complete).toBe(true);
    expect(read.rows).toHaveLength(1500);
    const ranges = rangeCalls(stub, "commerce_order_items").map((call) => call.args[0]);
    expect(ranges).toEqual([0, 500, 1000, 1500]);
  });

  test("server max_rows cap on a real table: offsets advance by rows received", async () => {
    const all = synItemPage(1500);
    const stub = trackedStub({ tables: { commerce_order_items: all, commerce_orders: ordersFor(all) }, maxRows: { commerce_order_items: 500 } });
    const read = await readCanonicalCommerceSales(stub, { branchId: SYN_BRANCH, start: DAY.start, end: DAY.end, pageSize: 1000 });
    expect(read.complete).toBe(true);
    expect(read.rows).toHaveLength(1500);
    expect(new Set(read.rows.map((row) => row.sourceOrderItemId)).size).toBe(1500);
  });
});

function legacyRows(count, offset = 0, period = { start: "2026-10-10", end: "2026-10-10" }) {
  return Array.from({ length: count }, (_, i) => ({
    id: `SYN-L-${String(offset + i).padStart(6, "0")}`,
    branch_id: SYN_BRANCH,
    raw_item_name: "SYN Latte",
    matched_menu_item_id: "SYN-M-LATTE",
    quantity_sold: 1,
    is_modifier: false,
    semantic_class: "menu_item",
    period_start: period.start,
    period_end: period.end,
  }));
}

const MISSING = { code: "42P01", message: 'relation "public.commerce_order_items" does not exist' };

describe("T7 legacy fallback truncation", () => {
  test("commerce missing: legacy paged and ordered, complete only after an empty page", async () => {
    const stub = trackedStub({
      errors: { commerce_order_items: MISSING },
      pages: { foodics_sales_items: ({ from }) => (from < 2000 ? legacyRows(1000, from) : []) },
    });
    const sales = await loadAuthoritativeSales(stub, SYN_BRANCH, DAY);
    expect(sales.source).toBe("foodics_sales_items");
    expect(sales.complete).toBe(true);
    expect(sales.rows).toHaveLength(2000);
    expect(rangeCalls(stub, "foodics_sales_items").map((call) => call.args[0])).toEqual([0, 1000, 2000]);
    expectOrderedRequests(stub, "foodics_sales_items", ["id"]);
  });

  test("cap reached on legacy: complete false and the consumption result is UNAVAILABLE", async () => {
    const stub = trackedStub({
      errors: { commerce_order_items: MISSING },
      pages: { foodics_sales_items: ({ from }) => legacyRows(1000, from) },
    });
    const sales = await loadAuthoritativeSales(stub, SYN_BRANCH, DAY, { maxPages: 2 });
    expect(sales.complete).toBe(false);
    const summary = summarizeIngredientConsumptionWithTruth({
      ingredient: MILK,
      branchId: SYN_BRANCH,
      window: DAY,
      salesRows: sales.rows,
      graphInput: latteGraph(),
      sales,
    });
    expectUnavailable(summary, /incomplete sales read/);
  });

  test("a non-missing-relation commerce error is thrown, not silently replaced by legacy", async () => {
    const stub = trackedStub({ errors: { commerce_order_items: { code: "42501", message: "permission denied" } } });
    await expect(loadAuthoritativeSales(stub, SYN_BRANCH, DAY)).rejects.toMatchObject({ code: "42501" });
    expect(stub.readsOf("foodics_sales_items")).toHaveLength(0);
  });
});

describe("T8 legacy overlap semantics", () => {
  test("a 05..11 batch row overlapping a 10..10 window is read, then refused (never silently excluded)", async () => {
    const row = legacyRows(1, 0, { start: "2026-10-05", end: "2026-10-11" })[0];
    const stub = trackedStub({ tables: { foodics_sales_items: [row] } });
    const read = await readLegacyFoodicsSales(stub, { branchId: SYN_BRANCH, start: DAY.start, end: DAY.end });
    expect(read.rows).toHaveLength(1);
    expect(read.unsplittableRows).toBe(1);
    const summary = summarizeIngredientConsumptionWithTruth({
      ingredient: MILK,
      branchId: SYN_BRANCH,
      window: DAY,
      salesRows: read.rows,
      graphInput: latteGraph(),
      sales: { ...read, orderStatusVerified: true },
    });
    expectUnavailable(summary, /multi-day import cannot be split by day/);
  });

  test("a row inside the window is used", async () => {
    const stub = trackedStub({ tables: { foodics_sales_items: legacyRows(2) } });
    const read = await readLegacyFoodicsSales(stub, { branchId: SYN_BRANCH, start: DAY.start, end: DAY.end });
    expect(read.unsplittableRows).toBe(0);
    const summary = summarizeIngredientConsumptionWithTruth({
      ingredient: MILK, branchId: SYN_BRANCH, window: DAY, salesRows: read.rows, graphInput: latteGraph(), sales: { ...read, orderStatusVerified: true },
    });
    expect(summary.status).toBe("PROVISIONAL");
    expect(summary.quantity).toBe("200");
    expect(summary.postsStock).toBe(false);
  });
});

describe("T28 (B)", () => {
  test("no insert/update/upsert/delete/rpc on any stub in this file", () => {
    expect(allTrackedWriteCalls()).toEqual([]);
  });
});
