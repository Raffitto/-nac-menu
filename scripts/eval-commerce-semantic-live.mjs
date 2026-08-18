/**
 * Live Khobar acceptance for the general commerce semantic engine.
 * Uses canonical commerce tables. Paid model calls: 0.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv("/Users/raffiazarian/Desktop/nac-menu-release/foodics-bridge/.env.local");
loadEnv(path.join(root, ".env.production.local"));
loadEnv(path.join(root, ".env.local"));

const url = process.env.FOODICS_BRIDGE_SUPABASE_URL || process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const key = process.env.FOODICS_BRIDGE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing Supabase service role env — skip live eval");
  process.exit(2);
}
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");
const dataPath = "/tmp/commerce-semantic-live-data.json";

async function page(table, select, qs) {
  const rows = [];
  for (let from = 0; from < 40000; from += 1000) {
    const res = await fetch(`${url}/rest/v1/${table}?${qs}&select=${select}`, {
      headers: { ...headers, Range: `${from}-${from + 999}` },
    });
    if (!res.ok) throw new Error(`${table} ${res.status} ${await res.text()}`);
    const chunk = await res.json();
    rows.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return rows;
}

const qs = "branch_id=eq.khobar&business_date=gte.2026-07-01&business_date=lte.2026-08-15";
const orders = await page("commerce_orders", "source_order_id,branch_id,business_date,opened_at,closed_at,order_type,covers,subtotal,tax,net_sales,status,table_id", qs);
const items = await page("commerce_order_items", "source_order_id,source_order_item_id,branch_id,business_date,product_id,canonical_menu_item_id,item_name,canonical_category,quantity,net_amount,status", qs);
for (const row of orders) row.business_date = String(row.business_date).slice(0, 10);
for (const row of items) row.business_date = String(row.business_date).slice(0, 10);
fs.writeFileSync(dataPath, JSON.stringify({ orders, items }));

const runner = `
  global.Deno = { env: { get: () => undefined } };
  import fs from "node:fs";
  const data = JSON.parse(fs.readFileSync(${JSON.stringify(dataPath)}, "utf8"));
  import(${JSON.stringify(fabricPath)}).then(async (mod) => {
    const store = mod.createMemoryCommerceStore({
      orders: data.orders, items: data.items,
      coverage: { branchId: "khobar", startDate: "2026-07-01", endDate: "2026-08-15" },
    });
    const scope = mod.createIntelligenceScope({
      primaryBranchId: "khobar", branchIds: ["khobar"], allowedBranchIds: ["khobar"], canSeeNetwork: false,
    });
    const period = { startDate: "2026-08-01", endDate: "2026-08-15", label: "August 2026 through 15" };
    async function ask(question, previousPlan, periodOverride) {
      const planned = mod.planSemanticCommerce({ question, branchId: "khobar", period: periodOverride || period, previousPlan });
      if (!planned.ok && planned.plan?.outputIntent === "limitation") {
        return { question, ok: true, limitation: planned.reason, plan: planned.plan, text: planned.reason };
      }
      if (!planned.ok) return { question, ok: false, error: planned.reason };
      const exec = await mod.executeCommercePlan({ plan: planned.plan, store, scope });
      const validation = mod.validateSemanticResult(planned.plan, exec);
      const text = mod.synthesizeSemanticCommerce({ question, plan: planned.plan, result: exec, validation });
      return {
        question, ok: exec.ok && (validation.ok || !exec.ok),
        plan: planned.plan, calculation: planned.plan.calculation, metric: planned.plan.metric,
        value: exec.value, cohortSize: exec.cohortSize, ranking: (exec.ranking || []).slice(0, 5),
        comparison: exec.comparison || null, limitation: exec.limitation || null, text,
      };
    }
    const cookies = await ask("What products are most commonly ordered with Cookies?");
    const rig = await ask("What is the average check when Rigatoni is ordered?");
    const high = await ask("Which products are most associated with checks above 300 SAR?");
    const one = await ask("What percentage of checks had only one product?");
    const biggest = await ask("What are the 10 biggest checks in August?");
    const guests = await ask("Which products are ordered most often on checks with 4+ guests?");
    const dessert = await ask("How many completed dine-in checks had dessert but no food?");
    const attach = await ask("What is the dessert attach rate on food-containing sessions?");
    const weekend = await ask("Compare weekend basket size to weekdays.");
    const after = await ask("Only after 9pm.", cookies.plan);
    const july = await ask("Same for July.", cookies.plan, { startDate: "2026-07-01", endDate: "2026-07-31", label: "July 2026" });
    const table = await ask("Which physical table number ordered the most Rigatoni?");
    process.stdout.write(JSON.stringify({
      orders: data.orders.length, items: data.items.length,
      results: { cookies, rig, high, one, biggest, guests, dessert, attach, weekend, after, july, table },
    }));
  });
`;

const out = execFileSync(process.execPath, ["--input-type=module", "-e", runner], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const parsed = JSON.parse(out.trim());
fs.mkdirSync(path.join(root, "tmp-vault-verify"), { recursive: true });
fs.writeFileSync(path.join(root, "tmp-vault-verify/commerce-semantic-live.json"), `${JSON.stringify(parsed, null, 2)}\n`);
const slim = Object.fromEntries(Object.entries(parsed.results).map(([k, v]) => [k, {
  ok: v.ok,
  limitation: v.limitation || null,
  value: v.value ?? null,
  cohortSize: v.cohortSize ?? null,
  text: v.text,
  top: (v.ranking || []).slice(0, 3).map((r) => r.name || r.net_sales),
  comparison: v.comparison || null,
}]));
console.log(JSON.stringify({ orders: parsed.orders, items: parsed.items, answers: slim }, null, 2));
