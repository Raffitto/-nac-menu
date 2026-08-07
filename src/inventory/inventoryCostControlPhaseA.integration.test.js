import fs from "fs";
import path from "path";

const migration = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/migrations/20260807090000_inventory_cost_control_phase_a.sql",
  ),
  "utf8",
);

describe("Inventory & Cost Control Phase A schema contract", () => {
  test("extends the canonical item and movement models", () => {
    expect(migration).toMatch(/alter table public\.inventory_ingredients/);
    expect(migration).toMatch(/inventory_classification text not null/);
    expect(migration).toMatch(/recipe_cost_eligible boolean not null/);
    expect(migration).toMatch(/alter table public\.inventory_movements/);
    expect(migration).toMatch(/business_date date/);
    expect(migration).toMatch(/evidence_metadata jsonb/);
  });

  test("posts explicit operational source events into the immutable ledger", () => {
    expect(migration).toMatch(/create table if not exists public\.inventory_operational_events/);
    expect(migration).toMatch(/create table if not exists public\.inventory_operational_event_lines/);
    expect(migration).toMatch(/'disposal'/);
    expect(migration).toMatch(/'staff_meal'/);
    expect(migration).toMatch(/'production_waste'/);
    expect(migration).toMatch(/source_type, source_id/);
    expect(migration).toMatch(/'operational_event'/);
  });

  test("keeps calculated production context distinct from recorded waste", () => {
    expect(migration).toMatch(/production_context jsonb/);
    expect(migration).toMatch(/line_role text not null/);
    expect(migration).toMatch(/'recorded_waste'/);
    expect(migration).not.toMatch(/movement_type[^;]*theoretical_yield_loss/);
  });

  test("does not post a draft count and requires warning confirmation", () => {
    const posting = migration.match(
      /create or replace function public\.inventory_approve_stock_count[\s\S]*?create or replace function public\.inventory_resolve_exception/,
    )?.[0] || "";
    expect(posting).toMatch(/status not in \('submitted', 'reviewed', 'approved'\)/);
    expect(posting).toMatch(/Unusual count warnings require privileged confirmation and a reason/);
    expect(posting).toMatch(/physical_count_adjustment/);
    expect(posting).toMatch(/inventory_audit_log/);
  });

  test("adds deterministic count guardrails and preserves source count evidence", () => {
    expect(migration).toMatch(/inventory_build_count_guardrails/);
    expect(migration).toMatch(/source_counted_quantity/);
    expect(migration).toMatch(/source_count_unit/);
    expect(migration).toMatch(/pack_conversion_anomaly/);
    expect(migration).toMatch(/possible_grams_as_kilograms/);
  });

  test("keeps exceptions and related items branch-scoped with server-side approval", () => {
    expect(migration).toMatch(/create table if not exists public\.inventory_exceptions/);
    expect(migration).toMatch(/create table if not exists public\.inventory_related_items/);
    expect(migration).toMatch(/alter table public\.inventory_exceptions enable row level security/);
    expect(migration).toMatch(/public\.inventory_branch_allowed\(branch_id\)/);
    expect(migration).toMatch(/public\.inventory_can_approve\(branch_id\)/);
    expect(migration).not.toMatch(/grant (?:insert|update|delete)[^;]*inventory_exceptions/i);
  });
});
