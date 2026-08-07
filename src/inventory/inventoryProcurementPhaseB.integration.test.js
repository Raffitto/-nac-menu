import fs from "fs";
import path from "path";

const migration = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/migrations/20260807110000_inventory_procurement_receiving_control.sql"
  ),
  "utf8"
);
const manualReceiving = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/migrations/20260807111500_inventory_manual_receiving_line.sql"
  ),
  "utf8"
);
const overReceiptException = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/migrations/20260807112000_inventory_exception_over_receipt.sql"
  ),
  "utf8"
);

describe("Phase B procurement and receiving schema contract", () => {
  test("creates branch-scoped purchase orders with the required lifecycle and lines", () => {
    expect(migration).toContain("create table if not exists public.inventory_purchase_orders");
    expect(migration).toContain("create table if not exists public.inventory_purchase_order_lines");
    [
      "draft", "submitted", "approved", "partially_received", "received",
      "closed", "cancelled", "rejected",
    ].forEach((status) => expect(migration).toContain(`'${status}'`));
    expect(migration).toContain("normalized_base_quantity");
    expect(migration).toContain("expected_unit_cost");
    expect(migration).toContain("inventory_create_purchase_order");
    expect(migration).toContain("inventory_transition_purchase_order");
    expect(migration).toMatch(/destination_location_id[\s\S]*is_default_receiving/);
  });

  test("links OCR invoices and canonical receipts to purchase orders without replacing the ledger", () => {
    expect(migration).toMatch(/alter table public\.inventory_invoices[\s\S]*purchase_order_id/);
    expect(migration).toMatch(/alter table public\.inventory_purchase_receipts[\s\S]*purchase_order_id/);
    expect(migration).toContain("inventory_link_invoice_purchase_order");
    expect(migration).toContain("inventory_prepare_receipt_po_link");
    expect(migration).toContain("inventory_prepare_receipt_line_po_link");
    expect(migration).not.toMatch(/create table[^;]*current_stock/i);
  });

  test("supports partial, multiple, completed, and over receipts", () => {
    expect(migration).toContain("inventory_purchase_order_progress");
    expect(migration).toContain("remaining_quantity");
    expect(migration).toContain("inventory_refresh_purchase_order_progress");
    expect(migration).toContain("'partially_received'");
    expect(migration).toContain("'received'");
    expect(migration).toContain("'over_receipt'");
    expect(migration).toContain("'po_over_receipt'");
    expect(migration).toContain("'blocking'");
    expect(migration).toContain("Over-receipt requires privileged exception resolution with a reason");
    expect(overReceiptException).toContain("'over_receipt'");
    expect(overReceiptException).toContain("inventory_exceptions_exception_type_check");
  });

  test("posts supplier returns as immutable negative ledger movements with source linkage", () => {
    const body = migration.match(
      /create or replace function public\.inventory_post_supplier_return[\s\S]*?drop trigger if exists inventory_supplier_returns_immutable/
    )?.[0] || "";
    expect(body).toContain("inventory_supplier_returns");
    expect(body).toContain("inventory_supplier_return_lines");
    expect(body).toContain("'return_to_supplier'");
    expect(body).toContain("-abs(v_quantity)");
    expect(body).toContain("original_receipt_id");
    expect(body).toContain("original_receipt_line_id");
    expect(body).toContain("inventory_movements");
    expect(migration).toContain("inventory_supplier_return_lines_immutable");
  });

  test("keeps raw evidence, normalized values, business dates, and audit history", () => {
    [
      "source_item_name", "source_sku", "source_quantity", "source_unit",
      "normalized_quantity", "canonical_unit", "business_date",
      "document_date", "evidence_metadata", "inventory_audit_log",
    ].forEach((field) => expect(migration).toContain(field));
  });

  test("reuses deterministic exceptions and blocks direct ledger mutation", () => {
    expect(migration).toContain("inventory_exceptions");
    expect(migration).toContain("zero_cost_anomaly");
    expect(migration).toContain("po_line_mapping_required");
    expect(migration).not.toMatch(/grant (?:insert|update|delete)[^;]*inventory_movements/i);
  });

  test("enforces server-side branch access and exposes no anonymous writes", () => {
    expect(migration).toContain("inventory_branch_allowed(v_branch)");
    expect(migration).toContain("inventory_can_approve(v_branch)");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on public.inventory_purchase_orders from anon, authenticated");
    expect(migration).not.toMatch(/grant\s+(?:insert|update|delete)\s+on\s+public\.inventory_purchase_orders/i);
  });

  test("keeps new operational scope branch-first without hardcoded branch names", () => {
    expect(migration).not.toMatch(/branch_id\s+in\s*\(\s*'khobar'/i);
    expect(migration).not.toMatch(/default\s+'khobar'/i);
    expect(migration).toContain("branch_id text not null");
    expect(migration).toContain("destination_branch_id text not null");
    expect(migration).toContain("inventory_branch_allowed");
  });

  test("supports audited source-backed manual receiving without paid OCR", () => {
    expect(manualReceiving).toContain("inventory_add_manual_invoice_line");
    expect(manualReceiving).toContain("inventory_branch_allowed");
    expect(manualReceiving).toContain("inventory_can_approve");
    expect(manualReceiving).toContain("sourceDescription");
    expect(manualReceiving).toContain("canonicalQuantity");
    expect(manualReceiving).toContain("manual_invoice_line_created");
    expect(manualReceiving).toContain("sourceEvidencePreserved");
    expect(manualReceiving).not.toMatch(/\b(?:openai|anthropic|ocr_processing)\b/i);
  });
});
