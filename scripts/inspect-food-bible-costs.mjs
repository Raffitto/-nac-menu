#!/usr/bin/env node
/**
 * Read-only inspection of procurement cost identities vs Food Bible ingredients.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const STAFF_EMAIL = process.env.SUPABASE_STAFF_EMAIL || "raffiazarian2@gmail.com";

function loadEnvLocal() {
  const envPath = path.join(root, ".env.local");
  const env = {};
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
  }
  return env;
}

function getServiceRole(projectRef) {
  const out = execSync(`supabase projects api-keys --project-ref ${projectRef} -o json`, {
    encoding: "utf8",
    cwd: root,
  });
  const keys = JSON.parse(out);
  const service = keys.find((key) => key.name === "service_role" || key.id === "service_role");
  if (!service?.api_key) throw new Error("service_role key not found");
  return service.api_key;
}

async function signInStaff(url, anonKey, serviceRole) {
  const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: STAFF_EMAIL });
  if (error) throw error;
  const tokenHash = data?.properties?.hashed_token;
  const { error: otpError } = await userClient.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (otpError) throw otpError;
  return userClient;
}

async function fetchAll(client, table, select) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select(select).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return rows;
}

async function main() {
  const env = loadEnvLocal();
  const url = env.REACT_APP_SUPABASE_URL;
  const anon = env.REACT_APP_SUPABASE_ANON_KEY;
  const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  const client = await signInStaff(url, anon, getServiceRole(projectRef));

  async function tryFetch(table, select) {
    try {
      return await fetchAll(client, table, select);
    } catch (err) {
      console.error(String(err.message));
      return [];
    }
  }

  const tables = {
    ingredients: await fetchAll(client, "inventory_ingredients", "id,canonical_name,normalized_search_name,description,base_inventory_unit,scope,branch_id,active"),
    history: await fetchAll(client, "inventory_ingredient_cost_history", "*"),
    receipts: await fetchAll(client, "inventory_purchase_receipt_lines", "id,ingredient_id,original_description,normalized_description,canonical_quantity,canonical_unit,unit_cost_canonical,unit_price,pack_quantity,pack_size,pack_unit,original_unit,original_quantity,supplier_sku,created_at"),
    invoices: await tryFetch("inventory_invoice_lines", "id,ingredient_id,original_description,normalized_description,unit_price,canonical_unit,canonical_received_quantity,original_quantity,original_unit,pack_quantity,pack_size,pack_unit,review_status,supplier_sku"),
    catalogue: await tryFetch("inventory_supplier_catalogue_items", "id,supplier_id,supplier_sku,original_product_name,normalized_product_name,ingredient_id,purchase_unit,pack_quantity,pack_size,pack_unit,conversion_factor,last_purchase_price,last_purchase_at,verification_state"),
    aliases: await tryFetch("inventory_supplier_item_aliases", "id,supplier_id,catalogue_item_id,supplier_sku,original_description,normalized_description,verification_state"),
    poLines: await tryFetch("inventory_purchase_order_lines", "id,ingredient_id,canonical_unit,ordered_quantity,unit_price"),
    related: await tryFetch("inventory_related_items", "id,branch_id,ingredient_id,related_ingredient_id,relationship_type,active,notes"),
    baselines: await tryFetch("inventory_approved_cost_baselines", "id,ingredient_id,canonical_unit,canonical_unit_cost,effective_date,branch_id"),
    state: await tryFetch("inventory_ingredient_cost_state", "branch_id,ingredient_id,weighted_average_cost,last_purchase_price,last_purchase_at"),
    suppliers: await tryFetch("inventory_suppliers", "id,supplier_name"),
  };

  const byId = Object.fromEntries(tables.ingredients.map((row) => [row.id, row.canonical_name]));
  const summarize = (rows, nameField, costField, unitField, idField = "ingredient_id") =>
    (rows || []).map((row) => ({
      id: row[idField],
      name: byId[row[idField]] || row[nameField] || null,
      desc: row.original_description || row.original_product_name || row.normalized_description || null,
      cost: row[costField],
      unit: row[unitField],
      pack: row.pack_size != null ? `${row.pack_quantity}x${row.pack_size} ${row.pack_unit || ""}` : null,
      sku: row.supplier_sku || null,
    }));

  const out = {
    counts: Object.fromEntries(Object.entries(tables).map(([key, rows]) => [key, rows.length])),
    ingredients: tables.ingredients.map((row) => ({
      name: row.canonical_name,
      unit: row.base_inventory_unit,
      scope: row.scope,
      desc: row.description,
      fb: String(row.description || "").includes("Food Bible"),
    })),
    history: summarize(tables.history, null, "canonical_unit_cost", "canonical_unit").concat(
      tables.history.map((row) => ({ wac: row.weighted_average_cost, qty: row.canonical_quantity, purchaseUnitCost: row.purchase_unit_cost, at: row.effective_at, name: byId[row.ingredient_id] })),
    ),
    receipts: summarize(tables.receipts, "normalized_description", "unit_cost_canonical", "canonical_unit"),
    invoices: summarize(tables.invoices, "normalized_description", "unit_price", "canonical_unit"),
    catalogue: summarize(tables.catalogue, "original_product_name", "last_purchase_price", "purchase_unit"),
    aliases: tables.aliases.map((row) => ({ desc: row.original_description, sku: row.supplier_sku, state: row.verification_state })),
    related: tables.related,
    baselines: tables.baselines,
    statePositive: tables.state.filter((row) => Number(row.weighted_average_cost) > 0 || Number(row.last_purchase_price) > 0)
      .map((row) => ({ name: byId[row.ingredient_id], wac: row.weighted_average_cost, last: row.last_purchase_price, at: row.last_purchase_at })),
    suppliers: tables.suppliers,
    poLines: tables.poLines?.length || 0,
  };
  fs.mkdirSync(path.join(root, "tmp", "food-bible-2026-08-20"), { recursive: true });
  fs.writeFileSync(path.join(root, "tmp", "food-bible-2026-08-20", "cost-inspect.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ counts: out.counts, statePositive: out.statePositive.length, historyNames: [...new Set(tables.history.map((row) => byId[row.ingredient_id]))], receiptNames: [...new Set(tables.receipts.map((row) => byId[row.ingredient_id] || row.normalized_description))], catalogueNames: tables.catalogue.map((row) => `${row.original_product_name} -> ${byId[row.ingredient_id]}`), aliases: tables.aliases.map((row) => row.original_description), fbCount: out.ingredients.filter((row) => row.fb).length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
