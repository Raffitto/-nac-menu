/**
 * Compiler stage production verification — one safe manual upload.
 * Run: node tmp-vault-verify/compiler-stage-prod-verify.mjs
 */
import fs from "fs";
import { execSync } from "child_process";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO = path.join(__dirname, "..");
const BUNDLE = path.join(__dirname, "vault-upload-pipeline.bundle.cjs");

const LOGBOOK_SNIPPET = `NAC Khobar Logbook
Date: 2026-06-23
Breakfast: Quiet morning.
Complaints: None.
Google reviews: 5 star: 1
`;

function readEnv(key) {
  return fs.readFileSync(path.join(REPO, ".env.local"), "utf8").match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim();
}

function ensureBundle() {
  const src = path.join(REPO, "src/intelligence/askNac/vault/vaultUploadIngestion.js");
  if (!fs.existsSync(BUNDLE) || fs.statSync(BUNDLE).mtimeMs < fs.statSync(src).mtimeMs) {
    execSync(
      "npx esbuild src/intelligence/askNac/vault/vaultUploadIngestion.js --bundle --platform=node --format=cjs --external:canvas --external:pdfjs-dist --external:xlsx --outfile=tmp-vault-verify/vault-upload-pipeline.bundle.cjs",
      { cwd: REPO, stdio: "inherit" },
    );
  }
}

async function authUserClient() {
  const url = readEnv("REACT_APP_SUPABASE_URL");
  const anon = readEnv("REACT_APP_SUPABASE_ANON_KEY");
  const ref = url.match(/https:\/\/([^.]+)/)[1];
  const sk = JSON.parse(execSync(`supabase projects api-keys --project-ref ${ref} -o json`, { encoding: "utf8", cwd: REPO }))
    .find((k) => k.name === "service_role").api_key;
  const admin = createClient(url, sk, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: link } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: "raffiazarian2@gmail.com",
    options: { redirectTo: "https://nac-os.netlify.app" },
  });
  const user = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: sess, error } = await user.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (error) throw error;
  const token = sess.session.access_token;
  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return { supabase, url, token, email: "raffiazarian2@gmail.com" };
}

async function safeUploadAndIngest(supabase, { email, token: _token }) {
  const filename = `compiler-stage-verify-${Date.now()}.txt`;
  const fileId = crypto.randomUUID();
  const storagePath = `khobar/operations/${fileId}/${filename}`;
  const file = new File([LOGBOOK_SNIPPET], filename, { type: "text/plain" });

  const row = {
    id: fileId,
    title: `Compiler stage verify ${new Date().toISOString()}`,
    original_filename: filename,
    storage_bucket: "ask-nac-vault-originals",
    storage_path: storagePath,
    branch_scope_type: "single_branch",
    primary_branch_id: "khobar",
    brand_wide: false,
    department: "operations",
    report_type: "daily_logbook",
    data_layer: "operational",
    sensitivity_level: "internal",
    status: "active",
    uploaded_by: email.split("@")[0],
    uploader_email: email,
    content_hash: `compiler-stage-${fileId}`,
    ingestion_source: "manual_upload",
    period_start: "2026-06-23",
    period_end: "2026-06-23",
  };

  const { error: storageError } = await supabase.storage
    .from("ask-nac-vault-originals")
    .upload(storagePath, file, { contentType: "text/plain" });
  if (storageError) throw new Error(`storage: ${storageError.message}`);

  const { error: insertError } = await supabase.from("ask_nac_files").insert(row);
  if (insertError) {
    await supabase.storage.from("ask-nac-vault-originals").remove([storagePath]);
    throw new Error(`insert: ${insertError.message}`);
  }

  const versionId = crypto.randomUUID();
  await supabase.from("ask_nac_file_versions").insert({
    id: versionId,
    file_id: fileId,
    version_no: 1,
    storage_path: storagePath,
    size_bytes: file.size,
    mime_type: "text/plain",
    content_hash: row.content_hash,
  });

  await supabase.from("ask_nac_data_coverage").insert({
    branch_id: "khobar",
    brand_wide: false,
    department: "operations",
    report_type: "daily_logbook",
    period_start: "2026-06-23",
    period_end: "2026-06-23",
    source_file_id: fileId,
    fact_count: 0,
    readiness_status: "registered",
  });

  const { runVaultFileIngestionPipeline } = require(BUNDLE);
  const pipeline = await runVaultFileIngestionPipeline(supabase, {
    file,
    fileRecord: { ...row },
    fileId,
    versionRowId: versionId,
    email,
    reportType: "daily_logbook",
    compilerMetadata: {
      knowledgeDomain: "operations",
      source: "manual_upload",
    },
  });

  return { fileId, pipeline, filename };
}

