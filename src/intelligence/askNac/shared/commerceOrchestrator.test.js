/**
 * Acquisition registry, async matching, atomic publication, freshness, readiness.
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
  }).trim());
}

describe("commerce acquisition orchestrator", () => {
  test("registry prefers auto-detect for orders with items companion", () => {
    const out = run(`
      const orders = mod.getDataset("orders");
      return {
        preferred: orders.preferredMode,
        companions: orders.requiredCompanions,
        max: orders.maxRangeDays,
        group: orders.publicationGroup,
      };
    `);
    expect(out.preferred).toBe("auto_detect");
    expect(out.companions).toContain("order_items");
    expect(out.max).toBe(31);
    expect(out.group).toBe("commerce_sessions");
  });

  test("detects direct vs async Foodics responses", () => {
    const out = run(`
      return {
        direct: mod.detectAcquisitionMode({ downloadedBytes: 1200, contentDisposition: "attachment; filename=a.csv" }),
        async: mod.detectAcquisitionMode({ responseBody: { message: "orders data exports being processing" } }),
      };
    `);
    expect(out.direct).toBe("direct_download");
    expect(out.async).toBe("async_email");
  });

  test("async email matches pending request and quarantines unmatched", () => {
    const out = run(`
      const pending = [mod.createExportRequest({
        id: "req-1",
        dataset: "order_items",
        branchId: "khobar",
        periodStart: "2026-08-14",
        periodEnd: "2026-08-14",
        requestedAt: "2026-08-15T18:00:00.000Z",
        sourceRequestId: "EXP-99",
        sourceResponse: {},
        deliveryMode: "async_email",
        companionDataset: "orders",
        status: "waiting_async_delivery",
      })];
      const hit = mod.matchAsyncExportEmail(pending, {
        sender: "noreply@foodics.com",
        subject: "Foodics export",
        exportType: "Orders Items",
        branchName: "NAC Al Khobar",
        periodStart: "2026-08-14",
        periodEnd: "2026-08-14",
        exportReference: "EXP-99",
        receivedAt: "2026-08-15T18:20:00.000Z",
      });
      const miss = mod.matchAsyncExportEmail(pending, {
        sender: "promo@example.com",
        subject: "Weekend offers",
      });
      return { hit, miss };
    `);
    expect(out.hit.status).toBe("matched");
    expect(out.miss.status).toBe("unmatched");
  });

  test("atomic publication waits for companion then publishes both", () => {
    const out = run(`
      let g = { id: "g1", groupName: "commerce_sessions", branchId: "khobar", periodStart: "2026-08-01", periodEnd: "2026-08-14", status: "requested", ordersBatchId: null, itemsBatchId: null };
      g = mod.applyPublicationEvent(g, "orders_received");
      const waiting = { ...g };
      g = mod.applyPublicationEvent(g, "items_received");
      g = mod.applyPublicationEvent(g, "quality_passed");
      return { waiting: waiting.status, both: g.status, can: mod.canPublishSessions(g) };
    `);
    expect(out.waiting).toBe("waiting_for_companion");
    expect(out.both).toBe("quality_passed");
    expect(out.can).toBe(true);
  });

  test("coverage intersection uses the earlier complete date", () => {
    const out = run(`
      return mod.intersectCoverage([
        { dataset: "cash_up", through: "2026-08-14" },
        { dataset: "orders", through: "2026-08-14" },
        { dataset: "order_items", through: "2026-08-12" },
      ]);
    `);
    expect(out.commonThrough).toBe("2026-08-12");
    expect(out.mismatched).toBe(true);
  });

  test("session_mix is not ready without mapping quality", () => {
    const out = run(`
      return mod.evaluateCapabilityReadiness({
        capability: "commerce.session_mix",
        available: { orders: true, order_items: true, product_mapping: true },
        unclassifiedRate: 0.6,
      });
    `);
    expect(out.ready).toBe(false);
    expect(out.missing).toContain("mapping_quality");
  });

  test("CSV adapter and idempotent upsert keep stable keys", () => {
    const out = run(`
      const csv = "Order ID,Business Date,Branch,Status,Type,Guests,Total\\n" +
        "aaa,2026-08-14,NAC Al Khobar,Done,Dine In,2,100\\n";
      const first = mod.adaptFoodicsOrdersCsv(csv);
      const second = mod.upsertOrders(first.orders, first.orders);
      const itemsCsv = "Order ID,Order Item ID,Product ID,Product Name,Quantity,Total,Branch,Business Date,Status\\n" +
        "aaa,line-1,prod-1,Brownie,1,40,NAC Al Khobar,2026-08-14,Done\\n";
      const items = mod.adaptFoodicsOrderItemsCsv(itemsCsv, [{ sourceProductId: "prod-1", explicitFamily: "dessert" }]);
      return {
        n: first.orders.length,
        after: second.length,
        family: items.items[0].canonicalCategory,
        join: mod.joinRate(first.orders, items.items),
      };
    `);
    expect(out.n).toBe(1);
    expect(out.after).toBe(1);
    expect(out.family).toBe("dessert");
    expect(out.join).toBe(1);
  });

  test("mailbox adapter is isolated when credentials are absent", () => {
    const out = run(`
      return { available: mod.mailboxAvailable({}), blocker: Boolean(mod.MAILBOX_ADAPTER.blocker) };
    `);
    expect(out.available).toBe(false);
    expect(out.blocker).toBe(true);
  });

  test("guest-weighted mix differs from session mix", () => {
    const out = run(`
      const sessions = [
        { sourceOrderId: "d", branchId: "khobar", businessDate: "2026-08-01", closedAt: null, covers: 1, netSales: 40, itemCount: 1, flags: {}, archetype: "dessert_only", items: [] },
        { sourceOrderId: "f", branchId: "khobar", businessDate: "2026-08-01", closedAt: null, covers: 4, netSales: 200, itemCount: 2, flags: {}, archetype: "food_only", items: [] },
      ];
      const mix = mod.summarizeServiceMix(sessions, { branchId: "khobar", periodStart: "2026-08-01", periodEnd: "2026-08-14" });
      return { session: mix.dessertFocusedShare, guest: mix.guestWeightedDessertFocusedShare, dessertAtAll: mix.dessertAtAllShare };
    `);
    expect(out.session).toBeCloseTo(0.5);
    expect(out.guest).toBeCloseTo(0.2);
    expect(out.dessertAtAll).toBeCloseTo(0.5);
  });

  test("published commerce answers dessert tables vs food tables", () => {
    const out = run(`
      const sessions = [
        { sourceOrderId: "d", branchId: "khobar", businessDate: "2026-08-01", closedAt: null, covers: 2, netSales: 40, itemCount: 1, flags: {}, archetype: "dessert_only", items: [] },
        { sourceOrderId: "f", branchId: "khobar", businessDate: "2026-08-01", closedAt: null, covers: 2, netSales: 180, itemCount: 1, flags: {}, archetype: "food_only", items: [] },
      ];
      const mix = mod.summarizeServiceMix(sessions, { branchId: "khobar", periodStart: "2026-08-01", periodEnd: "2026-08-14", source: "foodics" });
      const text = mod.answerPublishedCommerce("session_mix", { mix });
      return { text, focus: mod.extractCommerceFocus("What's the percentage of dessert tables vs food tables this month?") };
    `);
    expect(out.focus).toBe("session_mix");
    expect(out.text).toMatch(/50\.0%/);
    expect(out.text).toMatch(/food-containing/);
  });
});
