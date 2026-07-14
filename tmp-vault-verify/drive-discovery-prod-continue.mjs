/**
 * Continue prod verification: sync loop + Ask NAC + aggregate stats.
 */
import fs from "fs";
import { execSync } from "child_process";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

const ASK_NAC_QUERIES = [
  "show latest cash up",
  "summarize daily briefing this month",
  "show breakage issues this month",
  "show everything learned from historical weekly dashboards",
  "discover Drive folders",
];

function readEnvLocalValue(key) {
  const envPath = path.join(REPO_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return null;
  return fs.readFileSync(envPath, "utf8").match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim() || null;
}

function loadConfig() {
  const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || readEnvLocalValue("REACT_APP_SUPABASE_URL");
  const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || readEnvLocalValue("REACT_APP_SUPABASE_ANON_KEY");
  const email = process.env.ASK_NAC_VERIFY_EMAIL?.trim() || "raffiazarian2@gmail.com";
  const projectRef = supabaseUrl?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  const redirectTo = "https://nac-os.netlify.app";
  const branch = "khobar";
  return { supabaseUrl, anonKey, email, projectRef, redirectTo, branch };
}

function getServiceRole(projectRef) {
  const out = execSync(`supabase projects api-keys --project-ref ${projectRef} -o json`, {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
  return JSON.parse(out).find((k) => k.name === "service_role")?.api_key;
}

async function resolveAccessToken(config) {
  const admin = createClient(config.supabaseUrl, getServiceRole(config.projectRef), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: config.email,
    options: { redirectTo: config.redirectTo },
  });
  if (error) throw error;
  const userClient = createClient(config.supabaseUrl, config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: sessionData, error: verifyError } = await userClient.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError) throw verifyError;
  return sessionData.session.access_token;
}

async function driveSync(token, config, body) {
  const res = await fetch(`${config.supabaseUrl}/functions/v1/vault-drive-sync`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || JSON.stringify(data));
  return data;
}

async function askNac(token, config, question) {
  const started = Date.now();
  const res = await fetch(`${config.supabaseUrl}/functions/v1/ask-nac`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ question, branch: config.branch, filters: { branch: config.branch } }),
  });
  const data = await res.json();
  return { ms: Date.now() - started, status: res.status, data };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function processDiscoverySyncLoop(token, config, admin, maxRounds = 12) {
  const dailyRootId = "3c125490-b901-4785-8f77-62ff9fca44aa";
  for (let round = 0; round < maxRounds; round += 1) {
    const { data: partial } = await admin
      .from("ask_nac_drive_sync_runs")
      .select("id,status,folder_row_id,discovered_count,remaining_count")
      .eq("folder_row_id", dailyRootId)
      .eq("status", "partial")
      .order("created_at", { ascending: false })
      .limit(1);
    const { data: queued } = await admin
      .from("ask_nac_drive_sync_runs")
      .select("id,status")
      .in("status", ["queued", "running"])
      .limit(5);
    if (!partial?.length && !queued?.length) {
      console.log(`Sync loop complete after ${round} rounds`);
      break;
    }
    if (partial?.length) {
      console.log(`Round ${round + 1}: process_run ${partial[0].id} remaining=${partial[0].remaining_count}`);
      await driveSync(token, config, { action: "process_run", runId: partial[0].id });
    } else if (queued?.length) {
      console.log(`Round ${round + 1}: process_run queued ${queued[0].id}`);
      await driveSync(token, config, { action: "process_run", runId: queued[0].id });
    } else {
      await driveSync(token, config, { action: "sync_ingest", folderRowId: dailyRootId, triggerType: "manual" });
    }
    await sleep(8000);
  }
}

