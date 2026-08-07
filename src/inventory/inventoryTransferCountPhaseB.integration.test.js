import fs from "fs";
import path from "path";

const migration = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/migrations/20260807120000_inventory_transfer_count_operations.sql"
  ),
  "utf8"
);

describe("Phase B transfer and multi-location count schema contract", () => {
  test("models an audited transfer lifecycle without immediate destination posting", () => {
    expect(migration).toContain("create table if not exists public.inventory_transfers");
    expect(migration).toContain("'draft', 'requested', 'approved', 'dispatched', 'received', 'closed'");
    expect(migration).toContain("inventory_dispatch_transfer");
    expect(migration).toContain("'transfer_out'");
    expect(migration).toContain("inventory_receive_transfer");
    expect(migration).toContain("'transfer_in'");
    expect(migration.indexOf("'transfer_in'")).toBeGreaterThan(
      migration.indexOf("create or replace function public.inventory_receive_transfer")
    );
  });

  test("validates source and destination branches and locations server-side", () => {
    expect(migration).toContain("source_branch_id text not null");
    expect(migration).toContain("destination_branch_id text not null");
    expect(migration).toContain("l.branch_id = v_source_branch and l.active");
    expect(migration).toContain("l.branch_id = v_destination_branch and l.active");
    expect(migration).toContain("inventory_can_approve(v_transfer.source_branch_id)");
    expect(migration).toContain("inventory_can_approve(v_transfer.destination_branch_id)");
    expect(migration).not.toMatch(/default\s+'khobar'/i);
    expect(migration).not.toMatch(/branch_id\s+in\s*\(\s*'khobar'/i);
  });

  test("preserves dispatch/receipt quantities and reports discrepancies", () => {
    expect(migration).toContain("sent_quantity numeric");
    expect(migration).toContain("received_quantity numeric");
    expect(migration).toContain("'transfer_mismatch'");
    expect(migration).toContain("Received quantity differs from dispatched quantity.");
    expect(migration).toContain("'difference', v_received - v_line.sent_quantity");
  });

  test("prevents the legacy instant-paired transfer RPC from bypassing custody", () => {
    expect(migration).toContain(
      "revoke execute on function public.inventory_create_transfer(jsonb, text) from authenticated"
    );
  });

  test("groups location counts into a branch-owned count session", () => {
    expect(migration).toContain("create table if not exists public.inventory_count_sessions");
    expect(migration).toContain("count_session_id uuid references public.inventory_count_sessions");
    expect(migration).toContain("inventory_stock_counts_session_location_uidx");
    expect(migration).toContain("inventory_count_session_item_totals");
    expect(migration).toContain("as selected_location_count");
    expect(migration).toContain("as counted_location_count");
    expect(migration).toContain("as has_uncounted_location");
    expect(migration).toContain("sum(l.counted_quantity) as counted_quantity");
  });

  test("snapshots expected stock, keeps source units, and reuses Phase A warnings", () => {
    expect(migration).toContain("m.effective_at <= v_count.effective_at");
    expect(migration).toContain("source_counted_quantity");
    expect(migration).toContain("source_count_unit");
    expect(migration).toContain("conversion_factor");
    expect(migration).toContain("v_normalized_quantity - (v_source_quantity * v_conversion)");
    expect(migration).toContain("count_session_line_saved");
    expect(migration).toContain("inventory_submit_stock_count");
    expect(migration).toContain("inventory_approve_stock_count");
  });

  test("uses explicit review and approval before idempotent count posting", () => {
    expect(migration).toContain("p_target_status = 'reviewed'");
    expect(migration).toContain("p_target_status = 'approved'");
    expect(migration).toContain("p_target_status = 'posted'");
    expect(migration).toContain("coalesce(p_idempotency_key, 'count-session:'");
    expect(migration).toContain("inventory_guard_session_count_posting");
    expect(migration).toContain("s.status = 'approved'");
  });

  test("keeps mutations in security-definer RPCs and reads branch-scoped", () => {
    expect(migration).toContain("alter table public.inventory_transfers enable row level security");
    expect(migration).toContain("alter table public.inventory_count_sessions enable row level security");
    expect(migration).toContain("inventory_transfers_branch");
    expect(migration).toContain("inventory_count_sessions_branch");
    expect(migration).not.toMatch(/grant\s+(?:insert|update|delete)\s+on\s+public\.inventory_transfers/i);
    expect(migration).not.toMatch(/grant\s+(?:insert|update|delete)\s+on\s+public\.inventory_count_sessions/i);
  });
});
