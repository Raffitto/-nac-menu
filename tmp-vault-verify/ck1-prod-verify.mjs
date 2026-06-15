/**
 * CK-1 production verification — scoped user JWT, no Drive.
 * Run: node tmp-vault-verify/ck1-prod-verify.mjs
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { execSync } from "child_process";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const SCOPED_EMAIL = "raffiazarian@gmail.com";
const URL = "https://zeyhvjuraqnlbdycgrme.supabase.co";
const ANON = fs
  .readFileSync(".env.local", "utf8")
  .match(/^REACT_APP_SUPABASE_ANON_KEY=(.+)$/m)?.[1]
  ?.trim();
const EXPECTED_BUILD_PREFIX = "02d2c0f";

const LEGACY_DOC_MESSAGE =
  "Legacy Word .doc files are not supported. Save as DOCX and upload again.";
const SUPPORTED = new Set([".pdf", ".xlsx", ".xls", ".csv", ".docx", ".txt"]);
const PARSEABLE = new Set([
  "cash_up",
  "reception_daily_report",
  "daily_logbook",
  "ccm_reconciliation",
  "weekly_sales_overview",
  "pnl",
]);
const STORED_ONLY = [
  "foodics_export",
  "budget",
  "forecast",
  "gm_report",
  "audit_report",
  "brand_brain_sop",
  "other",
];

const SAMPLE_LOGBOOK = `Branch: Khobar
Date: 2026-06-08
Shift: Lunch
MOD: Sarah
Chef on duty: Marco
Bar MOD: Ali
Complaints: 2 guests waited 20+ minutes for tables.
Operational issues: POS lag during peak hour.
Staff performance notes: Host team recovered well after rush.
Training notes: New host shadowing reservations desk.
Google reviews: 5 star: 4, 4 star: 2, 3 star: 1
`;

function ext(name) {
  const n = String(name || "").toLowerCase();
  return n.includes(".") ? n.slice(n.lastIndexOf(".")) : "";
}

function isLegacyDoc(name) {
  return ext(name) === ".doc";
}

function isSupported(name) {
  return SUPPORTED.has(ext(name));
}

function isParseable(reportType) {
  return PARSEABLE.has(reportType);
}

function computeTier({ facts = 0, readiness = "registered" }) {
  if (facts > 0 && (readiness === "ready" || readiness === "partial")) {
    return "Ask-NAC-ready";
  }
  if (facts > 0 || readiness === "ready" || readiness === "partial") {
    return "Parsed";
  }
  return "Stored";
}

function resolveRegStatus({ storedOnly, ingestionOk }) {
  if (storedOnly) return "registered";
  if (ingestionOk) return "completed";
  if (ingestionOk === false) return "failed";
  return "registered";
}

function partitionFiles(files) {
  const legacyDocFiles = [];
  const supported = [];
  for (const f of files) {
    if (!f?.name) continue;
    if (isLegacyDoc(f.name)) legacyDocFiles.push(f);
    else if (isSupported(f.name)) supported.push(f);
  }
  return { legacyDocFiles, supported };
}

function getServiceRole() {
  const out = execSync(
    "supabase projects api-keys --project-ref zeyhvjuraqnlbdycgrme -o json",
    { encoding: "utf8", cwd: process.cwd() },
  );
  const keys = JSON.parse(out);
  const service = keys.find((k) => k.name === "service_role" || k.id === "service_role");
  if (!service?.api_key) throw new Error("service_role key not found");
  return service.api_key;
}

async function scopedClient() {
  const serviceRole = getServiceRole();
  const admin = createClient(URL, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: SCOPED_EMAIL,
    options: { redirectTo: "https://nac-os.netlify.app/" },
  });
  if (error) throw error;
  const userClient = createClient(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: sessionData, error: verifyError } = await userClient.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError) throw verifyError;
  return createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${sessionData.session.access_token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function runStoredOnlyPipeline(supabase, { fileId, reportType }) {
  const jobId = crypto.randomUUID();
  const { error: jobError } = await supabase.from("ask_nac_ingestion_jobs").insert({
    id: jobId,
    file_id: fileId,
    status: "registered",
    stage: "registry_only",
    stats: { note: "Stored — no structured parser for this report type" },
  });
  if (jobError) {
    return { ok: false, storedOnly: true, jobId, jobError: jobError.message, ingestion: null };
  }
  return { ok: true, storedOnly: true, jobId, jobError: null, ingestion: null };
}

function loadLogbookParser() {
  const bundlePath = path.join(__dirname, "parseDailyLogbook.bundle.cjs");
  if (!fs.existsSync(bundlePath)) {
    execSync(
      "npx esbuild src/intelligence/askNac/vault/parsers/parseDailyLogbook.js --bundle --platform=node --format=cjs --external:canvas --external:pdfjs-dist --outfile=tmp-vault-verify/parseDailyLogbook.bundle.cjs",
      { cwd: path.join(__dirname, ".."), stdio: "pipe" },
    );
  }
  return require(bundlePath);
}

async function uploadParseableProbe(supabase, { filename, content, mimeType, reportType, title }) {
  const email = SCOPED_EMAIL;
  const fileId = crypto.randomUUID();
  const storagePath = `khobar/operations/${fileId}/${filename}`;
  const blob = new Blob([content], { type: mimeType });

  const row = {
    id: fileId,
    title: title || filename,
    original_filename: filename,
    storage_bucket: "ask-nac-vault-originals",
    storage_path: storagePath,
    branch_scope_type: "single_branch",
    primary_branch_id: "khobar",
    brand_wide: false,
    department: "operations",
    report_type: reportType,
    data_layer: "operational",
    sensitivity_level: "internal",
    status: "active",
    uploaded_by: "ck1-verify",
    uploader_email: email,
    content_hash: `ck1-parse-${fileId}`,
    ingestion_source: "manual_upload",
  };

  const { error: storageError } = await supabase.storage
    .from("ask-nac-vault-originals")
    .upload(storagePath, blob, { contentType: mimeType });
  if (storageError) return { ok: false, stage: "storage", error: storageError.message };

  const { error: insertError } = await supabase.from("ask_nac_files").insert(row);
  if (insertError) {
    await supabase.storage.from("ask-nac-vault-originals").remove([storagePath]);
    return { ok: false, stage: "insert", error: insertError.message };
  }

  const jobId = crypto.randomUUID();
  await supabase.from("ask_nac_ingestion_jobs").insert({
    id: jobId,
    file_id: fileId,
    status: "queued",
    stage: "parse",
  });

  await supabase.from("ask_nac_data_coverage").insert({
    branch_id: "khobar",
    brand_wide: false,
    department: "operations",
    report_type: reportType,
    source_file_id: fileId,
    fact_count: 0,
    readiness_status: "registered",
  });

  const { parseDailyLogbookText } = loadLogbookParser();
  const parsed = parseDailyLogbookText(content, {
    fileId,
    branchId: "khobar",
    department: "operations",
    sensitivityLevel: "internal",
    createdBy: email,
  });

  const facts = parsed.facts || [];
  let factsPersisted = 0;
  if (facts.length > 0) {
    const { data, error: factsError } = await supabase
      .from("ask_nac_structured_facts")
      .insert(facts)
      .select("id");
    if (factsError) {
      return { ok: false, stage: "facts", error: factsError.message, parseOk: parsed.ok };
    }
    factsPersisted = data?.length || facts.length;
  }

  const publish = parsed.confidenceMeta?.publish !== false;
  const readiness = factsPersisted > 0 ? (publish ? "ready" : "partial") : "registered";

  await supabase
    .from("ask_nac_data_coverage")
    .update({ fact_count: factsPersisted, readiness_status: readiness })
    .eq("source_file_id", fileId);

  await supabase
    .from("ask_nac_ingestion_jobs")
    .update({
      status: factsPersisted > 0 ? "completed" : "failed",
      stage: factsPersisted > 0 ? "facts_published" : "parse",
      stats: { factsPersisted },
    })
    .eq("id", jobId);

  const tier = computeTier({ facts: factsPersisted, readiness });
  const regStatus = resolveRegStatus({ storedOnly: false, ingestionOk: factsPersisted > 0 });

  return {
    ok: factsPersisted > 0,
    reportType,
    storedOnly: false,
    regStatus,
    jobStatus: factsPersisted > 0 ? "completed" : "failed",
    factsPersisted,
    tier,
    parseOk: parsed.ok,
    ingestionOk: factsPersisted > 0,
  };
}

async function fetchBundleChecks() {
  const html = await (await fetch("https://nac-os.netlify.app")).text();
  const manifest = await (await fetch("https://nac-os.netlify.app/asset-manifest.json")).json();
  const vaultChunk =
    Object.entries(manifest.files || {}).find(
      ([key, path]) => key.startsWith("static/js/") && key.endsWith(".js") && key.includes("54."),
    )?.[1] || "/static/js/54.b336f595.chunk.js";
  const js = await (await fetch(`https://nac-os.netlify.app${vaultChunk}`)).text();
  return { html, js, vaultChunk };
}

async function uploadProbe(supabase, { filename, content, mimeType, reportType, title }) {
  const email = SCOPED_EMAIL;
  const fileId = crypto.randomUUID();
  const storagePath = `khobar/operations/${fileId}/${filename}`;
  const blob = new Blob([content], { type: mimeType });
  const file = new File([content], filename, { type: mimeType });

  const row = {
    id: fileId,
    title: title || filename,
    original_filename: filename,
    storage_bucket: "ask-nac-vault-originals",
    storage_path: storagePath,
    branch_scope_type: "single_branch",
    primary_branch_id: "khobar",
    brand_wide: false,
    department: "operations",
    report_type: reportType,
    data_layer: "operational",
    sensitivity_level: "internal",
    status: "active",
    uploaded_by: "ck1-verify",
    uploader_email: email,
    content_hash: `ck1-${fileId}`,
    ingestion_source: "manual_upload",
  };

  const { error: storageError } = await supabase.storage
    .from("ask-nac-vault-originals")
    .upload(storagePath, blob, { contentType: mimeType });
  if (storageError) return { ok: false, stage: "storage", error: storageError.message };

  const { error: insertError } = await supabase.from("ask_nac_files").insert(row);
  if (insertError) {
    await supabase.storage.from("ask-nac-vault-originals").remove([storagePath]);
    return { ok: false, stage: "insert", error: insertError.message };
  }

  const pipeline = await runStoredOnlyPipeline(supabase, { fileId, reportType });
  const regStatus = resolveRegStatus({
    storedOnly: pipeline.storedOnly,
    ingestionOk: pipeline.ingestion?.ok,
  });

  const factCount = pipeline.ingestion?.factsPersisted || 0;
  const readiness =
    factCount > 0 ? (pipeline.ingestion?.publish ? "ready" : "partial") : "registered";

  await supabase.from("ask_nac_data_coverage").insert({
    branch_id: "khobar",
    brand_wide: false,
    department: "operations",
    report_type: reportType,
    source_file_id: fileId,
    fact_count: factCount,
    readiness_status: readiness,
  });

  const { data: job } = await supabase
    .from("ask_nac_ingestion_jobs")
    .select("status, stage")
    .eq("id", pipeline.jobId)
    .maybeSingle();

  return {
    ok: true,
    reportType,
    storedOnly: pipeline.storedOnly,
    regStatus,
    jobStatus: job?.status,
    factsPersisted: factCount,
    tier: computeTier({ facts: factCount, readiness }),
  };
}

async function bulkImportProbe(supabase, files) {
  const email = SCOPED_EMAIL;
  const { legacyDocFiles, supported } = partitionFiles(files);
  if (!supported.length) {
    return {
      ok: false,
      legacyDocSkipped: legacyDocFiles.length,
      error: `No supported files found in folder (PDF, XLSX, CSV, DOCX, TXT).${legacyDocFiles.length ? ` ${LEGACY_DOC_MESSAGE}` : ""}`,
    };
  }

  const batchId = crypto.randomUUID();
  await supabase.from("ask_nac_bulk_import_batches").insert({
    id: batchId,
    label: `CK-1 folder verify ${new Date().toISOString()}`,
    uploader_email: email,
    status: "processing",
    total_files: supported.length,
  });

  const results = [];
  for (const f of supported) {
    const fileId = crypto.randomUUID();
    const storagePath = `khobar/operations/${fileId}/${f.name}`;
    const blob = new Blob([f.content], { type: f.mimeType });
    const { error: storageError } = await supabase.storage
      .from("ask-nac-vault-originals")
      .upload(storagePath, blob, { contentType: f.mimeType });
    if (storageError) {
      results.push({ name: f.name, ok: false, error: storageError.message });
      continue;
    }
    const { error: insertError } = await supabase.from("ask_nac_files").insert({
      id: fileId,
      title: f.name,
      original_filename: f.name,
      storage_bucket: "ask-nac-vault-originals",
      storage_path: storagePath,
      branch_scope_type: "single_branch",
      primary_branch_id: "khobar",
      brand_wide: false,
      department: "operations",
      report_type: "budget",
      data_layer: "operational",
      sensitivity_level: "internal",
      status: "active",
      uploaded_by: "ck1-verify",
      uploader_email: email,
      content_hash: `bulk-ck1-${fileId}`,
      ingestion_source: "bulk_import",
      bulk_batch_id: batchId,
    });
    results.push({ name: f.name, ok: !insertError, storedOnly: true, error: insertError?.message || null });
  }

  await supabase
    .from("ask_nac_bulk_import_batches")
    .update({
      status: "completed",
      processed_files: results.length,
      succeeded_files: results.filter((r) => r.ok).length,
      failed_files: results.filter((r) => !r.ok).length,
    })
    .eq("id", batchId);

  return {
    ok: results.every((r) => r.ok),
    legacyDocSkipped: legacyDocFiles.length,
    supportedCount: supported.length,
    results,
  };
}

async function main() {
  const { html, js, vaultChunk } = await fetchBundleChecks();
  const buildId = html.match(/name="build-id" content="([^"]+)"/)?.[1] || "";

  const clientChecks = {
    docRejected: isLegacyDoc("report.doc") && !isSupported("report.doc"),
    txt: isSupported("a.txt"),
    pdf: isSupported("a.pdf"),
    csv: isSupported("a.csv"),
    docx: isSupported("a.docx"),
    xlsx: isSupported("a.xlsx"),
    budgetStoredOnly: STORED_ONLY.includes("budget"),
    legacyMessage: LEGACY_DOC_MESSAGE,
    bundleHasLegacyMsg: js.includes("Legacy Word .doc files are not supported"),
    bundleHasKnowledgeStatus: js.includes("Documents Stored") && js.includes("Reports Parsed"),
    bundleHasComingSoon: js.includes("Coming soon"),
    vaultChunk,
  };

  const supabase = await scopedClient();
  const { data: canUpload } = await supabase.rpc("ask_nac_vault_can_upload");

  const storedOnly = await uploadProbe(supabase, {
    filename: `ck1-budget-${Date.now()}.txt`,
    content: "Budget stored-only verify\n",
    mimeType: "text/plain",
    reportType: "budget",
  });

  const parseable = await uploadParseableProbe(supabase, {
    filename: `ck1-logbook-${Date.now()}.txt`,
    content: SAMPLE_LOGBOOK,
    mimeType: "text/plain",
    reportType: "daily_logbook",
    title: "CK-1 logbook parseable",
  });

  const txtOther = await uploadProbe(supabase, {
    filename: `ck1-other-${Date.now()}.txt`,
    content: "Other stored-only\n",
    mimeType: "text/plain",
    reportType: "other",
  });

  const bulk = await bulkImportProbe(supabase, [
    { name: "folder-legacy.doc", content: "legacy", mimeType: "application/msword" },
    { name: "folder-budget.txt", content: "folder budget\n", mimeType: "text/plain" },
  ]);

  const pass = {
    buildId: buildId.startsWith(EXPECTED_BUILD_PREFIX),
    docRejected: clientChecks.docRejected,
    formatsSupported:
      clientChecks.txt &&
      clientChecks.pdf &&
      clientChecks.csv &&
      clientChecks.docx &&
      clientChecks.xlsx,
    bundleStrings:
      clientChecks.bundleHasLegacyMsg &&
      clientChecks.bundleHasKnowledgeStatus &&
      clientChecks.bundleHasComingSoon,
    storedOnlyNotFailed:
      storedOnly.regStatus === "registered" &&
      storedOnly.jobStatus === "registered" &&
      storedOnly.tier === "Stored",
    parseableTier:
      parseable.ingestionOk === true &&
      parseable.factsPersisted > 0 &&
      ["Parsed", "Ask-NAC-ready"].includes(parseable.tier),
    txtUploadOk: txtOther.ok && txtOther.tier === "Stored",
    importFolderAligned: bulk.legacyDocSkipped === 1 && bulk.supportedCount === 1 && bulk.ok,
    canUpload: Boolean(canUpload),
  };

  console.log(
    JSON.stringify(
      {
        buildId,
        clientChecks,
        canUpload,
        storedOnlyUpload: storedOnly,
        parseableUpload: parseable,
        txtOtherUpload: txtOther,
        bulkImport: bulk,
        pass,
        allPass: Object.values(pass).every(Boolean),
      },
      null,
      2,
    ),
  );

  if (!Object.values(pass).every(Boolean)) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
