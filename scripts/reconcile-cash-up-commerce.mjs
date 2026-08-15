/**
 * Pair canonical Cash Up net_sales with Foodics completed-order totals.
 * Cash Up remains headline authority. Foodics remains order/session authority.
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
loadEnv(path.join(root, ".env.local"));

const url = process.env.FOODICS_BRIDGE_SUPABASE_URL || process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const key = process.env.FOODICS_BRIDGE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing Supabase service role env");
  process.exit(1);
}
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };

const branch = process.argv[2] || "khobar";
const periodStart = process.argv[3] || "2026-07-01";
const periodEnd = process.argv[4] || "2026-08-14";
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");

async function fetchAll(pathAndQuery) {
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + 999;
    const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
      headers: { ...headers, Range: `${from}-${to}` },
    });
    if (!res.ok) throw new Error(`${pathAndQuery} ${res.status} ${await res.text()}`);
    const data = await res.json();
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

const cashRows = await fetchAll(
  `ask_nac_structured_facts?report_type=eq.cash_up&metric_key=eq.net_sales&branch_id=eq.${branch}&archived_at=is.null&period_start=gte.${periodStart}&period_start=lte.${periodEnd}&select=period_start,metric_value`,
);
const orderRows = await fetchAll(
  `commerce_orders?branch_id=eq.${branch}&status=eq.completed&business_date=gte.${periodStart}&business_date=lte.${periodEnd}&select=business_date,subtotal,net_sales,order_type`,
);

const foodicsByDate = new Map();
for (const row of orderRows) {
  const date = String(row.business_date).slice(0, 10);
  const cur = foodicsByDate.get(date) || { exVat: 0, incVat: 0, orders: 0 };
  cur.exVat += Number(row.subtotal || 0);
  cur.incVat += Number(row.net_sales || 0);
  cur.orders += 1;
  foodicsByDate.set(date, cur);
}

const script = `
  global.Deno = { env: { get: () => undefined } };
  import(${JSON.stringify(fabricPath)}).then((mod) => {
    const cash = mod.pickDailyCashUpNetSales(${JSON.stringify(cashRows)});
    const foodics = ${JSON.stringify(Object.fromEntries(foodicsByDate))};
    const dates = [...new Set([...cash.keys(), ...Object.keys(foodics)])].sort();
    const rows = dates.map((businessDate) => {
      const f = foodics[businessDate] || null;
      return mod.reconcileHeadlineSales({
        branchId: ${JSON.stringify(branch)},
        businessDate,
        cashUpSales: cash.get(businessDate) ?? null,
        foodicsSales: f ? Number(f.exVat.toFixed(2)) : null,
        foodicsIncVat: f ? Number(f.incVat.toFixed(2)) : null,
      });
    });
    process.stdout.write(JSON.stringify({ cashDays: cash.size, foodicsDays: Object.keys(foodics).length, rows }));
  });
`;

const computed = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
}).trim());

const persist = computed.rows
  .filter((r) => r.coverage === "both")
  .map((r) => ({
    branch_id: r.branchId,
    business_date: r.businessDate,
    cash_up_sales: r.cashUpSales,
    foodics_sales: r.foodicsSales,
    absolute_difference: r.absoluteDifference,
    percentage_difference: r.percentageDifference,
  }));

for (let i = 0; i < persist.length; i += 200) {
  const res = await fetch(`${url}/rest/v1/commerce_reconciliation`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(persist.slice(i, i + 200)),
  });
  if (!res.ok) throw new Error(`reconciliation ${res.status} ${await res.text()}`);
}

const both = computed.rows.filter((r) => r.coverage === "both");
const warnings = both.filter((r) => r.health === "warning");
console.log(JSON.stringify({
  persisted: persist.length,
  overlapping: both.length,
  warnings: warnings.length,
  sample: both.slice(-8).map((r) => ({
    date: r.businessDate,
    cashUp: r.cashUpSales,
    foodicsExVat: r.foodicsSales,
    foodicsIncVat: r.foodicsIncVat,
    delta: r.absoluteDifference,
    deltaPct: r.percentageDifference,
    health: r.health,
  })),
  note: both[0]?.note || null,
}, null, 2));
