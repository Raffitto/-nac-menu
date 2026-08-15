const path = require("path");
const { execFileSync } = require("child_process");
const fixture = require("./fixtures/foodics-order-getting.json");

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

describe("Foodics console order adapter", () => {
  test("maps a real Done dine-in order to one session and skips separator lines", () => {
    const out = run(`
      const payload = ${JSON.stringify(fixture)};
      const { order, items } = mod.adaptFoodicsConsolePayload(payload);
      const sessions = mod.buildDineInSessions([order], items);
      return {
        id: order.sourceOrderId,
        branch: order.branchId,
        type: order.orderType,
        status: order.status,
        covers: order.covers,
        net: order.netSales,
        itemCount: items.length,
        names: items.map((i) => i.itemName),
        families: items.map((i) => i.canonicalCategory),
        sessionCount: sessions.length,
        archetype: sessions[0] && sessions[0].archetype,
        completed: mod.isCompletedDineInSession(order),
      };
    `);
    expect(out.id).toBe("78aeffe9-589d-4e95-92c4-47e9e4fd3661");
    expect(out.branch).toBe("khobar");
    expect(out.type).toBe("dine_in");
    expect(out.status).toBe("completed");
    expect(out.covers).toBe(2);
    expect(out.net).toBe(103);
    expect(out.itemCount).toBe(3);
    expect(out.names).toEqual(["Cookies", "Sparkling Water-SM", "Still Water"]);
    expect(out.families.every((f) => f === "unclassified")).toBe(true);
    expect(out.sessionCount).toBe(1);
    expect(out.archetype).toBe("unclassified");
    expect(out.completed).toBe(true);
  });

  test("explicit product map classifies without name guessing", () => {
    const out = run(`
      const payload = ${JSON.stringify(fixture)};
      const { items } = mod.adaptFoodicsConsolePayload(payload, [
        { sourceProductId: "973550dc-f5c8-4bc2-a0df-e5f294c7f14f", explicitFamily: "dessert" },
        { sourceProductId: "9edc6edc-b6cb-4d01-88df-a693829694e5", nacCategoryId: "drinks" },
        { sourceProductId: "976fc5e0-dd79-45ce-b38f-390e09facb59", nacCategoryId: "drinks" },
      ]);
      const flags = mod.flagsFromItems(items);
      return { families: items.map((i) => i.canonicalCategory), archetype: mod.classifyTableArchetype(flags) };
    `);
    expect(out.families).toEqual(["dessert", "other_beverage", "other_beverage"]);
    expect(out.archetype).toBe("dessert_only");
  });

  test("NAC dessert section maps Cookies without sweet-name guessing", () => {
    const out = run(`
      const mapped = mod.mapFromMenuCatalog("prod-cookies", "Cookies", [
        { id: "menu-cookies", name: "Crushed Milk Chocolate Cookies", categorySlug: "desserts", sectionName: "Desserts" },
        { id: "menu-cookies-brunch", name: "Crushed Milk Chocolate Cookies", categorySlug: "brunch", sectionName: "Sweets" },
      ]);
      return { family: mod.mapCanonicalFamily(mapped), menu: mapped.canonicalMenuItemId };
    `);
    expect(out.family).toBe("dessert");
    expect(out.menu).toBeTruthy();
  });

  test("re-adapting the same order keeps stable keys", () => {
    const out = run(`
      const payload = ${JSON.stringify(fixture)};
      const a = mod.adaptFoodicsConsolePayload(payload);
      const b = mod.adaptFoodicsConsolePayload(payload);
      return {
        order: a.order.sourceOrderId === b.order.sourceOrderId,
        item: a.items[0].sourceOrderItemId === b.items[0].sourceOrderItemId,
        revision: a.order.sourceRevision === b.order.sourceRevision,
      };
    `);
    expect(out.order).toBe(true);
    expect(out.item).toBe(true);
    expect(out.revision).toBe(true);
  });
});
