import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "../..");
const schema = fs.readFileSync(
  path.join(root, "supabase/migrations/20260714200000_inventory_procurement_foundation.sql"),
  "utf8"
);
const transactions = fs.readFileSync(
  path.join(root, "supabase/migrations/20260714201000_inventory_transactions_rls_and_costing.sql"),
  "utf8"
);
const rlsHardening = fs.readFileSync(
  path.join(root, "supabase/migrations/20260714202000_inventory_supplier_catalogue_rls_hardening.sql"),
  "utf8"
);
const backdatedCosting = fs.readFileSync(
  path.join(root, "supabase/migrations/20260714203000_inventory_backdated_cost_rebuild.sql"),
  "utf8"
);
const reviewResolution = fs.readFileSync(
  path.join(root, "supabase/migrations/20260714204000_inventory_review_exception_resolution.sql"),
  "utf8"
);
const edge = fs.readFileSync(
  path.join(root, "supabase/functions/inventory-invoice-ocr/index.ts"),
  "utf8"
);
const provider = fs.readFileSync(
  path.join(root, "supabase/functions/_shared/inventoryInvoiceOcr.ts"),
  "utf8"
);
const api = fs.readFileSync(path.join(root, "src/lib/inventoryApi.js"), "utf8");

describe("inventory procurement schema contract", () => {
  test.each([
    "inventory_ingredients",
    "inventory_suppliers",
    "inventory_supplier_catalogue_items",
    "inventory_supplier_item_aliases",
    "inventory_invoices",
    "inventory_invoice_lines",
    "inventory_purchase_receipts",
    "inventory_purchase_receipt_lines",
    "inventory_movements",
    "inventory_ingredient_cost_history",
    "inventory_recipes",
    "inventory_stock_counts",
    "inventory_audit_log",
  ])("creates %s", (table) => {
    expect(schema).toContain(`create table if not exists public.${table}`);
  });

  test("uses precise numeric types and never float storage", () => {
    expect(schema).toMatch(/numeric\(24,10\)/);
    expect(schema).not.toMatch(/\b(?:real|double precision|float\d*)\b/i);
  });

  test("retains operational and recorded timestamps", () => {
    expect(schema).toMatch(/effective_at timestamptz not null/);
    expect(schema).toMatch(/recorded_at timestamptz not null default now\(\)/);
  });

  test("keeps source invoice, OCR evidence, and original supplier wording", () => {
    expect(schema).toMatch(/storage_path text not null/);
    expect(schema).toMatch(/raw_ocr_text text/);
    expect(schema).toMatch(/structured_extraction jsonb/);
    expect(schema).toMatch(/ocr_evidence jsonb/);
    expect(schema).toMatch(/original_description text not null/);
    expect(schema).toMatch(/interpretation_snapshot jsonb not null/);
  });

  test("protects duplicate invoice effects with unique idempotency keys", () => {
    expect(schema).toMatch(/idempotency_key text not null unique/g);
    expect(schema).toMatch(/inventory_invoices_posted_supplier_number_uidx/);
    expect(transactions).toMatch(/already_posted/);
    expect(transactions).toMatch(/duplicate_blocked/);
  });

  test("derives current stock from immutable movements", () => {
    expect(schema).toMatch(/create or replace view public\.inventory_current_stock/);
    expect(schema).toMatch(/sum\(m\.signed_canonical_quantity\)/);
    expect(transactions).toMatch(/inventory_movements_immutable/);
    expect(transactions).toMatch(/create a reversal or correction/i);
  });
});

describe("transactional approval and costing contract", () => {
  test("approval validates state, matches, conversions, and blocking exceptions", () => {
    expect(transactions).toMatch(/Invoice cannot post from status/);
    expect(transactions).toMatch(/Every active invoice line must have a verified ingredient and conversion/);
    expect(transactions).toMatch(/Blocking invoice exceptions must be resolved/);
  });

  test("review corrections and explicit exception overrides remain audited", () => {
    expect(reviewResolution).toMatch(/inventory_resolve_invoice_exception/);
    expect(reviewResolution).toMatch(/A resolution reason is required/);
    expect(reviewResolution).toMatch(/duplicate_overridden/);
    expect(reviewResolution).toMatch(/inventory_audit_log/);
  });

  test("one RPC atomically creates receipt, movements, cost, variance and snapshots", () => {
    const functionBody = transactions.match(
      /create or replace function public\.inventory_approve_and_post_invoice[\s\S]*?create or replace function public\.inventory_create_operational_movement/
    )?.[0] || "";
    expect(functionBody).toContain("inventory_purchase_receipts");
    expect(functionBody).toContain("inventory_purchase_receipt_lines");
    expect(functionBody).toContain("inventory_movements");
    expect(functionBody).toContain("inventory_ingredient_cost_history");
    expect(functionBody).toContain("inventory_price_variance_alerts");
    expect(functionBody).toContain("inventory_recalculate_recipe_costs");
  });

  test("historical stock is based on effective time", () => {
    expect(transactions).toMatch(/inventory_stock_as_of/);
    expect(transactions).toMatch(/m\.effective_at <= p_as_of/);
  });

  test("weighted average handles non-positive stock explicitly", () => {
    expect(transactions).toMatch(/if v_existing_qty <= 0 then/);
    expect(transactions).toMatch(/pathologicalExistingStock/);
  });

  test("backdated receipts rebuild derived costs in effective-time order", () => {
    expect(backdatedCosting).toMatch(/order by h\.effective_at, h\.recorded_at, h\.id/);
    expect(backdatedCosting).toMatch(/inventory_rebuild_ingredient_cost_history/);
    expect(backdatedCosting).toMatch(/inventory_invoice_posted_cost_rebuild/);
  });

  test("recipe costing supports effective versions and nested recipes", () => {
    expect(transactions).toMatch(/inventory_recipe_cost_component/);
    expect(transactions).toMatch(/sub_recipe_id/);
    expect(transactions).toMatch(/v\.effective_from <= p_as_of/);
  });

  test("menu margin reads selling price but does not update menu items", () => {
    expect(transactions).toMatch(/from public\.menu_items/);
    expect(transactions).not.toMatch(/update public\.menu_items/);
    expect(transactions).toMatch(/gross_margin_percentage/);
  });

  test("physical count approval and corrections are idempotent ledger operations", () => {
    expect(transactions).toMatch(/inventory_approve_stock_count/);
    expect(transactions).toMatch(/physical_count_adjustment/);
    expect(transactions).toMatch(/inventory_reverse_movement/);
    expect(transactions).toMatch(/p_idempotency_key \|\| ':reversal'/);
  });
});

