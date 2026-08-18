/**
 * Canonical table-mix intelligence — acceptance probes for NAC-COMMERCE-0001.
 */
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");

function run(body) {
  const script = `
    global.Deno = { env: { get: () => undefined } };
    import(${JSON.stringify(fabricPath)}).then(async (mod) => {
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out));
    }).catch((err) => { console.error(err); process.exit(1); });
  `;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  }).trim());
}

const FIXTURE = `
  function ord(id, net, date = "2026-08-01", branch = "khobar") {
    return {
      source: "synthetic", sourceOrderId: id, sourceRevision: "1", branchId: branch,
      businessDate: date, openedAt: null, closedAt: null, orderType: "dine_in",
      tableId: null, covers: 2, subtotal: net, discount: 0, tax: 0, netSales: net,
      status: "completed", ingestedAt: "2026-08-15T00:00:00Z",
    };
  }
  function it(orderId, family, name, net = 10) {
    return {
      source: "synthetic", sourceOrderId: orderId, sourceOrderItemId: orderId + name,
      branchId: "khobar", businessDate: "2026-08-01", productId: name,
      canonicalMenuItemId: family === "unclassified" ? null : name,
      itemName: name, sourceCategory: null, canonicalCategory: family,
      quantity: 1, grossAmount: net, discountAmount: 0, netAmount: net, status: "completed",
    };
  }
  const orders = [ord("d1", 40), ord("d2", 35), ord("f1", 180), ord("f2", 200), ord("fs1", 260), ord("c1", 22), ord("u1", 15)];
  const items = [
    it("d1", "dessert", "Pavlova", 40),
    it("d2", "dessert", "Brownie", 20), it("d2", "coffee", "Latte", 15),
    it("f1", "food", "Big NAC", 180),
    it("f2", "food", "Big NAC", 160), it("f2", "coffee", "Americano", 40),
    it("fs1", "food", "Big NAC", 180), it("fs1", "dessert", "Brownie", 80),
    it("c1", "coffee", "Flat White", 22),
    it("u1", "unclassified", "Mystery", 15),
  ];
`;