function validateStages(job) {
  const stages = job?.compiler_stages || [];
  const names = stages.map((s) => s.stage);
  const issues = [];
  if (!names.includes("classify")) issues.push("missing classify");
  if (!names.some((s) => ["legacy_chunk", "legacy_parse"].includes(s))) {
    issues.push("missing legacy_chunk or legacy_parse");
  }
  if (!names.includes("publish")) issues.push("missing publish");
  for (const s of stages) {
    if (!s.status) issues.push(`${s.stage}: no status`);
    if (s.status === "completed" && !s.finished_at && !s.started_at) {
      issues.push(`${s.stage}: completed without timestamps`);
    }
    if (s.status === "failed" && !s.error) issues.push(`${s.stage}: failed without error`);
  }
  return { names, issues, pass: issues.length === 0 && names.length >= 3 };
}

async function main() {
  ensureBundle();
  const { supabase, url, token, email } = await authUserClient();
  const { fileId, pipeline } = await safeUploadAndIngest(supabase, { email, token });

  console.log("PIPELINE", JSON.stringify({
    ok: pipeline.ok,
    storedOnly: pipeline.storedOnly,
    jobId: pipeline.jobId,
    factsPersisted: pipeline.ingestion?.factsPersisted,
    chunkCount: pipeline.chunking?.chunkCount,
    chunkOk: pipeline.chunking?.ok,
  }, null, 2));

  const { data: jobs } = await supabase
    .from("ask_nac_ingestion_jobs")
    .select("id, file_id, status, stage, compiler_profile, compiler_version, compiler_stage, compiler_stages, compilation_manifest, quarantine_reason, stats, error")
    .eq("file_id", fileId)
    .order("created_at", { ascending: false })
    .limit(1);

  const job = jobs?.[0];
  const stageValidation = validateStages(job);

  console.log("INGESTION_JOB", JSON.stringify({
    job_id: job?.id,
    file_id: job?.file_id,
    status: job?.status,
    compiler_profile: job?.compiler_profile,
    compiler_version: job?.compiler_version,
    compiler_stage: job?.compiler_stage,
    compiler_stages: job?.compiler_stages,
    compilation_manifest: job?.compilation_manifest,
    quarantine_reason: job?.quarantine_reason,
  }, null, 2));

  console.log("STAGE_VALIDATION", JSON.stringify(stageValidation, null, 2));

  const { data: fileRow } = await supabase
    .from("ask_nac_files")
    .select("id, status, report_type, chunk_count, search_status, knowledge_domain")
    .eq("id", fileId)
    .maybeSingle();
  const { count: chunkCount } = await supabase
    .from("ask_nac_document_chunks")
    .select("id", { count: "exact", head: true })
    .eq("file_id", fileId);
  const { count: factCount } = await supabase
    .from("ask_nac_structured_facts")
    .select("id", { count: "exact", head: true })
    .eq("file_id", fileId);
  const { data: coverage } = await supabase
    .from("ask_nac_data_coverage")
    .select("fact_count, readiness_status")
    .eq("source_file_id", fileId)
    .maybeSingle();

  console.log("VAULT_OUTPUTS", JSON.stringify({ fileRow, chunkCount, factCount, coverage }, null, 2));

  const askResults = [];
  for (const question of ["health check", "show latest cash up", "summarize May operations"]) {
    const res = await fetch(`${url}/functions/v1/ask-nac`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ question, branch: "khobar", filters: { branch: "khobar" } }),
    });
    const data = await res.json();
    askResults.push({ question, status: res.status, intent: data.intent, confidence: data.confidence });
  }
  console.log("ASK_NAC", JSON.stringify(askResults, null, 2));

  const vaultOk = fileRow?.status === "active" && (chunkCount || 0) > 0;
  const askOk = askResults.every((r) => r.status === 200);
  const pass = stageValidation.pass && job?.compiler_version && vaultOk && pipeline.ok && askOk;
  console.log("VERIFICATION", pass ? "PASS" : "FAIL");
  process.exitCode = pass ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
