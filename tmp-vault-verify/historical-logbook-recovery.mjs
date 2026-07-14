/**
 * Historical logbook recovery — audit, categorize, replay (idempotent).
 * Usage:
 *   node tmp-vault-verify/historical-logbook-recovery.mjs audit
 *   node tmp-vault-verify/historical-logbook-recovery.mjs replay --months 2026-03,2026-04,2026-05
 *   node tmp-vault-verify/historical-logbook-recovery.mjs verify
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (k) => fs.readFileSync(`${REPO}/.env.local`, "utf8").match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();
const url = read("REACT_APP_SUPABASE_URL");
const anon = read("REACT_APP_SUPABASE_ANON_KEY");
const ref = url.match(/https:\/\/([^.]+)/)[1];
const sk = JSON.parse(execSync(`supabase projects api-keys --project-ref ${ref} -o json`, { encoding: "utf8", cwd: REPO }))
  .find((k) => k.name === "service_role").api_key;

const admin = createClient(url, sk, { auth: { autoRefreshToken: false, persistSession: false } });
const BRANCH = "khobar";
const REPORT_TYPE = "daily_logbook";
const MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06"];

async function loadReplaceModule() {
  const { replaceStructuredFactsForFile } = await import(
    `file://${path.join(REPO, "src/intelligence/askNac/vault/vaultStructuredFactsReplace.js")}`
  );
  return { replaceStructuredFactsForFile };
}

const PARSE_WORKER_TEST = "historicalLogbookRecovery.integration";
const BATCH_INPUT = path.join(REPO, "tmp-vault-verify", ".recovery-batch-input.json");
const BATCH_OUTPUT = path.join(REPO, "tmp-vault-verify", ".recovery-batch-output.json");

async function parseVaultBatchViaJest(items) {
  fs.writeFileSync(BATCH_INPUT, JSON.stringify({ items }));
  if (fs.existsSync(BATCH_OUTPUT)) fs.unlinkSync(BATCH_OUTPUT);

  execSync(
    `npm test -- --watchAll=false --runInBand --testPathPattern=${PARSE_WORKER_TEST} -t "parse vault file for recovery"`,
    {
      cwd: REPO,
      env: {
        ...process.env,
        RECOVERY_PARSE: "1",
        RECOVERY_BATCH_INPUT: BATCH_INPUT,
        RECOVERY_BATCH_OUTPUT: BATCH_OUTPUT,
        CI: "true",
      },
      stdio: "pipe",
      encoding: "utf8",
    },
  );

  if (!fs.existsSync(BATCH_OUTPUT)) {
    throw new Error("Batch parse worker produced no output");
  }
  return JSON.parse(fs.readFileSync(BATCH_OUTPUT, "utf8")).results || {};
}

async function loadIngestionModules() {
  const replaceMod = await loadReplaceModule();
  return {
    VAULT_PARSER_VERSION: "vault-prototype-v2",
    replaceStructuredFactsForFile: replaceMod.replaceStructuredFactsForFile,
  };
}

function monthRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const start = `${ym}-01`;
  const end = new Date(y, m, 0).toISOString().slice(0, 10);
  return { start, end };
}

function monthFromFilename(filename, referenceDate = new Date("2026-06-01")) {
  const value = String(filename || "");
  const monthToken =
    "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const monthMap = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
    september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  const dayMonth = value.match(new RegExp(`\\b(\\d{1,2})\\s+${monthToken}(?:\\s+(20\\d{2}))?\\b`, "i"));
  if (dayMonth) {
    const month = monthMap[dayMonth[2].toLowerCase()];
    const year = dayMonth[3] ? Number(dayMonth[3]) : referenceDate.getFullYear();
    return `${year}-${String(month).padStart(2, "0")}`;
  }
  const monthDay = value.match(new RegExp(`\\b${monthToken}\\s+(\\d{1,2})(?:\\s+(20\\d{2}))?\\b`, "i"));
  if (monthDay) {
    const month = monthMap[monthDay[1].toLowerCase()];
    const year = monthDay[3] ? Number(monthDay[3]) : referenceDate.getFullYear();
    return `${year}-${String(month).padStart(2, "0")}`;
  }
  return null;
}

function resolveCoverageMonth(row) {
  if (row.period_start) return row.period_start.slice(0, 7);
  return monthFromFilename(row.source_file?.original_filename);
}

let coverageCache = null;

async function fetchAllLogbookCoverage() {
  if (coverageCache) return coverageCache;
  const { data, error } = await admin
    .from("ask_nac_data_coverage")
    .select(`
      id,branch_id,report_type,period_start,period_end,fact_count,readiness_status,last_ingested_at,source_file_id,
      source_file:ask_nac_files(
        id,title,original_filename,storage_bucket,storage_path,report_type,parser_version,
        classification_confidence,period_start,period_end,status,primary_branch_id,brand_wide,department,sensitivity_level
      )
    `)
    .eq("branch_id", BRANCH)
    .eq("report_type", REPORT_TYPE)
    .order("last_ingested_at", { ascending: true });
  if (error) throw new Error(error.message);
  coverageCache = (data || []).map((row) => ({ ...row, bucketMonth: resolveCoverageMonth(row) }));
  return coverageCache;
}

async function fetchCoverageForMonth(ym) {
  const rows = await fetchAllLogbookCoverage();
  return rows.filter((row) => row.bucketMonth === ym);
}

async function fetchFactsForFile(fileId) {
  const { data, error } = await admin
    .from("ask_nac_structured_facts")
    .select("metric_key,metric_value,grain,dimensions,period_start,period_end,confidence")
    .eq("file_id", fileId)
    .order("metric_key");
  if (error) throw new Error(error.message);
  return data || [];
}

async function fetchLatestJob(fileId) {
  const { data, error } = await admin
    .from("ask_nac_ingestion_jobs")
    .select("id,status,stage,stats,error,finished_at")
    .eq("file_id", fileId)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function categorizeAudit(row, facts, job) {
  const keys = new Set(facts.map((f) => f.metric_key));
  const onlyRaw = keys.size === 1 && keys.has("raw_extract_line");
  const missingPeriod = !row.period_start && !facts.some((f) => f.period_start);
  const lowFacts = facts.length < 3;
  const textFacts = facts.filter((f) => f.dimensions?.text_value).length;
  const ext = String(row.source_file?.original_filename || "").split(".").pop()?.toLowerCase() || "";
  const isDocx = ext.includes("docx") || String(row.source_file?.original_filename || "").includes("docx");
  const duplicateHint = false;
  const parser = job?.stats?.parser || row.source_file?.parser_version || "unknown";
  const confidenceLevel = job?.stats?.confidenceLevel || null;
  const publish = job?.stats?.publish;

  let gap = "unknown";
  if (onlyRaw) gap = "raw_extract_line only";
  else if (missingPeriod) gap = "missing dates";
  else if (isDocx) gap = "DOCX extraction";
  else if (lowFacts) gap = "low fact count";
  else if (confidenceLevel === "medium" || row.readiness_status === "partial") gap = "medium confidence (not high)";
  else if (row.readiness_status === "missing") gap = "missing coverage";
  else gap = "parser mismatch or stale";

  const feasibility = onlyRaw || missingPeriod
    ? "high — reparse may add structure"
    : row.readiness_status === "partial" && facts.length >= 3
      ? "high — reparse + confidence boost"
      : row.readiness_status === "missing"
        ? "medium — file may need re-upload"
        : "medium";

  return {
    gap,
    feasibility,
    factCount: facts.length,
    textFactCount: textFacts,
    metricKeys: [...keys].slice(0, 12),
    missingPeriod,
    onlyRaw,
    isDocx,
    parser,
    confidenceLevel,
    publish,
    jobStage: job?.stage || null,
  };
}

function summarizeMonth(rows) {
  const counts = { ready: 0, partial: 0, missing: 0, registered: 0, stale: 0 };
  for (const r of rows) {
    const s = r.readiness_status || "registered";
    counts[s] = (counts[s] || 0) + 1;
  }
  return { total: rows.length, ...counts };
}

async function auditMonths(months = MONTHS) {
  const report = { auditedAt: new Date().toISOString(), branch: BRANCH, months: {}, leaderboard: [] };

  for (const ym of months) {
    const rows = await fetchCoverageForMonth(ym);
    report.months[ym] = { summary: summarizeMonth(rows), files: [] };

    for (const row of rows) {
      const file = row.source_file;
      if (!file?.id) continue;
      const facts = await fetchFactsForFile(file.id);
      const job = await fetchLatestJob(file.id);
      const cat = categorizeAudit(row, facts, job);
      const entry = {
        fileId: file.id,
        filename: file.original_filename,
        periodStart: row.period_start,
        readiness: row.readiness_status,
        factCount: row.fact_count,
        ...cat,
      };
      report.months[ym].files.push(entry);
      if (row.readiness_status === "partial" || row.readiness_status === "missing") {
        report.leaderboard.push({
          month: ym,
          periodStart: row.period_start,
          filename: file.original_filename,
          readiness: row.readiness_status,
          gap: cat.gap,
          feasibility: cat.feasibility,
          factCount: cat.factCount,
          confidenceLevel: cat.confidenceLevel,
        });
      }
    }
  }

  report.leaderboard.sort((a, b) => {
    const score = (r) => (r.feasibility.startsWith("high") ? 2 : 1) + (r.factCount || 0) / 20;
    return score(b) - score(a);
  });

  return report;
}

async function downloadFileBlob(file) {
  const bucket = file.storage_bucket || "ask-nac-vault";
  const pathKey = file.storage_path;
  if (!pathKey) throw new Error("missing storage_path");
  const { data, error } = await admin.storage.from(bucket).download(pathKey);
  if (error) throw new Error(error.message);
  return data;
}

function readinessFromParse(parseResult) {
  if (!parseResult.publish) return "partial";
  return parseResult.confidenceMeta?.level === "high" ? "ready" : "partial";
}

function buildReplayContext(file) {
  return {
    fileId: file.id,
    branchId: file.primary_branch_id || BRANCH,
    brandWide: file.brand_wide,
    department: file.department || "operations",
    reportType: file.report_type,
    sensitivityLevel: file.sensitivity_level,
    periodStart: file.period_start,
    periodEnd: file.period_end,
    createdBy: "recovery@nac.local",
    originalFilename: file.original_filename,
    filename: file.original_filename,
  };
}

async function applyParseResult(file, coverage, ingestion, parseResult) {
  const { VAULT_PARSER_VERSION, replaceStructuredFactsForFile } = ingestion;
  if (!parseResult?.ok || !parseResult.publish || !(parseResult.publishedFacts?.length)) {
    return {
      ok: false,
      fileId: file.id,
      before: coverage.readiness_status,
      error: parseResult?.error || "No publishable facts",
      confidence: parseResult?.confidence,
      confidenceLevel: parseResult?.confidenceMeta?.level,
      factCount: parseResult?.publishedFacts?.length || 0,
    };
  }

  const rows = parseResult.publishedFacts.map((r) => ({
    ...r,
    file_id: file.id,
  }));

  const replaced = await replaceStructuredFactsForFile(admin, {
    fileId: file.id,
    rows,
    periodStart: parseResult.periodStart || file.period_start,
    periodEnd: parseResult.periodEnd || file.period_end,
    minInserted: rows.length,
  });

  const readiness = readinessFromParse(parseResult);
  const finishedAt = new Date().toISOString();
  await admin
    .from("ask_nac_data_coverage")
    .update({
      fact_count: replaced.inserted,
      readiness_status: readiness,
      last_ingested_at: finishedAt,
      period_start: parseResult.periodStart || coverage.period_start,
      period_end: parseResult.periodEnd || coverage.period_end,
      updated_at: finishedAt,
    })
    .eq("source_file_id", file.id);

  await admin
    .from("ask_nac_files")
    .update({
      classification_confidence: parseResult.confidence,
      parser_version: VAULT_PARSER_VERSION,
      period_start: parseResult.periodStart || file.period_start,
      period_end: parseResult.periodEnd || file.period_end,
      updated_at: finishedAt,
    })
    .eq("id", file.id);

  return {
    ok: true,
    fileId: file.id,
    filename: file.original_filename,
    before: coverage.readiness_status,
    after: readiness,
    inserted: replaced.inserted,
    deleted: replaced.deleted,
    confidence: parseResult.confidence,
    confidenceLevel: parseResult.confidenceMeta?.level,
    periodStart: parseResult.periodStart,
  };
}

async function replayMonths(months, { limit = 200, onlyPartial = true, batchSize = 20 } = {}) {
  const ingestion = await loadIngestionModules();
  coverageCache = null;
  const before = {};
  const results = [];
  const targets = [];

  for (const ym of months) {
    const rows = await fetchCoverageForMonth(ym);
    before[ym] = summarizeMonth(rows);
    for (const row of rows) {
      if (onlyPartial && row.readiness_status !== "partial" && row.readiness_status !== "missing") continue;
      const file = row.source_file;
      if (!file?.id || file.status !== "active") continue;
      targets.push({ ym, row, file });
    }
  }

  for (let offset = 0; offset < targets.length && results.length < limit; offset += batchSize) {
    const chunk = targets.slice(offset, offset + batchSize);
    const items = [];
    for (const target of chunk) {
      const blob = await downloadFileBlob(target.file);
      const buffer = await blob.arrayBuffer();
      items.push({
        fileId: target.file.id,
        bufferB64: Buffer.from(buffer).toString("base64"),
        mimeType: blob.type || "application/octet-stream",
        context: buildReplayContext(target.file),
      });
    }

    const parseResults = await parseVaultBatchViaJest(items);
    for (const target of chunk) {
      try {
        const parseResult = parseResults[target.file.id];
        const result = await applyParseResult(target.file, target.row, ingestion, parseResult);
        results.push({ month: target.ym, ...result });
      } catch (err) {
        results.push({
          month: target.ym,
          ok: false,
          fileId: target.file.id,
          filename: target.file.original_filename,
          before: target.row.readiness_status,
          error: err.message,
        });
      }
    }
  }

  coverageCache = null;
  const after = {};
  for (const ym of months) {
    after[ym] = summarizeMonth(await fetchCoverageForMonth(ym));
  }

  return { before, after, results };
}

async function getToken() {
  const user = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: link } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: "raffiazarian2@gmail.com",
    options: { redirectTo: "https://nac-os.netlify.app" },
  });
  const { data: sess } = await user.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  return sess.session.access_token;
}

async function askExecutive(token, question) {
  const res = await fetch(`${url}/functions/v1/ask-nac`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", apikey: anon },
    body: JSON.stringify({ question, branch: BRANCH, filters: { branch: BRANCH } }),
  });
  return res.json();
}

function scoreExecutive(body) {
  return {
    intent: body.intent,
    confidence: body.confidence,
    evidenceCount: (body.insights?.length || 0) + (body.keyMetrics?.length || 0),
    sourceCount: (body.sources?.length || 0) + (body.vaultSources?.length || 0),
    title: body.title,
    directAnswerPreview: String(body.directAnswer || "").slice(0, 200),
    narrationSkipped: body.responseMeta?.narrationSkipped,
  };
}

async function verifyExecutive() {
  const token = await getToken();
  const questions = [
    "Summarize March operations",
    "Summarize April operations",
    "What were the biggest recurring issues in May?",
    "Compare April vs May operational themes",
  ];
  const out = {};
  for (const q of questions) {
    const body = await askExecutive(token, q);
    out[q] = scoreExecutive(body);
  }
  return out;
}

async function main() {
  const mode = process.argv[2] || "audit";
  const outDir = path.join(REPO, "tmp-vault-verify");
  fs.mkdirSync(outDir, { recursive: true });

  if (mode === "audit") {
    const report = await auditMonths(MONTHS);
    const outPath = path.join(outDir, "historical-logbook-audit.json");
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      outPath,
      summaries: Object.fromEntries(Object.entries(report.months).map(([m, v]) => [m, v.summary])),
      partialLeaderboardTop10: report.leaderboard.slice(0, 10),
    }, null, 2));
    return;
  }

  if (mode === "replay") {
    const monthsArg = process.argv.find((a) => a.startsWith("--months="))?.split("=")[1];
    const months = monthsArg ? monthsArg.split(",") : ["2026-03", "2026-04", "2026-05"];
    const snapshot = await replayMonths(months);
    const outPath = path.join(outDir, "historical-logbook-replay.json");
    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
    const improved = snapshot.results.filter((r) => r.ok && r.before !== r.after && r.after === "ready").length;
    console.log(JSON.stringify({ outPath, before: snapshot.before, after: snapshot.after, improved, failed: snapshot.results.filter((r) => !r.ok).length }, null, 2));
    return;
  }

  if (mode === "verify") {
    const exec = await verifyExecutive();
    const outPath = path.join(outDir, "historical-logbook-executive-verify.json");
    fs.writeFileSync(outPath, JSON.stringify(exec, null, 2));
    console.log(JSON.stringify({ outPath, exec }, null, 2));
    return;
  }

  throw new Error(`Unknown mode: ${mode}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
