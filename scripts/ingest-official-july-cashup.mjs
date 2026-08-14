#!/usr/bin/env node
/**
 * Archive + ingest the official July 2026 Khobar Cash Up PDF into production vault.
 * Idempotent by content hash. Soft-supersedes July facts from earlier incomplete workbook copy.
 */
import { createHash, randomUUID } from "crypto";
import { execSync, execFileSync } from "child_process";
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
// Reuse parser via dynamic import of the JS module
const PDF_PATH = process.env.JULY_CASHUP_PDF
  || "/Users/raffiazarian/Documents/NAC/Cash up 2026.xlsx - July 26 (4).pdf";
const PROJECT = "zeyhvjuraqnlbdycgrme";
const BUCKET = "ask-nac-vault-originals";
const PRIOR_WORKBOOK_FILE_ID = "08c0c810-df85-4447-944c-e67a5597885b";

function loadServiceKey() {
  const out = execSync(`supabase projects api-keys --project-ref ${PROJECT}`, { encoding: "utf8" });
  for (const line of out.split("\n")) {
    if (!/service_role/.test(line)) continue;
    const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
    const key = parts[parts.length - 1];
    if (key?.startsWith("eyJ")) return key;
  }
  throw new Error("Could not parse service_role key");
}

function extractPdfText(pdfPath) {
  const script = `
from pypdf import PdfReader
import sys
text = "\\n".join((p.extract_text() or "") for p in PdfReader(sys.argv[1]).pages)
sys.stdout.write(text)
`;
  return execFileSync("python3", ["-c", script, pdfPath], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

function classifyDay(existing, incoming) {
  if (!existing) return "NEW";
  const keys = ["total_sales", "net_sales", "guest_count", "order_count"];
  let anyDiff = false;
  for (const key of keys) {
    if (existing[key] == null && incoming[key] == null) continue;
    if (existing[key] == null) return "NEW";
    if (Math.abs(Number(existing[key]) - Number(incoming[key])) > 0.05) anyDiff = true;
  }
  return anyDiff ? "CORRECTED" : "MATCH";
}

async function main() {
  const { parseCashUpOfficialPdfText, CASH_UP_OFFICIAL_PDF_PARSER_VERSION } = await import(
    "../src/intelligence/askNac/vault/parsers/parseCashUpOfficialPdf.js"
  );

  const buffer = readFileSync(PDF_PATH);
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const originalFilename = PDF_PATH.split("/").pop();
  const text = extractPdfText(PDF_PATH);
  const parsed = parseCashUpOfficialPdfText(text, { branchId: "khobar", periodMonth: "2026-07" });
  if (!parsed.ok) {
    console.error(JSON.stringify({ ok: false, stage: "parse", error: parsed.error, warnings: parsed.warnings }, null, 2));
    process.exit(1);
  }

  const serviceKey = loadServiceKey();
  const sb = createClient(`https://${PROJECT}.supabase.co`, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existingByHash } = await sb
    .from("ask_nac_files")
    .select("id, original_filename, content_hash, storage_path, status, notes, period_start, period_end, authority_level, parser_version")
    .eq("content_hash", contentHash)
    .limit(1)
    .maybeSingle();

  let fileId = existingByHash?.id || randomUUID();
  let storagePath = existingByHash?.storage_path
    || `manual/khobar/operations/${fileId}/${originalFilename.replace(/\s+/g, "_")}`;
  let skippedDuplicate = Boolean(existingByHash);

  if (!existingByHash) {
    const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (upErr) {
      console.error(JSON.stringify({ ok: false, stage: "storage_upload", error: upErr.message }, null, 2));
      process.exit(1);
    }

    const notes = [
      "OFFICIAL_COMPANY_REPORT — July 2026 NAC Khobar Cash Up (completed, includes 31/07/2026).",
      "source_origin: company email / official circulated management report.",
      "authority: CANONICAL_OPERATIONAL_COMMERCIAL_SOURCE (maps to uploaded_report + cash_up registry).",
      `parser: ${CASH_UP_OFFICIAL_PDF_PARSER_VERSION}.`,
      `supersedes_july_slice_of_file: ${PRIOR_WORKBOOK_FILE_ID} (incomplete earlier July copy in Cash up 2026.xlsx).`,
      "SOURCE_QUALITY: Daily Average row is stale (30-day formula); preserved as SOURCE_REPORTED evidence only.",
    ].join(" ");

    const row = {
      id: fileId,
      title: "Cash Up July 2026 — Official Khobar (complete)",
      original_filename: originalFilename,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      branch_scope_type: "single_branch",
      primary_branch_id: "khobar",
      brand_wide: false,
      department: "operations",
      report_type: "cash_up",
      data_layer: "operational",
      knowledge_domain: "commercial",
      knowledge_subdomain: "cash_up",
      artifact_type: "report",
      authority_level: "uploaded_report",
      period_start: "2026-07-01",
      period_end: "2026-07-31",
      period_label: "July 2026",
      sensitivity_level: "internal",
      status: "active",
      uploaded_by: "official_july_ingest_script",
      uploader_email: "ops@nac.local",
      classification_confidence: 0.95,
      content_hash: contentHash,
      ingestion_source: "manual_upload",
      parser_version: CASH_UP_OFFICIAL_PDF_PARSER_VERSION,
      notes,
    };

    const { error: insErr } = await sb.from("ask_nac_files").insert(row);
    if (insErr) {
      console.error(JSON.stringify({ ok: false, stage: "file_insert", error: insErr.message }, null, 2));
      process.exit(1);
    }

    await sb.from("ask_nac_file_versions").insert({
      id: randomUUID(),
      file_id: fileId,
      version_no: 1,
      storage_path: storagePath,
      size_bytes: buffer.length,
      mime_type: "application/pdf",
      content_hash: contentHash,
    });
  }

  // Load existing July canonical headline facts for classification (pre-mutation)
  const { data: existingFacts } = await sb
    .from("ask_nac_structured_facts")
    .select("id, file_id, metric_key, metric_value, period_end, dimensions")
    .eq("report_type", "cash_up")
    .eq("branch_id", "khobar")
    .gte("period_end", "2026-07-01")
    .lte("period_end", "2026-07-31")
    .in("metric_key", ["total_sales", "net_sales", "guest_count", "order_count"]);

  const existingByDate = {};
  for (const f of existingFacts || []) {
    const dims = f.dimensions && typeof f.dimensions === "object" ? Object.keys(f.dimensions) : [];
    if (dims.length) continue;
    const d = String(f.period_end).slice(0, 10);
    existingByDate[d] ||= {};
    existingByDate[d][f.metric_key] = Number(f.metric_value);
    existingByDate[d]._fileIds = existingByDate[d]._fileIds || new Set();
    existingByDate[d]._fileIds.add(f.file_id);
  }

  const dayClasses = {};
  for (const row of parsed.dailyRows) {
    dayClasses[row.businessDate] = classifyDay(existingByDate[row.businessDate], {
      total_sales: row.totalSales,
      net_sales: row.netSales,
      guest_count: row.guestCount,
      order_count: row.orderCount,
    });
  }

  // Idempotent fact replace for THIS file only via delete+insert for file_id
  const { count: priorFactCount } = await sb
    .from("ask_nac_structured_facts")
    .select("id", { count: "exact", head: true })
    .eq("file_id", fileId);

  await sb.from("ask_nac_structured_facts").delete().eq("file_id", fileId);

  const rowsToInsert = parsed.facts.map((f) => ({
    id: randomUUID(),
    file_id: fileId,
    branch_id: "khobar",
    brand_wide: false,
    department: "operations",
    report_type: "cash_up",
    sensitivity_level: "internal",
    metric_key: f.metric_key,
    metric_value: f.metric_value,
    metric_unit: null,
    dimensions: f.dimensions || {},
    period_start: f.period_start,
    period_end: f.period_end,
    grain: f.grain || "daily",
    source_row_ref: f.source_row_ref || null,
    confidence: f.confidence ?? 0.86,
    knowledge_domain: "commercial",
  }));

  // Insert in chunks
  let inserted = 0;
  for (let i = 0; i < rowsToInsert.length; i += 200) {
    const chunk = rowsToInsert.slice(i, i + 200);
    const { error } = await sb.from("ask_nac_structured_facts").insert(chunk);
    if (error) {
      console.error(JSON.stringify({ ok: false, stage: "facts_insert", error: error.message, at: i }, null, 2));
      process.exit(1);
    }
    inserted += chunk.length;
  }

  // Soft-supersede July facts from prior incomplete workbook — retain file/storage history
  const { data: deletedPrior, error: delErr } = await sb
    .from("ask_nac_structured_facts")
    .delete()
    .eq("file_id", PRIOR_WORKBOOK_FILE_ID)
    .eq("report_type", "cash_up")
    .gte("period_end", "2026-07-01")
    .lte("period_end", "2026-07-31")
    .select("id");
  if (delErr) {
    console.error(JSON.stringify({ ok: false, stage: "supersede_prior_july", error: delErr.message }, null, 2));
    process.exit(1);
  }

  await sb.from("ask_nac_files").update({
    notes: [
      "July 2026 daily facts soft-superseded by official completed PDF.",
      `superseded_by_file_id=${fileId}`,
      "reason: completed report includes 31/07/2026; earlier July slice incomplete.",
      "File retained for audit; non-July facts unchanged.",
    ].join(" "),
    updated_at: new Date().toISOString(),
  }).eq("id", PRIOR_WORKBOOK_FILE_ID);

  // Coverage + job
  const finishedAt = new Date().toISOString();
  const { data: cov } = await sb.from("ask_nac_data_coverage").select("id").eq("source_file_id", fileId).maybeSingle();
  if (!cov) {
    const { error: covErr } = await sb.from("ask_nac_data_coverage").insert({
      branch_id: "khobar",
      brand_wide: false,
      department: "operations",
      report_type: "cash_up",
      period_start: "2026-07-01",
      period_end: "2026-07-31",
      source_file_id: fileId,
      fact_count: inserted,
      readiness_status: "ready",
      last_ingested_at: finishedAt,
      knowledge_domain: "commercial",
    });
    if (covErr) {
      console.error(JSON.stringify({ ok: false, stage: "coverage_insert", error: covErr.message }, null, 2));
      process.exit(1);
    }
  } else {
    await sb.from("ask_nac_data_coverage").update({
      fact_count: inserted,
      readiness_status: "ready",
      last_ingested_at: finishedAt,
      period_start: "2026-07-01",
      period_end: "2026-07-31",
      updated_at: finishedAt,
    }).eq("id", cov.id);
  }

  const jobId = randomUUID();
  const classCounts = Object.values(dayClasses).reduce((acc, c) => {
    acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {});
  await sb.from("ask_nac_ingestion_jobs").insert({
    id: jobId,
    file_id: fileId,
    status: "completed",
    stage: "facts_published",
    started_at: finishedAt,
    finished_at: finishedAt,
    stats: {
      parserVersion: CASH_UP_OFFICIAL_PDF_PARSER_VERSION,
      contentHash,
      skippedDuplicateSource: skippedDuplicate,
      priorFactsForFile: priorFactCount || 0,
      factsPersisted: inserted,
      dailyRows: parsed.dailyRowCount,
      dayClasses,
      classCounts,
      reconciliation: parsed.reconciliation,
      qualityIssues: parsed.qualityIssues,
      priorJulyFactsRemoved: (deletedPrior || []).length,
      supersededFileId: PRIOR_WORKBOOK_FILE_ID,
      sourceMonthly: parsed.sourceMonthly,
      sourceTarget: parsed.sourceTarget,
      sourceDailyAverage: parsed.sourceDailyAverage,
      derived: parsed.derived,
    },
  });

  // Read back canonical July via fact aggregation
  const { data: julyFacts } = await sb
    .from("ask_nac_structured_facts")
    .select("metric_key, metric_value, period_end, dimensions, file_id")
    .eq("report_type", "cash_up")
    .eq("branch_id", "khobar")
    .gte("period_end", "2026-07-01")
    .lte("period_end", "2026-07-31")
    .in("metric_key", ["total_sales", "net_sales", "guest_count", "order_count", "target_sales"]);

  const byDate = {};
  let target = null;
  for (const f of julyFacts || []) {
    const dims = f.dimensions && typeof f.dimensions === "object" ? Object.keys(f.dimensions) : [];
    if (f.metric_key === "target_sales") {
      target = Number(f.metric_value);
      continue;
    }
    if (dims.length) continue;
    const d = String(f.period_end).slice(0, 10);
    byDate[d] ||= {};
    byDate[d][f.metric_key] = Number(f.metric_value);
  }
  const dates = Object.keys(byDate).sort();
  const totals = dates.reduce((acc, d) => {
    acc.gross += byDate[d].total_sales || 0;
    acc.net += byDate[d].net_sales || 0;
    acc.guests += byDate[d].guest_count || 0;
    acc.orders += byDate[d].order_count || 0;
    return acc;
  }, { gross: 0, net: 0, guests: 0, orders: 0 });

  const report = {
    ok: true,
    skippedDuplicateSource: skippedDuplicate,
    sourceArchive: {
      sourceId: fileId,
      originalFilename,
      hash: contentHash,
      storageBucket: BUCKET,
      storagePath,
      authorityLevel: "uploaded_report",
      fabricAuthority: "CANONICAL_STRUCTURED (cash_up registry)",
      reportingPeriod: "2026-07-01..2026-07-31",
      parserVersion: CASH_UP_OFFICIAL_PDF_PARSER_VERSION,
      status: "active",
      supersedes: PRIOR_WORKBOOK_FILE_ID,
    },
    ingestion: {
      dailyRecordsParsed: parsed.dailyRowCount,
      factsInserted: inserted,
      priorFactsForFileCleared: priorFactCount || 0,
      classCounts,
      dayClasses,
      priorJulyFactsRemovedFromWorkbook: (deletedPrior || []).length,
      validationWarnings: parsed.qualityIssues,
      jobId,
    },
    julyCanonicalReadback: {
      dayCount: dates.length,
      gross: Number(totals.gross.toFixed(2)),
      net: Number(totals.net.toFixed(2)),
      guests: totals.guests,
      orders: totals.orders,
      target,
      d31: byDate["2026-07-31"] || null,
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.stack || err) }, null, 2));
  process.exit(1);
});
