#!/usr/bin/env node
/**
 * Post-deploy BI pipeline probe (requires staff credentials in env).
 *
 *   SUPABASE_URL=... SUPABASE_STAFF_EMAIL=... SUPABASE_STAFF_PASSWORD=... \
 *     node scripts/verify-production-pipeline.mjs
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const email = process.env.SUPABASE_STAFF_EMAIL;
const password = process.env.SUPABASE_STAFF_PASSWORD;
const branch = process.env.REACT_APP_NAC_BRANCH_ID || "khobar";

if (!url || !email || !password) {
  console.error(
    "Set SUPABASE_URL (or REACT_APP_SUPABASE_URL), SUPABASE_STAFF_EMAIL, SUPABASE_STAFF_PASSWORD",
  );
  process.exit(1);
}

const anon =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
if (!anon) {
  console.error("Set SUPABASE_ANON_KEY or REACT_APP_SUPABASE_ANON_KEY");
  process.exit(1);
}

const supabase = createClient(url, anon);

const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
  email,
  password,
});
if (authErr) {
  console.error("Auth failed:", authErr.message);
  process.exit(1);
}

async function probe(label, rpc, params) {
  const t0 = Date.now();
  const { data, error } = await supabase.rpc(rpc, params);
  const ms = Date.now() - t0;
  if (error) {
    console.log(`\n[${label}] ERROR ${error.message} (${ms}ms)`);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  const events = Number(row?.total_events) || 0;
  const sessions = Number(row?.total_sessions) || 0;
  const funnel = row?.funnel || {};
  const byHour = row?.by_hour || [];
  const hourBuckets = Array.isArray(byHour) ? byHour.length : 0;
  const cats = row?.top_categories || [];
  console.log(`\n[${label}] ${ms}ms`);
  console.log("  events:", events, "sessions:", sessions);
  console.log("  funnel.category_opens:", funnel.category_opens);
  console.log("  by_event_type.category_open:", row?.by_event_type?.category_open);
  console.log("  by_event_type.menu_tab_open:", row?.by_event_type?.menu_tab_open);
  console.log("  top_categories:", cats.length, cats.slice(0, 3));
  console.log("  by_hour buckets:", hourBuckets);
  return row;
}

console.log("Signed in as", auth.user?.email);
await probe("Today RPC", "get_bi_dashboard", { p_branch: branch, p_hours: 24 });
await probe("7D rollup", "get_bi_dashboard_from_rollup", {
  p_branch: branch,
  p_hours: 168,
});

const { count } = await supabase
  .from("menu_events")
  .select("id", { count: "exact", head: true })
  .gte("created_at", new Date(Date.now() - 24 * 3600000).toISOString());
console.log("\n[menu_events last 24h] count:", count);

console.log("\nDone. Compare RPC totals vs Intelligence Hub Today view.");
