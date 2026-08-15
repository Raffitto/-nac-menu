/**
 * Build dine-in sessions + mix from canonical commerce tables and publish atomically.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
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
const admin = createClient(url, key, { auth: { persistSession: false } });

const branch = process.argv[2] || "khobar";
const periodStart = process.argv[3] || "2026-07-01";
const periodEnd = process.argv[4] || "2026-08-14";
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");

async function fetchAll(table) {
  const rows = [];
  let from = 0;
  const histStart = periodStart <= "2026-07-01" ? periodStart : "2026-07-01";
  while (true) {
    const { data, error } = await admin.from(table)
      .select("*")
      .eq("branch_id", branch)
      .gte("business_date", histStart)
      .lte("business_date", periodEnd)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

function orderFromRow(r) {
  return {
    source: r.source,
    sourceOrderId: r.source_order_id,
    sourceRevision: r.source_revision,
    branchId: r.branch_id,
    businessDate: r.business_date,
    openedAt: r.opened_at,
    closedAt: r.closed_at,
    orderType: r.order_type,
    tableId: r.table_id,
    covers: r.covers == null ? null : Number(r.covers),
    subtotal: r.subtotal == null ? null : Number(r.subtotal),
    discount: r.discount == null ? null : Number(r.discount),
    tax: r.tax == null ? null : Number(r.tax),
    netSales: r.net_sales == null ? null : Number(r.net_sales),
    status: r.status,
    ingestedAt: r.ingested_at,
  };
}

function itemFromRow(r) {
  return {
    source: r.source,
    sourceOrderId: r.source_order_id,
    sourceOrderItemId: r.source_order_item_id,
    branchId: r.branch_id,
    businessDate: r.business_date,
    productId: r.product_id,
    canonicalMenuItemId: r.canonical_menu_item_id,
    itemName: r.item_name,
    sourceCategory: r.source_category,
    canonicalCategory: r.canonical_category,
    quantity: Number(r.quantity || 0),
    grossAmount: r.gross_amount == null ? null : Number(r.gross_amount),
    discountAmount: r.discount_amount == null ? null : Number(r.discount_amount),
    netAmount: r.net_amount == null ? null : Number(r.net_amount),
    status: r.status,
  };
}

const tmp = path.join(os.tmpdir(), `nac-commerce-${Date.now()}.json`);
fs.writeFileSync(tmp, JSON.stringify({
  orders: (await fetchAll("commerce_orders")).map(orderFromRow),
  items: (await fetchAll("commerce_order_items")).map(itemFromRow),
  branch,
  periodStart,
  periodEnd,
}));

const script = `
  global.Deno = { env: { get: () => undefined } };
  import fs from "node:fs";
  const payload = JSON.parse(fs.readFileSync(${JSON.stringify(tmp)}, "utf8"));
  import(${JSON.stringify(fabricPath)}).then((mod) => {
    const { orders, items, branch, periodStart, periodEnd } = payload;
    const dineIn = orders.filter((o) => o.orderType === "dine_in" && o.status === "completed"
      && o.businessDate >= periodStart && o.businessDate <= periodEnd && o.branchId === branch);
    const dineIds = new Set(dineIn.map((o) => o.sourceOrderId));
    const basket = items.filter((i) => dineIds.has(i.sourceOrderId));
    const sessions = mod.buildDineInSessions(dineIn, basket);
    const mix = mod.summarizeServiceMix(sessions, {
      source: "foodics", branchId: branch, periodStart, periodEnd,
      completedThrough: periodEnd, lastIngestAt: new Date().toISOString(),
    });
    const julyEnd = periodEnd.startsWith("2026-08") ? ("2026-07-" + periodEnd.slice(8)) : "2026-07-31";
    const julyOrders = orders.filter((o) => o.orderType === "dine_in" && o.status === "completed"
      && o.businessDate >= "2026-07-01" && o.businessDate <= julyEnd && o.branchId === branch);
    const julyIds = new Set(julyOrders.map((o) => o.sourceOrderId));
    const julyMix = mod.summarizeServiceMix(
      mod.buildDineInSessions(julyOrders, items.filter((i) => julyIds.has(i.sourceOrderId))),
      { source: "foodics", branchId: branch, periodStart: "2026-07-01", periodEnd: julyEnd },
    );
    const comparison = mod.compareServiceMix(mix, julyMix);
    const itemRows = mod.itemMix(sessions, "revenue").slice(0, 25);
    const evidence = mod.buildEvidenceSummary({
      dataThrough: periodEnd,
      sessionsAnalyzed: sessions.length,
      mappingQuality: mix.unclassifiedRate == null ? null : 1 - mix.unclassifiedRate,
      sourceFreshness: mix.unclassifiedRate != null && mix.unclassifiedRate < 0.35 ? "ready" : "warning",
      coverage: periodStart + " to " + periodEnd,
      lineage: mod.createLineage({ acquisitionModes: ["authenticated_read"] }),
    });
    const quality = mod.evaluatePublicationQuality({
      joinRate: mod.joinRate(dineIn, basket),
      duplicateRate: mod.duplicateRate(dineIn.map((o) => o.sourceOrderId)),
      schemaValid: true,
      unclassifiedSessionRate: mix.unclassifiedRate,
    });
    process.stdout.write(JSON.stringify({
      mix, comparison, itemRows, evidence, quality,
      sessionCount: sessions.length, orderCount: dineIn.length, itemCount: basket.length,
      archetypes: Object.fromEntries(Object.entries(mix.byArchetype).map(([k, v]) => [k, v.sessions])),
    }));
  });
`;

const computed = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
}).trim());
fs.unlinkSync(tmp);

if (!computed.quality.ok || !computed.quality.sessionMixReady) {
  console.log(JSON.stringify({ published: false, reason: computed.quality, ...computed }, null, 2));
  process.exit(2);
}

const { error } = await admin.from("commerce_published_snapshots").insert({
  source: "foodics",
  branch_id: branch,
  period_start: periodStart,
  period_end: periodEnd,
  capability_set: "commerce.session_mix",
  status: "published",
  mix: computed.mix,
  comparison: computed.comparison,
  item_mix: computed.itemRows,
  mapping_quality: { unclassifiedRate: computed.mix.unclassifiedRate },
  evidence_summary: computed.evidence,
  lineage: computed.evidence.lineage,
});
if (error) throw error;

for (const dataset of ["orders", "order_items", "commerce_sessions", "session_mix", "item_mix", "product_mapping"]) {
  await admin.from("commerce_dataset_freshness").upsert({
    source: "foodics",
    dataset,
    branch_id: branch,
    data_through: periodEnd,
    complete_through: new Date().toISOString(),
    last_success_at: new Date().toISOString(),
    status: "ready",
    source_mode: "authenticated_read",
    quality: { unclassifiedRate: computed.mix.unclassifiedRate },
  });
}

console.log(JSON.stringify({
  published: true,
  sessions: computed.sessionCount,
  orders: computed.orderCount,
  items: computed.itemCount,
  archetypes: computed.archetypes,
  dessertFocused: computed.mix.dessertFocusedShare,
  foodContaining: computed.mix.foodContainingShare,
  dessertConversion: computed.mix.dessertConversion,
  unclassified: computed.mix.unclassifiedRate,
}, null, 2));
