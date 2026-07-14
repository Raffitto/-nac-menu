/**
 * Production verification: Daily/Weekly discovery roots, discover, sync, Ask NAC.
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
];

function readEnvLocalValue(key) {
  const envPath = path.join(REPO_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return null;
  return fs.readFileSync(envPath, "utf8").match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim() || null;
}

function loadConfig() {
  const supabaseUrl = process.env.SUPABASE_URL
    || process.env.REACT_APP_SUPABASE_URL
    || readEnvLocalValue("REACT_APP_SUPABASE_URL");
  const anonKey = process.env.SUPABASE_ANON_KEY
    || process.env.REACT_APP_SUPABASE_ANON_KEY
    || readEnvLocalValue("REACT_APP_SUPABASE_ANON_KEY");
  const email = process.env.ASK_NAC_VERIFY_EMAIL?.trim() || "raffiazarian2@gmail.com";
  const projectRef = process.env.SUPABASE_PROJECT_REF
    || supabaseUrl?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]
    || null;
  const redirectTo = process.env.ASK_NAC_VERIFY_REDIRECT?.trim() || "https://nac-os.netlify.app";
  const accessToken = process.env.ASK_NAC_ACCESS_TOKEN?.trim() || null;
  const branch = process.env.ASK_NAC_VERIFY_BRANCH || "khobar";
  if (!supabaseUrl || !anonKey || !projectRef) throw new Error("Missing Supabase config");
  return { supabaseUrl, anonKey, email, projectRef, redirectTo, accessToken, branch };
}

function getServiceRole(projectRef) {
  const out = execSync(`supabase projects api-keys --project-ref ${projectRef} -o json`, {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
  const service = JSON.parse(out).find((k) => k.name === "service_role" || k.id === "service_role");
  if (!service?.api_key) throw new Error("service_role key not found");
  return service.api_key;
}

async function resolveAccessToken(config) {
  if (config.accessToken) return config.accessToken;
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

async function driveSync(token, body) {
  const res = await fetch(`${loadConfig().supabaseUrl}/functions/v1/vault-drive-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || JSON.stringify(data));
  return data;
}

async function askNac(token, question, branch) {
  const started = Date.now();
  const res = await fetch(`${loadConfig().supabaseUrl}/functions/v1/ask-nac`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question, branch, filters: { branch } }),
  });
  const data = await res.json();
  return { ms: Date.now() - started, status: res.status, data };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findFolderByName(token, parentId, namePattern) {
  const browse = await driveSync(token, { action: "browse", folderId: parentId, recursive: false });
  const folders = browse.folders || [];
  const hit = folders.find((f) => namePattern.test(String(f.name || "")));
  return hit || null;
}

async function walkFindFolder(token, startId, namePattern, depth = 0, maxDepth = 4) {
  if (depth > maxDepth) return null;
  const browse = await driveSync(token, { action: "browse", folderId: startId, recursive: false });
  for (const folder of browse.folders || []) {
    if (namePattern.test(String(folder.name || ""))) return folder;
  }
  for (const folder of browse.folders || []) {
    const nested = await walkFindFolder(token, folder.id, namePattern, depth + 1, maxDepth);
    if (nested) return nested;
  }
  return null;
}

async function pollRuns(token, admin, maxWaitMs = 600000) {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const { data: runs } = await admin
      .from("ask_nac_drive_sync_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);
    const active = (runs || []).find((r) => ["queued", "running"].includes(r.status));
    if (!active) return runs || [];
    await sleep(5000);
  }
  throw new Error("Drive sync runs did not complete in time");
}

function normalizePath(s = "") {
  return String(s).replace(/\\/g, "/").trim();
}

function matchesExpected(item, expected) {
  const path = normalizePath(item.operationalPath || item.folderPath || "").toLowerCase();
  const type = String(item.detectedReportType || "").toLowerCase();
  const action = String(item.recommendedAction || item.action || "").toLowerCase();
  return path.includes(expected.pathFragment.toLowerCase())
    && type === expected.type
    && action === expected.action;
}

const EXPECTED = [
  { pathFragment: "Daily/Cash Up", type: "cash_up", action: "ingest" },
  { pathFragment: "Cash Up", type: "cash_up", action: "ingest" },
  { pathFragment: "Daily/Logbook", type: "daily_logbook", action: "ingest" },
  { pathFragment: "Logbook", type: "daily_logbook", action: "ingest" },
  { pathFragment: "Daily Reception", type: "daily_reception", action: "ingest" },
  { pathFragment: "Daily Briefing", type: "daily_briefing", action: "ingest" },
  { pathFragment: "CCM and Foodics", type: "ccm_reconciliation", action: "ingest" },
  { pathFragment: "Breakage", type: "breakage_report", action: "ingest" },
  { pathFragment: "Discount and comp", type: "discount_void_comp", action: "ingest" },
  { pathFragment: "Voids discounts", type: "discount_void_comp", action: "ingest" },
  { pathFragment: "Guest Feedback", type: "guest_feedback", action: "ask" },
  { pathFragment: "Daily Napkins", type: "ignore", action: "ignore" },
  { pathFragment: "Monthly Cash Safe", type: "ignore", action: "ignore" },
  { pathFragment: "Weekly Dashboards", type: "weekly_dashboard", action: "ingest" },
];

async function main() {
  const config = loadConfig();
  const token = await resolveAccessToken(config);
  const serviceKey = getServiceRole(config.projectRef);
  const admin = createClient(config.supabaseUrl, serviceKey);

  console.log("\n=== STEP 1: Locate Daily / Weekly folders ===");
  const cashupFolderId = "1M0hWaNrItKiRwCVaf1_vCG78yyNAZ0NI";
  let dailyFolder = await walkFindFolder(token, "root", /^daily$/i);
  let weeklyFolder = await walkFindFolder(token, "root", /^weekly$/i);
  if (!dailyFolder) dailyFolder = await walkFindFolder(token, cashupFolderId, /^daily$/i, 0, 6);
  if (!dailyFolder) {
    const cashBrowse = await driveSync(token, { action: "browse", folderId: cashupFolderId });
    const parentGuess = cashBrowse.folder?.name;
    console.log("Cashup browse context:", parentGuess);
    dailyFolder = await findFolderByName(token, "root", /^daily$/i);
  }
  if (!weeklyFolder) weeklyFolder = await findFolderByName(token, "root", /^weekly$/i);

  if (!dailyFolder || !weeklyFolder) {
    const rootBrowse = await driveSync(token, { action: "browse", folderId: "root" });
    console.log("Root folders:", (rootBrowse.folders || []).map((f) => f.name).join(", "));
    throw new Error(`Could not find Daily/Weekly. daily=${dailyFolder?.name || "missing"} weekly=${weeklyFolder?.name || "missing"}`);
  }
  console.log("Daily:", dailyFolder.id, dailyFolder.name);
  console.log("Weekly:", weeklyFolder.id, weeklyFolder.name);

  console.log("\n=== STEP 2: Register discovery roots ===");
  for (const folder of [dailyFolder, weeklyFolder]) {
    const reg = await driveSync(token, {
      action: "register_folder",
      folderId: folder.id,
      folderName: folder.name,
      branchId: config.branch,
      defaultBranchId: config.branch,
      department: "operations",
      reportType: "discovery_root",
      sensitivity: "internal",
      autoIngest: true,
      isDiscoveryRoot: true,
      schedule: "daily",
    });
    console.log("Registered:", reg.folder?.folder_name, reg.folder?.id, "discovery_root=", reg.folder?.is_discovery_root);
  }

  console.log("\n=== STEP 3: discover_folders (Drive API scan) ===");
  const discovery = await driveSync(token, { action: "discover_folders" });
  const items = discovery.items || [];
  console.log("\nDISCOVERY TABLE:");
  console.log("| Folder path | Report type | Action | Confidence | Reason | Sample files |");
  console.log("|---|---|---|---|---|---|");
  for (const item of items) {
    const samples = (item.sampleFilenames || []).slice(0, 3).join("; ") || "—";
    console.log(
      `| ${item.folderPath || item.operationalPath} | ${item.detectedReportType} | ${item.recommendedAction || item.action} | ${Math.round((item.confidence || 0) * 100)}% | ${String(item.reason || "").slice(0, 60)} | ${samples} |`,
    );
  }

  const summary = discovery.summary || {};
  console.log("\nDiscovery summary:", JSON.stringify(summary, null, 2));

  const expectedChecks = [
    ["cash_up ingest", items.some((i) => /cash up|cashup/i.test(i.folderPath || "") && i.detectedReportType === "cash_up" && (i.recommendedAction || i.action) === "ingest")],
    ["logbook ingest", items.some((i) => /logbook/i.test(i.folderPath || "") && i.detectedReportType === "daily_logbook")],
    ["guest feedback ask", items.some((i) => /guest feedback/i.test(i.folderPath || "") && (i.recommendedAction || i.action) === "ask")],
    ["napkins ignore", items.some((i) => /napkins/i.test(i.folderPath || "") && (i.recommendedAction || i.action) === "ignore")],
    ["weekly dashboard ingest", items.some((i) => /weekly dashboard/i.test(i.folderPath || "") && i.detectedReportType === "weekly_dashboard")],
  ];
  const failedExpectations = expectedChecks.filter(([, ok]) => !ok).map(([label]) => label);
  if (failedExpectations.length) {
    console.error("\nEXPECTATION FAILURES:", failedExpectations.join(", "));
    process.exitCode = 1;
    return;
  }
  console.log("\nDiscovery expectations: PASS");

  console.log("\n=== STEP 4: Ask NAC discover Drive folders ===");
  const discoverAsk = await askNac(token, "discover Drive folders", config.branch);
  console.log("Intent:", discoverAsk.data.intent);
  console.log("Answer preview:", String(discoverAsk.data.directAnswer || "").slice(0, 400));

  console.log("\n=== STEP 5: Sync & Ingest discovery roots ===");
  const { data: roots } = await admin
    .from("ask_nac_drive_sync_folders")
    .select("id,folder_name")
    .eq("is_discovery_root", true)
    .eq("branch_id", config.branch);
  for (const root of roots || []) {
    console.log("Starting sync_ingest for", root.folder_name, root.id);
    await driveSync(token, { action: "sync_ingest", folderRowId: root.id, triggerType: "manual" });
  }

  console.log("Processing runs...");
  let runs = await pollRuns(token, admin, 900000);
  for (const run of runs.slice(0, 4)) {
    if (["queued", "running"].includes(run.status)) {
      await driveSync(token, { action: "process_run", runId: run.id });
    }
  }
  runs = await pollRuns(token, admin, 900000);

  const latest = runs[0] || {};
  const skippedFiles = await admin
    .from("ask_nac_drive_sync_run_files")
    .select("status,action,error,stats")
    .eq("run_id", latest.id);
  const skippedRows = skippedFiles.data || [];
  const ignoredSkip = skippedRows.filter((r) => /discovery_ignored|ignore/i.test(String(r.error || r.stats?.discovery?.action || ""))).length;
  const approvalSkip = skippedRows.filter((r) => /discovery_needs_approval|unknown_needs_review|ask/i.test(String(r.error || ""))).length;

  const { data: searchable } = await admin
    .from("ask_nac_files")
    .select("id", { count: "exact", head: true })
    .eq("searchable", true)
    .eq("primary_branch_id", config.branch);

  console.log("\n=== SYNC RESULTS ===");
  console.log(JSON.stringify({
    runId: latest.id,
    status: latest.status,
    discovered_count: latest.discovered_count,
    downloaded_count: latest.downloaded_count,
    extracted_count: latest.extracted_count,
    parsed_count: latest.parsed_count,
    indexed_count: latest.indexed_count,
    failed_count: latest.failed_count,
    skipped_ignored: ignoredSkip,
    skipped_needs_approval: approvalSkip,
    searchable_files: searchable?.length ?? searchable,
    error_message: latest.error_message,
  }, null, 2));

  console.log("\n=== STEP 6: Ask NAC query tests ===");
  for (const question of ASK_NAC_QUERIES) {
    const result = await askNac(token, question, config.branch);
    const preview = String(result.data.directAnswer || result.data.title || "").slice(0, 180).replace(/\n/g, " ");
    console.log(`\nQ: ${question}`);
    console.log(`  ${result.ms}ms | intent=${result.data.intent} | confidence=${result.data.confidence}`);
    console.log(`  ${preview}`);
  }

  console.log("\n=== VERIFICATION COMPLETE ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
