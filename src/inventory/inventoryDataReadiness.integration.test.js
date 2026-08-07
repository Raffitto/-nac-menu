import fs from "fs";
import path from "path";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260807150000_inventory_real_data_readiness.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");
const rlsPerformanceSql = fs.readFileSync(path.join(
  process.cwd(),
  "supabase/migrations/20260807151000_inventory_sales_rls_performance.sql",
), "utf8");
const hardeningSql = fs.readFileSync(path.join(
  process.cwd(),
  "supabase/migrations/20260807152000_inventory_data_readiness_hardening.sql",
), "utf8");
const onboardingSql = fs.readFileSync(path.join(
  process.cwd(),
  "supabase/migrations/20260807162000_inventory_recipe_cohort_onboarding.sql",
), "utf8");

describe("real-data-readiness migration contract", () => {
  test("stores explicit product intent without replacing canonical recipe linkage", () => {
    expect(sql).toMatch(/create table if not exists public\.inventory_menu_item_costing_intents/);
    expect(sql).toMatch(/menu_item_id uuid not null references public\.menu_items/);
    expect(sql).toMatch(/'recipe_required', 'direct_stock', 'modifier_addon'/);
    expect(sql).toMatch(/inventory_set_menu_item_costing_intent/);
    expect(sql).toMatch(/menu_item_costing_intent_confirmed/);
    expect(sql).toMatch(/inventory_link_menu_item_recipe/);
    expect(sql).toMatch(/Recipe is already linked to another menu item/);
    expect(sql).toMatch(/recipeVersionsChanged/);
  });

  test("requires a reviewed non-overlapping net sales source", () => {
    expect(sql).toMatch(/inventory_sales_consumption_batches/);
    expect(sql).toMatch(/net_of_voids_refunds/);
    expect(sql).toMatch(/Approved sales-consumption periods cannot overlap/);
    expect(sql).toMatch(/Cannot approve an empty sales batch/);
    expect(sql).toMatch(/quantity semantics/);
    expect(hardeningSql).toMatch(/pg_advisory_xact_lock/);
    expect(hardeningSql).toMatch(/Approved sales-consumption periods cannot overlap/);
    expect(hardeningSql).toMatch(/v_covered_days = v_requested_days/);
  });

  test("batches branch-explicit historical recipe consumption", () => {
    expect(sql).toMatch(/inventory_theoretical_consumption\(\s*p_branch_id text,\s*p_period_start date,\s*p_period_end date/);
    expect(sql).toMatch(/with recursive\s+approved_batches as materialized/i);
    expect(sql).toMatch(/rv\.effective_from::date <= sales\.period_start/);
    expect(sql).toMatch(/rv\.effective_to::date > sales\.period_end/);
    expect(sql).toMatch(/inventory_cost_health_as_of\(p_branch_id, batch\.period_end/);
    expect(sql).toMatch(/RECIPE_OR_COST_UNTRUSTED/);
    expect(sql).toMatch(/NO_VERSION_COVERS_SALES_PERIOD/);
    expect(sql).not.toMatch(/update public\.foodics_sales_items/);
  });

  test("supports additive, replacement, and no-stock-effect modifiers", () => {
    expect(sql).toMatch(/'ADDITIVE', 'REPLACEMENT', 'NO_STOCK_EFFECT'/);
    expect(sql).toMatch(/inventory_sales_modifier_aliases/);
    expect(sql).toMatch(/replacement_contributions/);
    expect(sql).toMatch(/-\(root\.sold_quantity \* root\.replaced_quantity\)/);
    expect(sql).toMatch(/UNRESOLVED_MODIFIER_ALIAS/);
    expect(sql).toMatch(/MISSING_MODIFIER_RULE/);
    expect(hardeningSql).toMatch(/inventory_modifier_quantity_factor/);
    expect(hardeningSql).toMatch(/v_output \/ coalesce\(v_version\.portion_count/);
  });

  test("propagates incompleteness as explicit gaps", () => {
    expect(sql).toMatch(/'complete', exists \(select 1 from approved_batches\)/);
    expect(sql).toMatch(/'gaps', coalesce/);
    expect(sql).toMatch(/NO_APPROVED_SALES_SOURCE/);
    expect(sql).toMatch(/when not exists \(select 1 from approved_batches\) then null/);
    expect(hardeningSql).toMatch(/PARTIAL_PERIOD/);
  });

  test("guards recipe activation on the server", () => {
    expect(sql).toMatch(/inventory_validate_recipe_version_activation/);
    expect(sql).toMatch(/UNRESOLVED_RECIPE_LINE/);
    expect(sql).toMatch(/DIRECT_STOCK_REQUIRES_ONE_ITEM/);
    expect(sql).toMatch(/RECIPE_CYCLE/);
    expect(sql).toMatch(/INVALID_SUBRECIPE_VERSION_OR_UNIT/);
    expect(sql).toMatch(/before insert or update of status/);
    expect(hardeningSql).toMatch(/Network recipe linkage requires all-branch authority/);
    expect(hardeningSql).toMatch(/Active or retired recipe versions are immutable/);
    expect(hardeningSql).toMatch(/Lines of active or retired recipe versions are immutable/);
  });

  test("previews duplicate canonical candidates and blocks unsafe creation", () => {
    expect(sql).toMatch(/DUPLICATE_CANDIDATE/);
    expect(sql).toMatch(/Duplicate canonical item candidate requires linking to the existing item/);
    expect(sql).toMatch(/Supplier SKU already belongs to a canonical catalogue item/);
    expect(sql).toMatch(/rawSourcePreserved/);
    expect(sql).toMatch(/match_method = 'manual_review'/);
  });

  test("enforces branch authorization and hardens legacy Foodics RLS", () => {
    expect(sql).toMatch(/inventory_branch_allowed\(p_branch_id\)/);
    expect(sql).toMatch(/inventory_can_approve\(v_batch\.branch_id\)/);
    expect(sql).toMatch(/drop policy if exists foodics_batches_auth/);
    expect(sql).toMatch(/foodics_sales_branch_select/);
    expect(sql).toMatch(/ask_nac_vault_branch_allowed\(branch_id\)/);
    expect(sql).toMatch(/revoke all on public\.inventory_sales_consumption_batches from anon, authenticated/);
    expect(rlsPerformanceSql).toMatch(/inventory_sales_allowed_branches/);
    expect(rlsPerformanceSql).toMatch(/from unnest\(public\.inventory_sales_allowed_branches\(\)\) allowed_branch/);
    expect(hardeningSql).toMatch(/Foodics sales row must match its parent batch branch and period/);
  });

  test("does not rewrite stock, WAC, recipes, or historical sales", () => {
    expect(sql).not.toMatch(/update public\.inventory_movements/);
    expect(sql).not.toMatch(/delete from public\.inventory_movements/);
    expect(sql).not.toMatch(/update public\.inventory_ingredient_cost_history/);
    expect(sql).not.toMatch(/delete from public\.inventory_ingredient_cost_history/);
    expect(sql).toMatch(/update public\.inventory_recipes\s+set menu_item_id = p_menu_item_id/);
    expect(sql).not.toMatch(/update public\.inventory_recipe_versions/);
    expect(sql).not.toMatch(/delete from public\.inventory_recipe_versions/);
    expect(sql).not.toMatch(/delete from public\.inventory_recipes/);
    expect(sql).not.toMatch(/update public\.foodics_sales_items/);
    expect(sql).not.toMatch(/delete from public\.foodics_sales_items/);
  });

  test("stages source-cited recipe cohorts with deterministic blocking checks", () => {
    expect(onboardingSql).toMatch(/inventory_recipe_onboarding_batches/);
    expect(onboardingSql).toMatch(/inventory_preview_recipe_onboarding/);
    expect(onboardingSql).toMatch(/MISSING_SOURCE_FILE/);
    expect(onboardingSql).toMatch(/INGREDIENT_COLLISION/);
    expect(onboardingSql).toMatch(/DUPLICATE_COST_BASELINE/);
    expect(onboardingSql).toMatch(/MISSING_COST_EVIDENCE/);
    expect(onboardingSql).toMatch(/DIRECT_STOCK_REQUIRES_ONE_ITEM/);
    expect(onboardingSql).toMatch(/Only an approved onboarding batch can be applied/);
    expect(onboardingSql).toMatch(/pg_advisory_xact_lock/);
  });

  test("uses approved source-cited cost only after real WAC precedence", () => {
    expect(onboardingSql).toMatch(/inventory_approved_cost_baselines/);
    expect(onboardingSql).toMatch(/source_priority/);
    expect(onboardingSql).toMatch(/approved_external_baseline/);
    expect(onboardingSql).toMatch(/APPROVED_EXTERNAL_BASELINE/);
    expect(onboardingSql).toMatch(/HISTORICAL_WAC_WITH_APPROVED_EXTERNAL_BASELINE/);
    expect(onboardingSql).toMatch(/sourceFileId/);
    expect(onboardingSql).toMatch(/sourceLocator/);
  });

  test("supports explicitly scoped cohort consumption without weakening full coverage", () => {
    expect(onboardingSql).toMatch(/inventory_theoretical_consumption_scope/);
    expect(onboardingSql).toMatch(/'type', 'SELECTED_PRODUCTS'/);
    expect(onboardingSql).toMatch(/EXCLUDED_UNLESS_SEPARATELY_REPORTED/);
    expect(onboardingSql).toMatch(/PARTIAL_PERIOD/);
    expect(onboardingSql).toMatch(/NO_APPROVED_SALES_SOURCE/);
    expect(onboardingSql).toMatch(/inventory_theoretical_consumption\(/);
  });

  test("does not fabricate operational stock or WAC history", () => {
    expect(onboardingSql).not.toMatch(/insert into public\.inventory_movements/);
    expect(onboardingSql).not.toMatch(/insert into public\.inventory_ingredient_cost_history/);
    expect(onboardingSql).not.toMatch(/insert into public\.inventory_purchase_receipts/);
    expect(onboardingSql).not.toMatch(/update public\.inventory_movements/);
    expect(onboardingSql).not.toMatch(/update public\.inventory_ingredient_cost_history/);
    expect(onboardingSql).not.toMatch(/delete from public\.inventory_movements/);
  });
});
