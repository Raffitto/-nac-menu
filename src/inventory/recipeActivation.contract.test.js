import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "../..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260909180000_activate_inventory_recipe_version.sql"),
  "utf8",
);
const api = fs.readFileSync(path.join(root, "src/lib/inventoryApi.js"), "utf8");

describe("recipe activation contract", () => {
  test("unique index guarantees one active version per recipe", () => {
    expect(migration).toMatch(/inventory_recipe_versions_one_active_uidx/);
    expect(migration).toMatch(/where status = 'active'/);
  });

  test("does not replace production inventory_activate_recipe_version with a weaker swap", () => {
    expect(migration).toMatch(/inventory_activate_recipe_version/);
    expect(migration).not.toMatch(/create or replace function public\.activate_inventory_recipe_version/);
    expect(migration).toMatch(/UNRESOLVED_RECIPE_LINE/);
  });

  test("client forks a new draft from active and activates through the existing RPC", () => {
    expect(api).toMatch(/mustForkNewDraft\(liveVersion\.status\)/);
    expect(api).toMatch(/Create forked recipe draft/);
    expect(api).toMatch(/inventory_activate_recipe_version/);
    expect(api).toMatch(/export async function activateRecipeVersion/);
    expect(api).toMatch(/export function pickWorkingVersion/);
  });
});