describe("canonical table-mix aggregator", () => {
  test("single-period dessert-focused, food-containing, and conversion shares", () => {
    const out = run(`
      ${FIXTURE}
      const result = mod.computeTableMix({
        orders, items, branchId: "khobar", periodStart: "2026-08-01", periodEnd: "2026-08-14", source: "synthetic",
      });
      return {
        dessertFocused: result.mix.dessertFocusedShare,
        foodContaining: result.mix.foodContainingShare,
        conversion: result.mix.dessertConversion,
        dessertAtAll: result.mix.dessertAtAllShare,
        total: result.mix.totalSessions,
      };
    `);
    expect(out.total).toBe(7);
    expect(out.dessertFocused).toBeCloseTo(2 / 7);
    expect(out.foodContaining).toBeCloseTo(3 / 7);
    expect(out.conversion).toBeCloseTo(1 / 3);
    expect(out.dessertAtAll).toBeCloseTo(3 / 7);
  });

  test("archetype counts sum to total sessions including unclassified", () => {
    const out = run(`
      ${FIXTURE}
      const result = mod.computeTableMix({
        orders, items, branchId: "khobar", periodStart: "2026-08-01", periodEnd: "2026-08-14", source: "synthetic",
      });
      const sum = Object.values(result.mix.byArchetype).reduce((n, row) => n + row.sessions, 0);
      return { total: result.mix.totalSessions, sum, unclassified: result.mix.byArchetype.unclassified.sessions };
    `);
    expect(out.sum).toBe(out.total);
    expect(out.unclassified).toBe(1);
    expect(out.total).toBe(7);
  });

  test("comparison deltas use percentage points, not ratio change", () => {
    const out = run(`
      ${FIXTURE}
      const current = mod.computeTableMix({
        orders, items, branchId: "khobar", periodStart: "2026-08-01", periodEnd: "2026-08-14", source: "synthetic",
      });
      const prevOrders = orders.map((o) => ({ ...o, businessDate: "2026-07-15" }));
      const prevItems = items.map((i) => ({ ...i, businessDate: "2026-07-15" }));
      const previous = mod.computeTableMix({
        orders: prevOrders, items: prevItems, branchId: "khobar", periodStart: "2026-07-01", periodEnd: "2026-07-31", source: "synthetic",
      });
      const cmp = mod.compareTableMixPeriods(current, previous);
      return {
        pp: cmp.dessertFocusedPp,
        text: mod.mixComparisonAnswer(cmp),
        current: cmp.current.dessertFocusedShare,
        previous: cmp.previous.dessertFocusedShare,
      };
    `);
    expect(out.pp).toBeCloseTo(0);
    expect(out.text).toMatch(/percentage-point/i);
    expect(out.current).toBeCloseTo(out.previous);
  });

  test("RBAC blocks cross-branch store access", () => {
    const out = run(`
      const store = mod.createMemoryCommerceStore({
        orders: [{ source_order_id: "o1", branch_id: "jeddah", business_date: "2026-08-01", opened_at: null, closed_at: null, order_type: "dine_in", covers: 2, subtotal: 50, tax: 0, net_sales: 50, status: "completed" }],
        items: [{ source_order_id: "o1", source_order_item_id: "i1", branch_id: "jeddah", business_date: "2026-08-01", product_id: "p1", canonical_menu_item_id: "m1", item_name: "Brownie", canonical_category: "dessert", quantity: 1, net_amount: 50, status: "completed" }],
        coverage: { branchId: "jeddah", startDate: "2026-08-01", endDate: "2026-08-14" },
      });
      const scope = mod.createIntelligenceScope({
        primaryBranchId: "jeddah",
        branchIds: ["jeddah"],
        allowedBranchIds: ["khobar"],
        canSeeNetwork: false,
      });
      return mod.computeTableMixFromStore({
        store,
        scope,
        period: { startDate: "2026-08-01", endDate: "2026-08-14" },
      });
    `);
    expect(out.ok).toBe(false);
    expect(out.rbacBlocked).toBe(true);
  });

  test("incomplete mapping discloses diagnostics without fabricating archetypes", () => {
    const out = run(`
      function ord(id, net) {
        return { source: "synthetic", sourceOrderId: id, sourceRevision: "1", branchId: "khobar", businessDate: "2026-08-01", openedAt: null, closedAt: null, orderType: "dine_in", tableId: null, covers: 2, subtotal: net, discount: 0, tax: 0, netSales: net, status: "completed", ingestedAt: "2026-08-15T00:00:00Z" };
      }
      function it(orderId, family, name, net = 10) {
        return { source: "synthetic", sourceOrderId: orderId, sourceOrderItemId: orderId + name, branchId: "khobar", businessDate: "2026-08-01", productId: name, canonicalMenuItemId: null, itemName: name, sourceCategory: null, canonicalCategory: family, quantity: 1, grossAmount: net, discountAmount: 0, netAmount: net, status: "completed" };
      }
      const result = mod.computeTableMix({
        orders: [ord("u1", 15)],
        items: [it("u1", "unclassified", "Mystery", 15)],
        branchId: "khobar", periodStart: "2026-08-01", periodEnd: "2026-08-14", source: "synthetic",
      });
      return {
        archetype: result.mix.byArchetype.unclassified.sessions,
        unmappedShare: result.diagnostics.unmappedItemRowShare,
        coverageComplete: result.diagnostics.coverageComplete,
      };
    `);
    expect(out.archetype).toBe(1);
    expect(out.unmappedShare).toBe(1);
    expect(out.coverageComplete).toBe(false);
  });

  test("Cash Up authority unchanged for headline sales", () => {
    const out = run(`
      return {
        headline: mod.selectSourceAuthority({ commercialMetric: "net_sales" }),
        session: mod.selectSourceAuthority({ commerceFocus: "session_mix" }),
      };
    `);
    expect(out.headline).toBe("cash_up");
    expect(out.session).toBe("canonical_commerce_sessions");
  });

  test("average check by archetype is available when revenue exists", () => {
    const out = run(`
      ${FIXTURE}
      const result = mod.computeTableMix({
        orders, items, branchId: "khobar", periodStart: "2026-08-01", periodEnd: "2026-08-14", source: "synthetic",
      });
      const text = mod.checkByTypeAnswer(result.mix);
      return {
        dessertOnly: result.averageCheckByArchetype.dessert_only,
        text,
      };
    `);
    expect(out.dessertOnly).toBeCloseTo(40);
    expect(out.text).toMatch(/dessert-only SAR/);
  });

  test("compare intent routes to session_mix not dessert_focused alone", () => {
    const out = run(`
      return mod.extractCommerceFocus("Compare dessert table mix this month vs last month");
    `);
    expect(out).toBe("session_mix");
  });

  test("store-backed compute answers dessert tables from canonical rows", () => {
    const out = run(`
      const store = mod.createMemoryCommerceStore({
        orders: [
          { source_order_id: "d1", branch_id: "khobar", business_date: "2026-08-14", opened_at: null, closed_at: null, order_type: "dine_in", covers: 2, subtotal: 40, tax: 0, net_sales: 40, status: "completed" },
          { source_order_id: "f1", branch_id: "khobar", business_date: "2026-08-14", opened_at: null, closed_at: null, order_type: "dine_in", covers: 2, subtotal: 180, tax: 0, net_sales: 180, status: "completed" },
        ],
        items: [
          { source_order_id: "d1", source_order_item_id: "i1", branch_id: "khobar", business_date: "2026-08-14", product_id: "p1", canonical_menu_item_id: "m1", item_name: "Brownie", canonical_category: "dessert", quantity: 1, net_amount: 40, status: "completed" },
          { source_order_id: "f1", source_order_item_id: "i2", branch_id: "khobar", business_date: "2026-08-14", product_id: "p2", canonical_menu_item_id: "m2", item_name: "Big NAC", canonical_category: "food", quantity: 1, net_amount: 180, status: "completed" },
        ],
        coverage: { branchId: "khobar", startDate: "2026-08-01", endDate: "2026-08-14" },
      });
      const scope = mod.createIntelligenceScope({
        primaryBranchId: "khobar",
        branchIds: ["khobar"],
        allowedBranchIds: ["khobar"],
        canSeeNetwork: false,
      });
      const computed = await mod.computeTableMixFromStore({
        store,
        scope,
        period: { startDate: "2026-08-01", endDate: "2026-08-14" },
      });
      const published = mod.tableMixToPublishedCommerce(computed.result);
      return {
        ok: computed.ok,
        dessertFocused: computed.result.mix.dessertFocusedShare,
        text: mod.answerPublishedCommerce("dessert_focused", published),
      };
    `);
    expect(out.ok).toBe(true);
    expect(out.dessertFocused).toBeCloseTo(0.5);
    expect(out.text).toMatch(/50\.0%/);
    expect(out.text).toMatch(/dessert-focused/i);
  });
});