describe("branch RLS and protected source files", () => {
  test("enables RLS across inventory domain", () => {
    expect(transactions).toMatch(/alter table public\.%I enable row level security/);
    expect(transactions).toMatch(/inventory_branch_allowed/);
    expect(transactions).toMatch(/inventory_can_approve/);
  });

  test("approval checks permissions server-side", () => {
    expect(transactions).toMatch(/if not public\.inventory_can_approve\(v_invoice\.branch_id\)/);
    expect(transactions).toMatch(/raise exception 'Invoice approval denied'/);
  });

  test("ordinary authenticated clients cannot mutate ledger directly", () => {
    expect(transactions).toMatch(/revoke all on public\.%I from anon, authenticated/);
    expect(transactions).not.toMatch(/grant (?:insert|update|delete)[^;]*inventory_movements/i);
  });

  test("invoice storage is private and branch scoped", () => {
    expect(schema).toMatch(/'inventory-invoices',\s*'inventory-invoices',\s*false/);
    expect(transactions).toMatch(/inventory_invoices_storage_select/);
    expect(transactions).toMatch(/split_part\(name, '\/', 1\)/);
  });

  test("supplier catalogue and alias policies qualify outer supplier IDs", () => {
    expect(rlsHardening).toMatch(
      /sb\.supplier_id = inventory_supplier_catalogue_items\.supplier_id/
    );
    expect(rlsHardening).toMatch(
      /sb\.supplier_id = inventory_supplier_item_aliases\.supplier_id/
    );
  });
});

describe("OCR provider and workflow contract", () => {
  test("provider abstraction is vendor replaceable", () => {
    expect(provider).toMatch(/interface InvoiceOcrProvider/);
    expect(provider).toMatch(/extractInvoice\(document/);
    expect(provider).toMatch(/createInvoiceOcrProvider/);
  });

  test("OpenAI extraction uses strict structured output and keeps evidence", () => {
    expect(provider).toMatch(/json_schema/);
    expect(provider).toMatch(/strict: true/);
    expect(provider).toMatch(/rawText/);
    expect(provider).toMatch(/boundingBox/);
    expect(provider).toMatch(/modelVersion/);
  });

  test("OCR success stores header and line extraction", () => {
    expect(edge).toMatch(/inventory_invoice_lines/);
    expect(edge).toMatch(/structured_extraction: extracted/);
    expect(edge).toMatch(/ocr_status: "completed"/);
    expect(edge).toMatch(/event_type: "ocr_completed"/);
  });

  test("OCR failures are durable and retryable", () => {
    expect(edge).toMatch(/status: "ocr_failed"/);
    expect(edge).toMatch(/ocr_status: "failed"/);
    expect(edge).toMatch(/event_type: "ocr_failed"/);
    expect(edge).toMatch(/attempt_count/);
  });

  test("uncertain lines enter review and are never auto-posted", () => {
    expect(edge).toMatch(/best\?\.confidence >= 0\.95/);
    expect(edge).toMatch(/review_status: "needs_review"/);
    expect(edge).not.toMatch(/inventory_approve_and_post_invoice/);
  });

  test("frontend service exposes invoice upload, review, approval and histories", () => {
    [
      "uploadInvoice",
      "triggerInvoiceOcr",
      "retrieveOcrResult",
      "generateMatchCandidates",
      "confirmLineMapping",
      "approveInvoice",
      "fetchInventoryBalance",
      "fetchStockAsOf",
      "fetchCostHistory",
      "fetchRecipeCost",
      "fetchMenuItemMargin",
    ].forEach((name) => expect(api).toContain(`function ${name}`));
  });

  test("Food Bible overview loads editable branch menu catalogue", () => {
    const fn = api.match(/export async function fetchFoodBibleOverview[\s\S]*?^}/m)?.[0] || "";
    expect(fn).toContain("fetchMenuCatalogueForBranch");
    expect(fn).not.toContain("getFullMenu");
  });
});
