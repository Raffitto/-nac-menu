/**
 * Oracle D1 — C. Status, refunds, modifiers, sources (T9-T13).
 */
import { readCanonicalCommerceSales } from "../truth/readers";
import { classifyCommerceItemRow, mapCommerceItemRow } from "../truth/salesSource";
import { summarizeIngredientConsumptionWithTruth } from "../truth/ingredientConsumption";
import { allTrackedWriteCalls, trackedStub } from "../__fixtures__/oracle-d1/supabaseStub";
import { latteGraph, ordersFor, SYN_BRANCH, SYN_INGREDIENTS, synItem, synOrder } from "../__fixtures__/oracle-d1/synFixtures";

const MILK = { id: SYN_INGREDIENTS.milk.id, name: SYN_INGREDIENTS.milk.canonical_name };

async function readWindow(tables, start, end) {
  const stub = trackedStub({ tables });
  return readCanonicalCommerceSales(stub, { branchId: SYN_BRANCH, start, end });
}

function summarize(read, window) {
  return summarizeIngredientConsumptionWithTruth({
    ingredient: MILK,
    branchId: SYN_BRANCH,
    window,
    salesRows: read.rows,
    graphInput: latteGraph(),
    sales: read,
  });
}

describe("T9 order status gates items", () => {
  test("completed item on a void order is not eligible", async () => {
    const item = synItem({ id: "SYN-I1", orderId: "SYN-O1", quantity: 2, menuItemId: "SYN-M-LATTE" });
    const read = await readWindow({
      commerce_order_items: [item],
      commerce_orders: [synOrder({ id: "SYN-O1", status: "void" })],
    }, "2026-10-10", "2026-10-10");
    expect(read.rows).toEqual([]);
    expect(read.droppedRows).toEqual({ total: 1, byReason: { order_void: 1 } });
    expect(read.orderStatusVerified).toBe(true);
    const summary = summarize(read, { start: "2026-10-10", end: "2026-10-10", label: "2026-10-10" });
    expect(summary.status).toBe("UNAVAILABLE");
    expect(summary.quantity).toBeNull();
    expect(summary.postsStock).toBe(false);
  });

  test("an item whose order row is missing is not eligible", () => {
    expect(classifyCommerceItemRow(synItem({ id: "SYN-I9" }), { orderStatus: null })).toMatchObject({ kind: "dropped", reason: "order_not_found" });
  });

  test("order status unreadable -> UNAVAILABLE, not assumed completed", async () => {
    const item = synItem({ id: "SYN-I1", orderId: "SYN-O1", quantity: 2, menuItemId: "SYN-M-LATTE" });
    const stub = trackedStub({ tables: { commerce_order_items: [item] }, errors: { commerce_orders: { message: "permission denied for commerce_orders" } } });
    const read = await readCanonicalCommerceSales(stub, { branchId: SYN_BRANCH, start: "2026-10-10", end: "2026-10-10" });
    expect(read.orderStatusVerified).toBe(false);
    const summary = summarize(read, { start: "2026-10-10", end: "2026-10-10", label: "2026-10-10" });
    expect(summary.status).toBe("UNAVAILABLE");
    expect(summary.reason).toMatch(/Order status could not be read/);
    expect(summary.postsStock).toBe(false);
  });
});

describe("T10 refund nets", () => {
  const window = { start: "2026-10-09", end: "2026-10-10", label: "2026-10-09 to 2026-10-10" };

  test("sale 3 on 09 + refund -1 on 10 referencing the item = driver 2 units (200 ml)", async () => {
    const sale = synItem({ id: "SYN-I2", orderId: "SYN-O2", date: "2026-10-09", quantity: 3, menuItemId: "SYN-M-LATTE", name: "SYN Latte" });
    const refund = synItem({ id: "SYN-I2-R1", orderId: "SYN-O2R", date: "2026-10-10", quantity: -1, status: "refunded", menuItemId: "SYN-M-LATTE", name: "SYN Latte" });
    const read = await readWindow({ commerce_order_items: [sale, refund], commerce_orders: ordersFor([sale, refund]) }, window.start, window.end);
    expect(read.refunds).toEqual({ rows: 1, unnetted: 0 });
    const summary = summarize(read, window);
    expect(summary.status).toBe("PROVISIONAL");
    expect(summary.quantity).toBe("200");
    expect(summary.unit).toBe("millilitre");
    expect(summary.links.reduce((sum, link) => sum + Number(link.soldQuantity), 0)).toBe(2);
    expect(summary.postsStock).toBe(false);
  });

  test("unknown refund representation (positive line marked refunded) -> UNAVAILABLE, never 3", async () => {
    const sale = synItem({ id: "SYN-I2", orderId: "SYN-O2", date: "2026-10-09", quantity: 3, menuItemId: "SYN-M-LATTE" });
    const refund = synItem({ id: "SYN-I2-R1", orderId: "SYN-O2R", date: "2026-10-10", quantity: 1, status: "refunded", menuItemId: "SYN-M-LATTE" });
    const read = await readWindow({ commerce_order_items: [sale, refund], commerce_orders: ordersFor([sale, refund]) }, window.start, window.end);
    const summary = summarize(read, window);
    expect(summary.status).toBe("UNAVAILABLE");
    expect(summary.quantity).toBeNull();
    expect(summary.reason).toMatch(/refunds are not netted/);
    expect(summary.postsStock).toBe(false);
  });

  test("a refund that cannot be attributed to a menu item -> UNAVAILABLE", async () => {
    const sale = synItem({ id: "SYN-I2", orderId: "SYN-O2", date: "2026-10-09", quantity: 3, menuItemId: "SYN-M-LATTE" });
    const refund = synItem({ id: "SYN-I2-R1", orderId: "SYN-O2R", date: "2026-10-10", quantity: -1, status: "refunded", menuItemId: null });
    const read = await readWindow({ commerce_order_items: [sale, refund], commerce_orders: ordersFor([sale, refund]) }, window.start, window.end);
    const summary = summarize(read, window);
    expect(summary.status).toBe("UNAVAILABLE");
    expect(summary.reason).toMatch(/refunds are not netted/);
  });

  test("refunds exceeding in-window sales -> UNAVAILABLE", async () => {
    const refund = synItem({ id: "SYN-I3-R", orderId: "SYN-O3R", date: "2026-10-10", quantity: -2, status: "refunded", menuItemId: "SYN-M-LATTE" });
    const sale = synItem({ id: "SYN-I4", orderId: "SYN-O4", date: "2026-10-10", quantity: 1, menuItemId: "SYN-M-LATTE" });
    const read = await readWindow({ commerce_order_items: [sale, refund], commerce_orders: ordersFor([sale, refund]) }, window.start, window.end);
    const summary = summarize(read, window);
    expect(summary.status).toBe("UNAVAILABLE");
    expect(summary.reason).toMatch(/Refunds exceed sales/);
  });
});

