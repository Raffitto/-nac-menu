import fs from "fs";
import path from "path";

const migration = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/migrations/20260807130000_inventory_recipe_cost_trust.sql",
  ),
  "utf8",
);
const performanceMigration = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/migrations/20260807131000_inventory_cost_health_performance.sql",
  ),
  "utf8",
);

describe("Phase C historical recipe cost trust schema contract", () => {
  test("uses explicit branch authorization and business-date historical WAC", () => {
    expect(migration).toContain("inventory_recipe_cost_trust_as_of");
    expect(migration).toContain("p_branch_id text");
    expect(migration).toContain("p_as_of date");
    expect(migration).toContain("inventory_branch_allowed(p_branch_id)");
    expect(migration).toContain("h.weighted_average_cost as \"weightedAverageCost\"");
    expect(migration).toContain("h.effective_at <= v_as_of");
    expect(migration).not.toMatch(/default\s+'khobar'/i);
  });

  test("keeps missing and zero costs distinct", () => {
    for (const status of [
      "VALID_COST",
      "LEGITIMATE_ZERO_COST",
      "MISSING_COST",
      "NO_HISTORICAL_COST",
      "UNRESOLVED_ITEM",
      "UNRESOLVED_UNIT",
      "STALE_COST",
      "INVALID_RECIPE_LINE",
      "INCOMPLETE_SUBRECIPE",
    ]) {
      expect(migration).toContain(status);
    }
    expect(migration).toContain("legitimate_zero_cost");
    expect(migration).not.toContain("coalesce(v_component_cost, 0)");
  });

  test("recursively retains subrecipe evidence and detects cycles", () => {
    expect(migration).toContain("inventory_recipe_cost_trust_component");
    expect(migration).toContain("p_recipe_id = any(coalesce(p_path");
    expect(migration).toContain("'componentCost', v_nested");
    expect(migration).toContain("'costHistoryId'");
    expect(migration).toContain("'HISTORICAL_WEIGHTED_AVERAGE_COST'");
  });

  test("applies version-pinned output, yield, portions, and effective dates", () => {
    expect(migration).toContain("add column if not exists output_quantity");
    expect(migration).toContain("v_version.yield_percentage / 100.0");
    expect(migration).toContain("VERSION_OUTPUT_NOT_SNAPSHOTTED");
    expect(migration).toContain("inventory_activate_recipe_version");
    expect(migration).toContain("effective_to = p_effective_from");
    expect(migration).toContain("status = 'retired'");
  });

  test("gates product margins and exposes compact cost coverage", () => {
    expect(migration).toContain("inventory_product_cost_trust_as_of");
    expect(migration).toContain("COST_DATA_INCOMPLETE");
    expect(migration).toContain("'foodCostPercentage', case");
    expect(migration).toContain("when v_trusted");
    expect(migration).toContain("inventory_cost_health_as_of");
    expect(migration).toContain("'recipeCoveragePct'");
  });

  test("does not mutate canonical stock, cost history, purchases, or snapshots", () => {
    expect(migration).not.toMatch(/insert\s+into\s+public\.inventory_movements/i);
    expect(migration).not.toMatch(/update\s+public\.inventory_movements/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.inventory_ingredient_cost_history/i);
    expect(migration).not.toMatch(/update\s+public\.inventory_ingredient_cost_history/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.inventory_recipe_cost_snapshots/i);
    expect(migration).not.toMatch(/update\s+public\.inventory_recipe_cost_snapshots/i);
    expect(migration).not.toMatch(/update\s+public\.inventory_purchase/i);
  });

  test("keeps calculated cost read-only and revokes helper access", () => {
    expect(migration).toContain("stable");
    expect(migration).toContain(
      "revoke all on function public.inventory_recipe_cost_trust_component",
    );
    expect(migration).toContain(
      "grant execute on function public.inventory_recipe_cost_trust_as_of",
    );
    expect(migration).toContain(
      "grant execute on function public.inventory_cost_health_as_of",
    );
  });

  test("batches missing-recipe coverage instead of calling one RPC per menu item", () => {
    expect(performanceMigration).toContain("jsonb_agg(");
    expect(performanceMigration).toContain("and not exists (");
    const productCall = "public.inventory_product_cost_trust_as_of(";
    expect(performanceMigration.match(new RegExp(productCall.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")))
      .toHaveLength(1);
    expect(performanceMigration).toContain("v_costed_recipe_ids");
  });
});
