import fs from "fs";
import path from "path";

const migrationPath = path.resolve(
  __dirname,
  "../../supabase/migrations/20260807140000_inventory_variance_intelligence.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");

describe("Phase D inventory variance migration contract", () => {
  test("uses branch-authorized batched ledger and count analysis", () => {
    expect(migration).toContain("create or replace function public.inventory_variance_analysis");
    expect(migration).toContain("public.inventory_branch_allowed(p_branch_id)");
    expect(migration).toContain("movement_aggregates as");
    expect(migration).toContain("latest_count as");
    expect(migration).toContain("inventory_movements_branch_business_item_idx");
  });

  test("keeps source movement types separate and avoids source-table double counting", () => {
    [
      "purchase_receipt",
      "return_to_supplier",
      "transfer_in",
      "transfer_out",
      "staff_meal",
      "disposal",
      "operational_use",
      "production_waste",
      "production_consumption",
      "production_output",
      "sale_consumption",
      "order_consumption",
    ].forEach((movementType) => expect(migration).toContain(`'${movementType}'`));
    expect(migration).toContain("'physicalCountAdjustmentExcluded'");
    expect(migration).toContain("not (m.id = any(coalesce(lc.adjustment_ids");
    expect(migration).not.toMatch(/update public\.inventory_movements/i);
    expect(migration).not.toMatch(/delete from public\.inventory_movements/i);
  });

  test("anchors variance to posted count evidence and preserves count quality", () => {
    expect(migration).toContain("s.status = 'posted'");
    expect(migration).toContain("c.status = 'posted'");
    expect(migration).toContain("'hasUncountedLocation'");
    expect(migration).toContain("'warnings'");
    expect(migration).toContain("'overrideReasons'");
    expect(migration).toContain("'expectedSnapshotDifference'");
  });

  test("does not invent theoretical recipe consumption or zero-valued missing cost", () => {
    expect(migration).toContain("'theoreticalRecipeConsumption', null");
    expect(migration).toContain("'NO_HISTORICAL_COST'");
    expect(migration).toContain("'STALE_COST'");
    expect(migration).toMatch(
      /'varianceValue', case[\s\S]*cost_status in \('VALID_COST', 'LEGITIMATE_ZERO_COST'\)[\s\S]*else null/,
    );
  });

  test("provides deterministic evidence IDs, related items, and negative-stock date", () => {
    expect(migration).toContain("'movementId'");
    expect(migration).toContain("'countSessionId'");
    expect(migration).toContain("'costHistoryId'");
    expect(migration).toContain("'exceptionIds'");
    expect(migration).toContain("relationship_edges as");
    expect(migration).toContain("'firstNegativeTheoreticalDate'");
  });

  test("adds a source-preserving review workflow with server-side authorization", () => {
    expect(migration).toContain("create table if not exists public.inventory_variance_reviews");
    expect(migration).toContain("'OPEN', 'REVIEWING', 'EXPLAINED', 'ACTION_REQUIRED', 'RESOLVED', 'DISMISSED'");
    expect(migration).toContain("public.inventory_can_approve(p_branch_id)");
    expect(migration).toContain("'sourceHistoryChanged', false");
    expect(migration).not.toMatch(/update public\.inventory_stock_count_lines/i);
    expect(migration).not.toMatch(/update public\.inventory_ingredient_cost_history/i);
    expect(migration).not.toMatch(/update public\.inventory_recipe/i);
  });

  test("denies anonymous table and RPC access", () => {
    expect(migration).toContain("revoke all on public.inventory_variance_reviews from anon, authenticated");
    expect(migration).toContain("grant select on public.inventory_variance_reviews to authenticated");
    expect(migration).toContain(
      "grant execute on function public.inventory_variance_analysis(text, date, date, uuid, integer) to authenticated",
    );
  });
});
