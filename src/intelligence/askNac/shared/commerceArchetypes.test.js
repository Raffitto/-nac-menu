/**
 * Exhaustive mutually exclusive table-archetype classification.
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

function item(family, name = family) {
  return {
    source: "synthetic",
    sourceOrderId: "o1",
    sourceOrderItemId: name,
    branchId: "khobar",
    businessDate: "2026-08-01",
    productId: name,
    canonicalMenuItemId: name,
    itemName: name,
    sourceCategory: null,
    canonicalCategory: family,
    quantity: 1,
    grossAmount: 10,
    discountAmount: 0,
    netAmount: 10,
    status: "completed",
  };
}

describe("table archetypes are mutually exclusive", () => {
  const cases = [
    [["dessert"], "dessert_only"],
    [["coffee"], "coffee_only"],
    [["dessert", "coffee"], "dessert_and_coffee"],
    [["food"], "food_only"],
    [["food", "coffee"], "food_and_beverage"],
    [["food", "other_beverage"], "food_and_beverage"],
    [["food", "dessert"], "full_service"],
    [["food", "dessert", "coffee"], "full_service"],
    [["other_beverage"], "beverage_only"],
    [["unclassified"], "unclassified"],
    [["food", "unclassified"], "food_only"],
    [["dessert", "other_beverage"], "dessert_only"],
    [[], "unclassified"],
  ];

  test.each(cases)("%j → %s", (families, expected) => {
    const out = run(`
      const items = ${JSON.stringify(families.map((f, i) => item(f, f + i)))};
      const flags = mod.flagsFromItems(items);
      return { flags, archetype: mod.classifyTableArchetype(flags) };
    `);
    expect(out.archetype).toBe(expected);
  });

  test("dessert-focused excludes full-service", () => {
    const out = run(`
      return {
        dessert: mod.isDessertFocused("dessert_only"),
        coffeeDessert: mod.isDessertFocused("dessert_and_coffee"),
        full: mod.isDessertFocused("full_service"),
        food: mod.isFoodContaining("full_service"),
      };
    `);
    expect(out.dessert).toBe(true);
    expect(out.coffeeDessert).toBe(true);
    expect(out.full).toBe(false);
    expect(out.food).toBe(true);
  });
});
