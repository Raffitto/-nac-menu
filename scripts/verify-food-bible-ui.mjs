#!/usr/bin/env node
/**
 * Authenticated check that Food Bible overview still serves canonical recipe states.
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
  const env = {};
  const envPath = path.join(root, ".env.local");
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
  const { error: otpError } = await userClient.auth.verifyOtp({
    token_hash: data?.properties?.hashed_token,
    type: "magiclink",
  });
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

function pick(rows, pattern) {
  return rows.find((row) => pattern.test(row.name || row.name_en || ""));
}

async function main() {
  const env = loadEnvLocal();
  const url = env.REACT_APP_SUPABASE_URL;
  const anon = env.REACT_APP_SUPABASE_ANON_KEY;
  const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  const client = await signInStaff(url, anon, getServiceRole(projectRef));
  const recipes = await fetchAll(client, "inventory_recipes", "id,name,active,internal_name,menu_item_id");
  const menuItems = await fetchAll(client, "menu_items", "id,name_en,active,branch_id");
  const live = (namePattern) => menuItems.filter((row) => row.branch_id === "khobar" && row.active && namePattern.test(row.name_en || ""));
  const report = {
    authenticatedAs: STAFF_EMAIL,
    bigNac: { live: live(/big nac/i).map((row) => row.name_en), recipe: pick(recipes, /big nac/i) },
    seaBass: { live: live(/seabass|sea bass/i).map((row) => row.name_en), recipe: pick(recipes, /sea bass creole/i) },
    rendang: { live: live(/prawn rendang/i).map((row) => row.name_en), recipe: pick(recipes, /prawn rendang/i) },
    watermelon: { live: live(/watermelon/i).map((row) => row.name_en), recipe: pick(recipes, /watermelon/i) },
    appleBircher: pick(recipes, /apple bircher/i),
    conchiglie: {
      live: live(/conchiglie/i).map((row) => row.name_en),
      recipe: recipes.find((row) => /conchiglie/i.test(row.name || "")),
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
