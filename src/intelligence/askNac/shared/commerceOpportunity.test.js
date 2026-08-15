/**
 * Opportunity model and cross-branch decomposition fixtures.
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

describe("opportunity and decomposition", () => {
  test("current volume + alternative mix is labeled an estimate", () => {
    const out = run(`
      function empty() {
        return { sessions: 0, netSales: 0, covers: 0, items: 0, dessertItems: 0, foodItems: 0, beverageItems: 0 };
      }
      function mix(branch, dessert, food) {
        const by = {
          dessert_only: { ...empty(), sessions: dessert, netSales: dessert * 40 },
          coffee_only: empty(),
          dessert_and_coffee: empty(),
          food_only: { ...empty(), sessions: food, netSales: food * 200 },
          food_and_beverage: empty(),
          full_service: empty(),
          beverage_only: empty(),
          unclassified: empty(),
        };
        const total = dessert + food;
        return {
          source: "synthetic", branchId: branch, periodStart: "2026-08-01", periodEnd: "2026-08-14",
          completedThrough: "2026-08-14", lastIngestAt: null, totalSessions: total, byArchetype: by,
          dessertFocusedShare: dessert / total, foodContainingShare: food / total,
          fullServiceShare: 0, coffeeLedShare: 0, dessertConversion: 0, unclassifiedRate: 0, coversAvailable: false,
        };
      }
      const khobar = mix("khobar", 6, 4);
      const jeddah = mix("jeddah", 2, 8);
      const opp = mod.currentVolumeAltMixOpportunity(khobar, jeddah, "Khobar volume at Jeddah mix");
      const decomp = mod.decomposeCommercialGap({ current: khobar, other: jeddah });
      return { opp, decompIds: decomp.map((d) => d.id), wording: mod.investigationWording(decomp) };
    `);
    expect(out.opp.isEstimate).toBe(true);
    expect(out.opp.deltaVsCurrent).toBeGreaterThan(0);
    expect(out.decompIds).toEqual(expect.arrayContaining(["session_volume", "archetype_mix", "spend_per_session"]));
    expect(out.wording).toMatch(/not proven causes/i);
  });
});