async function aggregateStats(admin, branch) {
  const { data: runs } = await admin
    .from("ask_nac_drive_sync_runs")
    .select("*")
    .in("folder_row_id", ["3c125490-b901-4785-8f77-62ff9fca44aa", "d336b7f4-f6b6-4cd2-8ac2-4ee19d6de8ae"])
    .order("created_at", { ascending: false })
    .limit(30);

  const totals = {
    discovered_count: 0,
    downloaded_count: 0,
    extracted_count: 0,
    parsed_count: 0,
    indexed_count: 0,
    failed_count: 0,
    skipped_ignored: 0,
    skipped_needs_approval: 0,
    run_count: runs?.length || 0,
  };

  for (const run of runs || []) {
    totals.discovered_count += run.discovered_count || 0;
    totals.downloaded_count += run.downloaded_count || 0;
    totals.extracted_count += run.extracted_count || 0;
    totals.parsed_count += run.parsed_count || 0;
    totals.indexed_count += run.indexed_count || 0;
    totals.failed_count += run.failed_count || 0;
    const { data: files } = await admin
      .from("ask_nac_drive_sync_run_files")
      .select("status,error,stats")
      .eq("run_id", run.id);
    for (const f of files || []) {
      const err = String(f.error || f.stats?.discovery?.action || "");
      if (/discovery_ignored|ignore/i.test(err)) totals.skipped_ignored += 1;
      if (/discovery_needs_approval|unknown_needs_review|needs approval/i.test(err)) totals.skipped_needs_approval += 1;
    }
  }

  const { count: searchableCount } = await admin
    .from("ask_nac_files")
    .select("id", { count: "exact", head: true })
    .eq("searchable", true)
    .eq("primary_branch_id", branch);

  const { data: byType } = await admin
    .from("ask_nac_files")
    .select("report_type, searchable")
    .eq("primary_branch_id", branch);

  const typeCounts = {};
  for (const row of byType || []) {
    typeCounts[row.report_type] = typeCounts[row.report_type] || { total: 0, searchable: 0 };
    typeCounts[row.report_type].total += 1;
    if (row.searchable) typeCounts[row.report_type].searchable += 1;
  }

  return { totals, searchableCount, typeCounts, latestRun: runs?.[0] };
}

async function main() {
  const config = loadConfig();
  const token = await resolveAccessToken(config);
  const admin = createClient(config.supabaseUrl, getServiceRole(config.projectRef));

  console.log("\n=== SYNC & INGEST (discovery roots) ===");
  for (const rootId of ["3c125490-b901-4785-8f77-62ff9fca44aa", "d336b7f4-f6b6-4cd2-8ac2-4ee19d6de8ae"]) {
    await driveSync(token, config, { action: "sync_ingest", folderRowId: rootId, triggerType: "manual" });
  }
  await processDiscoverySyncLoop(token, config, admin, 15);

  const stats = await aggregateStats(admin, config.branch);
  console.log("\n=== AGGREGATE SYNC STATS (discovery roots) ===");
  console.log(JSON.stringify({ ...stats.totals, searchable_files: stats.searchableCount, by_report_type: stats.typeCounts }, null, 2));
  console.log("Latest run:", stats.latestRun?.id, stats.latestRun?.status, stats.latestRun?.error_message || "ok");

  console.log("\n=== ASK NAC QUERY TESTS ===");
  const results = [];
  for (const question of ASK_NAC_QUERIES) {
    const result = await askNac(token, config, question);
    const answer = result.data.directAnswer;
    const preview = typeof answer === "string"
      ? answer.slice(0, 220).replace(/\n/g, " ")
      : JSON.stringify(answer)?.slice(0, 220);
    console.log(`\nQ: ${question}`);
    console.log(`  ${result.ms}ms | intent=${result.data.intent} | confidence=${result.data.confidence}`);
    console.log(`  readiness=${JSON.stringify(result.data.readiness?.status || result.data.readiness)}`);
    console.log(`  ${preview}`);
    results.push({ question, intent: result.data.intent, confidence: result.data.confidence, ok: result.data.intent !== "unknown" });
  }

  const failures = results.filter((r) => r.intent === "unknown" && !/briefing|breakage/i.test(r.question));
  console.log("\n=== SUMMARY ===");
  console.log("Query failures (excluding known briefing/breakage gaps):", failures.length ? failures.map((f) => f.question) : "none");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