describe("T11 unknown status is not 'completed'", () => {
  test("status null and 'weird' are excluded and counted in droppedRows", async () => {
    const rows = [
      synItem({ id: "SYN-I-NULL", status: null, menuItemId: "SYN-M-LATTE" }),
      synItem({ id: "SYN-I-WEIRD", status: "weird", menuItemId: "SYN-M-LATTE" }),
    ];
    expect(mapCommerceItemRow(rows[0])).toBeNull();
    expect(mapCommerceItemRow(rows[1])).toBeNull();
    const read = await readWindow({ commerce_order_items: rows, commerce_orders: ordersFor(rows) }, "2026-10-10", "2026-10-10");
    expect(read.rows).toEqual([]);
    expect(read.droppedRows).toEqual({ total: 2, byReason: { missing_item_status: 1, unknown_item_status: 1 } });
  });
});

describe("T12 modifiers", () => {
  // BLOCKED: the target, rel:foodicsAdapter.ts adaptFoodicsConsoleOrder, is on the
  // unmerged rel branch (163d0ca) and is not on main. This test must not import it.
  test.todo("T12 SKIPPED (not on main): adaptFoodicsConsoleOrder emits a typed modifier row linked to its parent line (rel:foodicsAdapter.ts unmerged)");

  test("main-only guard: a row flagged as a modifier never counts as a sold menu item", () => {
    const summary = summarizeIngredientConsumptionWithTruth({
      ingredient: MILK,
      branchId: SYN_BRANCH,
      window: { start: "2026-10-10", end: "2026-10-10", label: "2026-10-10" },
      salesRows: [
        { matched_menu_item_id: "SYN-M-LATTE", raw_item_name: "SYN Latte", quantity_sold: 1, business_date: "2026-10-10" },
        { matched_menu_item_id: "SYN-M-LATTE", raw_item_name: "SYN-OPT1 extra milk", quantity_sold: 5, is_modifier: true, business_date: "2026-10-10" },
      ],
      graphInput: latteGraph(),
      sales: { complete: true, orderStatusVerified: true },
    });
    expect(summary.quantity).toBe("100");
    expect(summary.coverageDetail.modifierRowsExcluded).toBe(1);
    expect(summary.postsStock).toBe(false);
  });
});

describe("T13 single source", () => {
  test("the same order published as foodics and csv: one row, never doubled", async () => {
    const foodics = synItem({ id: "SYN-I5", orderId: "SYN-O5", quantity: 2, menuItemId: "SYN-M-LATTE", source: "foodics" });
    const csv = synItem({ id: "SYN-I5", orderId: "SYN-O5", quantity: 2, menuItemId: "SYN-M-LATTE", source: "csv" });
    const stub = trackedStub({ tables: { commerce_order_items: [foodics, csv], commerce_orders: ordersFor([foodics, csv]) } });
    const read = await readCanonicalCommerceSales(stub, { branchId: SYN_BRANCH, start: "2026-10-10", end: "2026-10-10" });
    expect(read.rows).toHaveLength(1);
    expect(read.rows[0].commerceSource).toBe("foodics");
    expect(stub.readsOf("commerce_order_items", "eq").some((call) => call.args[0] === "source" && call.args[1] === "foodics")).toBe(true);
    const summary = summarize(read, { start: "2026-10-10", end: "2026-10-10", label: "2026-10-10" });
    expect(summary.quantity).toBe("200");
  });

  test("a non-authoritative source row reaching the classifier is dropped as other_source", () => {
    expect(classifyCommerceItemRow(synItem({ id: "SYN-I6", source: "csv" }), { orderStatus: "completed" }))
      .toMatchObject({ kind: "dropped", reason: "other_source" });
  });
});

describe("T28 (C)", () => {
  test("no insert/update/upsert/delete/rpc on any stub in this file", () => {
    expect(allTrackedWriteCalls()).toEqual([]);
  });
});
