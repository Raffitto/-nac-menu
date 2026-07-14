/**
 * Finish Daily sync, retry discoveryDecision failures, report counts.
 */
import fs from "fs";
import { execSync } from "child_process";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");
const DAILY_ROOT = "3c125490-b901-4785-8f77-62ff9fca44aa";
const WEEKLY_ROOT = "d336b7f4-f6b6-4cd2-8ac2-4ee19d6de8ae";
const BRANCH = "khobar";

function readEnv(k) {
  return fs.readFileSync(path.join(REPO, ".env.local"), "utf8").match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();
}

async function main() {
  const url = readEnv("REACT_APP_SUPABASE_URL");
  const anon = readEnv("REACT_APP_SUPABASE_ANON_KEY");
  const ref = url.match(/https:\/\/([^.]+)/)[1];
  const sk = JSON.parse(execSync(`supabase projects api-keys --project-ref ${ref} -o json`, { encoding: "utf8", cwd: REPO }))
    .find((k) => k.name === "service_role").api_key;
  const admin = createClient(url, sk);
  const adminAuth = createClient(url, sk, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: link } = await adminAuth.auth.admin.generateLink({
    type: "magiclink",
    email: "raffiazarian2@gmail.com",
    options: { redirectTo: "https://nac-os.netlify.app" },
  });
  const user = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: sess } = await user.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  const token = sess.session.access_token;

  async function drive(body) {
    const res = await fetch(`${url}/functions/v1/vault-drive-sync`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    return data;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  console.log("\n=== DAILY SYNC LOOP ===");
  let lastRemaining = Infinity;
  for (let round = 0; round < 25; round += 1) {
    let runId;
    try {
      const queued = await drive({ action: "sync_ingest", folderId: DAILY_ROOT, triggerType: "manual" });
      runId = queued.runId || queued.runIds?.[0];
      console.log(`Round ${round + 1}: queued ${runId}`);
      await drive({ action: "process_run", runId, maxFilesToProcess: 30 });
    } catch (err) {
      console.log(" process error:", String(err.message || err).slice(0, 120));
      if (runId) {
        try {
          await drive({ action: "process_run", runId, maxFilesToProcess: 15 });
        } catch (err2) {
          console.log(" retry smaller batch failed:", String(err2.message || err2).slice(0, 120));
          await sleep(20000);
          continue;
        }
      } else {
        await sleep(20000);
        continue;
      }
    }
    await sleep(12000);
    const { data: run } = await admin.from("ask_nac_drive_sync_runs").select("status,stats").eq("id", runId).maybeSingle();
    const remaining = run?.stats?.remainingFiles ?? 0;
    console.log(` status=${run?.status} offset=${run?.stats?.nextFileOffset} remaining=${remaining}`);
    if (run?.status === "completed" && remaining === 0) {
      console.log("Daily sync complete");
      break;
    }
    if (remaining === lastRemaining && run?.status === "partial") {
      console.log("No progress this round — stopping loop");
      break;
    }
    lastRemaining = remaining;
  }

  console.log("\n=== RETRY discoveryDecision FAILURES ===");
  const { data: bugFails } = await admin
    .from("ask_nac_drive_sync_run_files")
    .select("drive_file_id,file_name,folder_id,error")
    .eq("status", "failed")
    .ilike("error", "%discoveryDecision is not defined%");
  console.log(`Found ${bugFails?.length || 0} bug-affected files`);
  for (const row of bugFails || []) {
    const folderId = row.folder_id || DAILY_ROOT;
    console.log(" retry:", row.file_name);
    const q = await drive({ action: "retry_file", folderId, driveFileId: row.drive_file_id, force: true });
    const runId = q.runId || q.runIds?.[0];
    if (runId) await drive({ action: "process_run", runId, force: true });
    await sleep(8000);
  }

  console.log("\n=== WEEKLY ROOT SYNC ===");
  const wq = await drive({ action: "sync_ingest", folderId: WEEKLY_ROOT, triggerType: "manual" });
  await drive({ action: "process_run", runId: wq.runId, maxFilesToProcess: 50, force: false });

  const { data: latestPartial } = await admin
    .from("ask_nac_drive_sync_runs")
    .select("stats,status")
    .eq("folder_id", DAILY_ROOT)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const remainingUnprocessed = latestPartial?.stats?.remainingFiles ?? latestPartial?.stats?.remainingNeedWork ?? 0;

  const { data: failedAfter } = await admin
    .from("ask_nac_drive_sync_run_files")
    .select("file_name,error")
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(200);
  const bugFailsAfter = (failedAfter || []).filter((f) => /discoveryDecision is not defined/i.test(String(f.error || "")));

  const { data: files } = await admin.from("ask_nac_files").select("report_type,searchable").eq("primary_branch_id", BRANCH);
  const byType = {};
  for (const f of files || []) {
    byType[f.report_type] = byType[f.report_type] || { total: 0, searchable: 0 };
    byType[f.report_type].total += 1;
    if (f.searchable) byType[f.report_type].searchable += 1;
  }

  console.log("\n=== FINAL REPORT ===");
  console.log(JSON.stringify({
    remaining_unprocessed: remainingUnprocessed,
    latest_run_status: latestPartial?.status,
    failed_files_total: failedAfter?.length,
    failed_discoveryDecision_after_retry: bugFailsAfter.length,
    failed_discoveryDecision_samples: bugFailsAfter.slice(0, 5).map((f) => f.file_name),
    searchable_by_report_type: byType,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
