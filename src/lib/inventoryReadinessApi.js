import { supabase } from "./supabase";
import { filterRowsByRbacProfile } from "./rbacQueryScope";
import {
  clampInventoryTruthBranch,
  fetchInventoryTruthFoundation,
  fetchInventoryTruthSales,
} from "./inventoryTruthApi";
import { runInventoryReadinessAudit } from "../inventory/truth/readinessAudit";

const MENU_SELECT = "id,name_en,active,branch_id,placement_group_id";
const VERSION_AUDIT_SELECT = "id,recipe_id,version_number,status,yield_percentage,created_at,updated_at,documentation";
const COST_HISTORY_SELECT = "id,branch_id,ingredient_id,canonical_unit_cost,weighted_average_cost,canonical_unit,purchase_date,effective_at,costing_method,receipt_id";
const INVOICE_LINE_SELECT = "id,invoice_id,ingredient_id,original_unit,canonical_unit,unit_price,line_total,pack_size,pack_unit,conversion_factor,canonical_received_quantity,original_quantity";
const INVOICE_SELECT = "id,branch_id,status";
const RECEIPT_LINE_SELECT = "id,ingredient_id,receipt_id,canonical_quantity,canonical_unit,unit_cost_canonical,line_total";
const RECEIPT_SELECT = "id,branch_id,effective_at,status";

function requireClient() {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

async function unwrap(request, context) {
  const { data, error } = await request;
  if (error) throw new Error(`${context}: ${error.message}`);
  return data;
}

async function fetchPaged(buildQuery, { pageSize = 1000, maxRows = 20000, context = "Fetch rows" } = {}) {
  const rows = [];
  let from = 0;
  while (from < maxRows) {
    const to = Math.min(from + pageSize - 1, maxRows - 1);
    const { data, error } = await buildQuery().range(from, to);
    if (error) throw new Error(`${context}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

export const INVENTORY_READINESS_SELECTS = Object.freeze({
  MENU_SELECT,
  VERSION_AUDIT_SELECT,
  COST_HISTORY_SELECT,
  INVOICE_LINE_SELECT,
  RECEIPT_LINE_SELECT,
  RECEIPT_SELECT,
  INVOICE_SELECT,
});

export async function fetchInventoryReadinessAudit({
  branchId = null,
  periodStart,
  periodEnd,
  access = null,
  rbacProfile = null,
} = {}) {
  const clamped = clampInventoryTruthBranch({ requestedBranch: branchId, access, rbacProfile });
  const client = requireClient();
  const [foundation, sales, menuItems, versions, costHistory, invoiceLines, invoices, receiptLines, receipts] = await Promise.all([
    fetchInventoryTruthFoundation({ branchId: clamped, access, rbacProfile }),
    fetchInventoryTruthSales({ branchId: clamped, periodStart, periodEnd, access, rbacProfile }),
    unwrap(
      clamped
        ? client.from("menu_items").select(MENU_SELECT).eq("branch_id", clamped)
        : client.from("menu_items").select(MENU_SELECT),
      "Fetch menu identities",
    ),
    unwrap(client.from("inventory_recipe_versions").select(VERSION_AUDIT_SELECT), "Fetch recipe version audit fields"),
    unwrap(
      clamped
        ? client.from("inventory_ingredient_cost_history").select(COST_HISTORY_SELECT).eq("branch_id", clamped)
        : client.from("inventory_ingredient_cost_history").select(COST_HISTORY_SELECT),
      "Fetch cost history",
    ),
    fetchPaged(
      () => client.from("inventory_invoice_lines").select(INVOICE_LINE_SELECT),
      { context: "Fetch invoice lines", maxRows: 8000 },
    ),
    unwrap(
      clamped
        ? client.from("inventory_invoices").select(INVOICE_SELECT).eq("branch_id", clamped)
        : client.from("inventory_invoices").select(INVOICE_SELECT),
      "Fetch invoices",
    ),
    fetchPaged(
      () => client.from("inventory_purchase_receipt_lines").select(RECEIPT_LINE_SELECT),
      { context: "Fetch receipt lines", maxRows: 8000 },
    ),
    unwrap(
      clamped
        ? client.from("inventory_purchase_receipts").select(RECEIPT_SELECT).eq("branch_id", clamped)
        : client.from("inventory_purchase_receipts").select(RECEIPT_SELECT),
      "Fetch purchase receipts",
    ),
  ]);

  const receiptAt = Object.fromEntries((receipts || []).map((row) => [row.id, row]));
  const invoiceIds = new Set((invoices || []).map((row) => row.id));
  const scopedInvoiceLines = (invoiceLines || []).filter((row) => !clamped || invoiceIds.has(row.invoice_id));
  const datedReceiptLines = (receiptLines || [])
    .map((row) => ({
      ...row,
      effective_at: receiptAt[row.receipt_id]?.effective_at || null,
      branch_id: receiptAt[row.receipt_id]?.branch_id || null,
    }))
    .filter((row) => !clamped || !row.branch_id || row.branch_id === clamped);

  const scopedHistory = filterRowsByRbacProfile(rbacProfile, costHistory || []);
  const audit = runInventoryReadinessAudit({
    recipes: foundation.recipes,
    versions: versions || foundation.versions,
    lines: foundation.lines,
    ingredients: foundation.ingredients,
    menuItems: menuItems || [],
    salesRows: sales.rows || [],
    catalogueItems: foundation.catalogueItems,
    costStateByIngredientId: foundation.costStateByIngredientId,
    costHistory: scopedHistory,
    invoiceLines: scopedInvoiceLines,
    receiptLines: datedReceiptLines,
    branchId: clamped,
  });

  return {
    branchId: clamped,
    periodStart: sales.periodStart || periodStart,
    periodEnd: sales.periodEnd || periodEnd,
    salesSource: sales.used,
    salesCoverage: sales.coverage,
    actualCoverageStatus: "UNAVAILABLE",
    varianceStatus: "VARIANCE_NOT_COMPUTABLE",
    ...audit,
  };
}
