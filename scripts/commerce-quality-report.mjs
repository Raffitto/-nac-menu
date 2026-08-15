import fs from "node:fs";
import os from "node:os";
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
const SUPABASE_URL = process.env.FOODICS_BRIDGE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.FOODICS_BRIDGE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

async function fetchAll(table, start, end) {
  const rows = [];
  let from = 0;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?branch_id=eq.khobar&business_date=gte.${start}&business_date=lte.${end}&select=*&offset=${from}&limit=1000`;
    const res = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    if (!res.ok) throw new Error(`${table} ${res.status} ${await res.text()}`);
    const data = await res.json();
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

const start = "2026-07-01";
const end = "2026-08-14";
const orders = await fetchAll("commerce_orders", start, end);
const items = await fetchAll("commerce_order_items", start, end);
const tmp = path.join(os.tmpdir(), `nac-q-${Date.now()}.json`);
fs.writeFileSync(tmp, JSON.stringify({ orders, items }));
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");
const script = `
  global.Deno = { env: { get: () => undefined } };
  import fs from "node:fs";
  const { orders: rawO, items: rawI } = JSON.parse(fs.readFileSync(${JSON.stringify(tmp)}, "utf8"));
  function orderFromRow(r) {
    return { source: r.source, sourceOrderId: r.source_order_id, sourceRevision: r.source_revision, branchId: r.branch_id, businessDate: r.business_date, openedAt: r.opened_at, closedAt: r.closed_at, orderType: r.order_type, tableId: r.table_id, covers: r.covers == null ? null : Number(r.covers), subtotal: r.subtotal == null ? null : Number(r.subtotal), discount: r.discount == null ? null : Number(r.discount), tax: r.tax == null ? null : Number(r.tax), netSales: r.net_sales == null ? null : Number(r.net_sales), status: r.status, ingestedAt: r.ingested_at };
  }
  function itemFromRow(r) {
    return { source: r.source, sourceOrderId: r.source_order_id, sourceOrderItemId: r.source_order_item_id, branchId: r.branch_id, businessDate: r.business_date, productId: r.product_id, canonicalMenuItemId: r.canonical_menu_item_id, itemName: r.item_name, sourceCategory: r.source_category, canonicalCategory: r.canonical_category, quantity: Number(r.quantity || 0), grossAmount: r.gross_amount == null ? null : Number(r.gross_amount), discountAmount: r.discount_amount == null ? null : Number(r.discount_amount), netAmount: r.net_amount == null ? null : Number(r.net_amount), status: r.status };
  }
  import(${JSON.stringify(fabricPath)}).then((mod) => {
    const orders = rawO.map(orderFromRow);
    const items = rawI.map(itemFromRow);
    const products = new Map();
    let mappedRev = 0, rev = 0, mappedRows = 0;
    for (const i of items) {
      const amt = Number(i.netAmount || 0);
      rev += amt;
      if (i.canonicalCategory !== "unclassified") { mappedRows += 1; mappedRev += amt; }
      if (i.productId) {
        const p = products.get(i.productId) || { name: i.itemName, family: i.canonicalCategory, rows: 0, rev: 0 };
        p.rows += 1; p.rev += amt; products.set(i.productId, p);
      }
    }
    const uniq = [...products.values()];
    const mappedProducts = uniq.filter((p) => p.family !== "unclassified").length;
    function period(ps, pe) {
      const o = orders.filter((x) => x.businessDate >= ps && x.businessDate <= pe && x.branchId === "khobar");
      const dine = o.filter((x) => x.orderType === "dine_in" && x.status === "completed");
      const ids = new Set(dine.map((x) => x.sourceOrderId));
      const basket = items.filter((i) => ids.has(i.sourceOrderId));
      const sessions = mod.buildDineInSessions(dine, basket);
      const mix = mod.summarizeServiceMix(sessions, { source: "foodics", branchId: "khobar", periodStart: ps, periodEnd: pe, completedThrough: pe });
      const itemRows = mod.itemMix(sessions, "revenue").slice(0, 8);
      return {
        orders: o.length, completed: o.filter((x) => x.status === "completed").length, dineIn: dine.length,
        items: basket.length, sessions: sessions.length, mix, itemRows,
        join: mod.joinRate(dine, basket),
        dupOrders: mod.duplicateRate(dine.map((x) => x.sourceOrderId)),
        dupItems: mod.duplicateRate(basket.map((x) => x.sourceOrderItemId)),
      };
    }
    const july = period("2026-07-01", "2026-07-31");
    const aug = period("2026-08-01", "2026-08-14");
    const julyCmp = period("2026-07-01", "2026-07-14");
    const comparison = mod.compareServiceMix(aug.mix, julyCmp.mix);
    const quality = mod.evaluatePublicationQuality({
      joinRate: aug.join, duplicateRate: aug.dupOrders, schemaValid: true,
      unclassifiedSessionRate: aug.mix.unclassifiedRate,
    });
    process.stdout.write(JSON.stringify({
      products: uniq.length, mappedProducts, mappedProductPct: uniq.length ? mappedProducts / uniq.length : 0,
      mappedRowPct: items.length ? mappedRows / items.length : 0,
      mappedRevPct: rev ? mappedRev / rev : 0,
      topUnclassified: uniq.filter((p) => p.family === "unclassified").sort((a,b)=>b.rev-a.rev).slice(0,15),
      july, aug, julyCmp, comparison, quality,
    }));
  });
`;
const out = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim());
fs.unlinkSync(tmp);
fs.writeFileSync(path.join(root, "tmp-commerce-quality.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  products: out.products,
  mappedProductPct: out.mappedProductPct,
  mappedRowPct: out.mappedRowPct,
  mappedRevPct: out.mappedRevPct,
  topUnclassified: out.topUnclassified,
  quality: out.quality,
  julySessions: out.july.sessions,
  julyUnclass: out.july.mix.unclassifiedRate,
  augSessions: out.aug.sessions,
  augUnclass: out.aug.mix.unclassifiedRate,
  dessertFocusedAug: out.aug.mix.dessertFocusedShare,
  foodContainingAug: out.aug.mix.foodContainingShare,
  dessertFocusedJulyCmp: out.julyCmp.mix.dessertFocusedShare,
  foodContainingJulyCmp: out.julyCmp.mix.foodContainingShare,
  pp: { dessert: out.comparison.dessertFocusedPp, food: out.comparison.foodContainingPp },
}, null, 2));
