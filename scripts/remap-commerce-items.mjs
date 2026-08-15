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
    let value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv("/Users/raffiazarian/Desktop/nac-menu-release/foodics-bridge/.env.local");
const BASE = process.env.FOODICS_BRIDGE_SUPABASE_URL;
const KEY = process.env.FOODICS_BRIDGE_SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" };

async function rest(path) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`${path} ${res.status} ${await res.text()}`);
  return res.json();
}

const items = [];
for (let from = 0; ; from += 1000) {
  const rows = await rest(`commerce_order_items?select=source,source_order_item_id,product_id,item_name,net_amount&offset=${from}&limit=1000`);
  items.push(...rows);
  if (rows.length < 1000) break;
}
const menuRes = await fetch(`${BASE}/rest/v1/menu_items?select=id,name_en,section_id,branch_id&branch_id=eq.khobar&limit=2000`, { headers });
const menuItems = await menuRes.json();
const sections = await rest("sections?select=id,name_en,category_id&limit=2000");
const cats = await rest("categories?select=id,slug,name_en&limit=200");
const catById = Object.fromEntries(cats.map((c) => [c.id, c]));
const secById = Object.fromEntries(sections.map((s) => [s.id, s]));
const menu = menuItems.map((m) => {
  const sec = secById[m.section_id] || {};
  const cat = catById[sec.category_id] || {};
  return { id: m.id, name: m.name_en, categoryId: sec.category_id, categorySlug: cat.slug, sectionName: sec.name_en };
});

const tmpIn = "/tmp/nac-remap-in.json";
const tmpOut = "/tmp/nac-remap-out.json";
fs.writeFileSync(tmpIn, JSON.stringify({ items, menu }));
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");
const script = `
  global.Deno = { env: { get: () => undefined } };
  import fs from "node:fs";
  const { items, menu } = JSON.parse(fs.readFileSync(${JSON.stringify(tmpIn)}, "utf8"));
  import(${JSON.stringify(fabricPath)}).then((mod) => {
    const updates = items.map((i) => {
      const mapped = mod.mapFromMenuCatalog(i.product_id, i.item_name, menu);
      return {
        source: i.source,
        source_order_item_id: i.source_order_item_id,
        product_id: i.product_id,
        item_name: i.item_name,
        canonical_menu_item_id: mapped.canonicalMenuItemId || null,
        canonical_category: mod.mapCanonicalFamily(mapped),
        net_amount: i.net_amount,
      };
    });
    fs.writeFileSync(${JSON.stringify(tmpOut)}, JSON.stringify(updates));
  });
`;
execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: root, stdio: "inherit" });
const updates = JSON.parse(fs.readFileSync(tmpOut, "utf8"));
const byKey = new Map();
for (const u of updates) {
  byKey.set(`${u.canonical_category}|${u.canonical_menu_item_id || ""}|${u.item_name}`, u);
}
// patch in batches of same category to reduce calls
for (let i = 0; i < updates.length; i += 80) {
  const batch = updates.slice(i, i + 80);
  await Promise.all(batch.map((u) => fetch(`${BASE}/rest/v1/commerce_order_items?source=eq.${u.source}&source_order_item_id=eq.${u.source_order_item_id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      canonical_menu_item_id: u.canonical_menu_item_id,
      canonical_category: u.canonical_category,
    }),
  }).then(async (r) => { if (!r.ok) throw new Error(await r.text()); })));
}
const mapped = updates.filter((u) => u.canonical_category !== "unclassified");
const rev = updates.reduce((n, u) => n + Number(u.net_amount || 0), 0);
const mappedRev = mapped.reduce((n, u) => n + Number(u.net_amount || 0), 0);
console.log(JSON.stringify({
  rows: updates.length,
  mappedRows: mapped.length,
  mappedRowPct: updates.length ? mapped.length / updates.length : 0,
  mappedRevPct: rev ? mappedRev / rev : 0,
  families: mapped.reduce((acc, u) => { acc[u.canonical_category] = (acc[u.canonical_category] || 0) + 1; return acc; }, {}),
}, null, 2));
