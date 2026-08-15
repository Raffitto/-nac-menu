/**
 * Service-mix, conversion, attachment, and percentage-point definitions.
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

const FIXTURE = `
  function ord(id, net, type = "dine_in") {
    return { source: "synthetic", sourceOrderId: id, sourceRevision: "1", branchId: "khobar", businessDate: "2026-08-01", openedAt: null, closedAt: null, orderType: type, tableId: null, covers: 2, subtotal: net, discount: 0, tax: 0, netSales: net, status: "completed", ingestedAt: "2026-08-15T00:00:00Z" };
  }
  function it(orderId, family, name, net = 10) {
    return { source: "synthetic", sourceOrderId: orderId, sourceOrderItemId: orderId + name, branchId: "khobar", businessDate: "2026-08-01", productId: name, canonicalMenuItemId: name, itemName: name, sourceCategory: null, canonicalCategory: family, quantity: 1, grossAmount: net, discountAmount: 0, netAmount: net, status: "completed" };
  }
  const orders = [ord("d1", 40), ord("d2", 35), ord("f1", 180), ord("f2", 200), ord("fs1", 260), ord("c1", 22)];
  const items = [
    it("d1", "dessert", "Pavlova", 40),
    it("d2", "dessert", "Brownie", 20), it("d2", "coffee", "Latte", 15),
    it("f1", "food", "Big NAC", 180),
    it("f2", "food", "Big NAC", 160), it("f2", "coffee", "Americano", 40),
    it("fs1", "food", "Big NAC", 180), it("fs1", "dessert", "Brownie", 80),
    it("c1", "coffee", "Flat White", 22),
  ];
  const sessions = mod.buildDineInSessions(orders, items);
  const mix = mod.summarizeServiceMix(sessions, { branchId: "khobar", periodStart: "2026-08-01", periodEnd: "2026-08-14", source: "synthetic" });
`;

describe("service-mix metric definitions", () => {
  test("shares and dessert conversion use the correct denominators", () => {
    const out = run(`
      ${FIXTURE}
      return {
        total: mix.totalSessions,
        dessertFocused: mix.dessertFocusedShare,
        foodContaining: mix.foodContainingShare,
        full: mix.fullServiceShare,
        conversion: mix.dessertConversion,
        coffeeLed: mix.coffeeLedShare,
      };
    `);
    expect(out.total).toBe(6);
    expect(out.dessertFocused).toBeCloseTo(2 / 6);
    expect(out.foodContaining).toBeCloseTo(3 / 6);
    expect(out.full).toBeCloseTo(1 / 6);
    expect(out.conversion).toBeCloseTo(1 / 3);
    expect(out.coffeeLed).toBeCloseTo(2 / 6);
  });

  test("percentage points lead mix comparisons", () => {
    const out = run(`
      ${FIXTURE}
      const prevSessions = sessions.map((s) => ({ ...s, archetype: s.archetype === "dessert_only" ? "food_only" : s.archetype }));
      const prev = mod.summarizeServiceMix(prevSessions, { branchId: "khobar", periodStart: "2026-07-01", periodEnd: "2026-07-31" });
      const cmp = mod.compareServiceMix(mix, prev);
      return { pp: cmp.dessertFocusedPp, text: mod.mixComparisonAnswer(cmp) };
    `);
    expect(out.text).toMatch(/percentage points/i);
    expect(out.text).not.toMatch(/^Dessert-focused share was .* equivalent to/i);
  });

  test("attachment uses target denominator", () => {
    const out = run(`
      ${FIXTURE}
      const rate = mod.attachmentRate(
        sessions,
        (s) => s.items.some((i) => i.itemName === "Big NAC"),
        (s) => s.items.some((i) => i.canonicalCategory === "dessert"),
      );
      return rate;
    `);
    expect(out).toBeCloseTo(1 / 3);
  });

  test("product mapping does not guess dessert from a sweet-sounding unknown name", () => {
    const out = run(`
      return mod.mapCanonicalFamily({ sourceName: "Honey Cloud", nacCategoryId: null });
    `);
    expect(out).toBe("unclassified");
  });

  test("ingest gates fail closed on empty downloads and missing ids", () => {
    const out = run(`
      return {
        empty: mod.gateCommerceExport({ headers: ["order_id"], requiredHeaders: ["order_id"], rowCount: 0, missingIds: 0, duplicateIds: 0, unclassifiedRate: 0, operatingDayExpected: true }),
        ids: mod.gateCommerceExport({ headers: ["order_id"], requiredHeaders: ["order_id"], rowCount: 10, missingIds: 2, duplicateIds: 0, unclassifiedRate: 0.1 }),
      };
    `);
    expect(out.empty.ok).toBe(false);
    expect(out.empty.errors).toContain("empty_operating_day");
    expect(out.ids.ok).toBe(false);
    expect(out.ids.errors).toContain("missing_source_ids");
  });
});
