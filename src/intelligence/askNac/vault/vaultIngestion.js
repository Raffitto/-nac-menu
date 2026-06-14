import {
  buildRawExtractFacts,
  explainConfidence,
  VAULT_PARSER_VERSION,
} from "./parsers/vaultParseUtils";
import { parseUploadedFile } from "./parsers/vaultFileAdapter";
import { sampleFactsForPreview } from "./parsers/vaultIntermediate";
import { parseCashUpReport } from "./parsers/parseCashUp";
import { parseReceptionDailyReport } from "./parsers/parseReceptionDaily";
import { parseDailyLogbookReport } from "./parsers/parseDailyLogbook";
import { parseCcmReconciliationReport } from "./parsers/parseCcmReconciliation";
import { parseWeeklySalesReport } from "./parsers/parseWeeklySales";
import { parsePnlReport } from "./parsers/parsePnl";
import { rebuildKnowledgeGraphForBranch } from "./knowledgeGraph";
import { rebuildTimelineForFile } from "./vaultOperationalTimeline";
import { PARSEABLE_REPORT_TYPES } from "./vaultConstants";

export { PARSEABLE_REPORT_TYPES };

export function routeVaultParser(reportType) {
  switch (reportType) {
    case "cash_up":
      return parseCashUpReport;
    case "reception_daily_report":
      return parseReceptionDailyReport;
    case "daily_logbook":
      return parseDailyLogbookReport;
    case "ccm_reconciliation":
      return parseCcmReconciliationReport;
    case "weekly_sales_overview":
      return parseWeeklySalesReport;
    case "pnl":
      return parsePnlReport;
    default:
      return null;
  }
}

export function buildParsePreview(intermediate, parseResult, context) {
  const confidenceMeta =
    parseResult.confidenceMeta ||
    explainConfidence(parseResult.confidence || 0, {
      warnings: parseResult.warnings || [],
    });

  return {
    detectedFileType: intermediate?.fileType || null,
    detectedExtension: intermediate?.extension || null,
    mimeType: intermediate?.mimeType || null,
    reportType: context.reportType,
    sections: parseResult.sections || (intermediate?.sections || []).map((s) => s.label),
    sampleFacts: sampleFactsForPreview(parseResult.facts),
    warnings: [
      ...(intermediate?.adapterWarnings || []),
      ...(parseResult.warnings || []),
    ],
    confidence: parseResult.confidence,
    confidenceLevel: confidenceMeta.level,
    confidenceExplanation: confidenceMeta.explanation,
    needsMapping: confidenceMeta.needsMapping,
    publish: confidenceMeta.publish,
  };
}

export async function parseVaultStructuredFile(file, context) {
  const parser = routeVaultParser(context.reportType);
  if (!parser) {
    return {
      ok: false,
      confidence: 0,
      facts: [],
      publishedFacts: [],
      preview: null,
      stats: { parser: null },
      error: `No parser for report type "${context.reportType}".`,
    };
  }

  const extracted = await parseUploadedFile(file, { reportType: context.reportType });
  if (!extracted.ok || !extracted.intermediate) {
    return {
      ok: false,
      confidence: 0,
      facts: [],
      publishedFacts: [],
      preview: null,
      stats: { parser: context.reportType },
      error: extracted.error || "File extraction failed.",
    };
  }

  const result = parser(extracted.intermediate, context);
  const preview = buildParsePreview(extracted.intermediate, result, context);
  const confidenceMeta =
    result.confidenceMeta ||
    explainConfidence(result.confidence || 0, { warnings: result.warnings || [] });

  if (!result.ok) {
    return {
      ...result,
      facts: result.facts || [],
      publishedFacts: [],
      publish: false,
      preview,
      parserVersion: VAULT_PARSER_VERSION,
      confidenceMeta,
    };
  }

  const factContext = {
    fileId: context.fileId,
    branchId: result.branchId || context.branchId,
    brandWide: context.brandWide,
    department: context.department,
    reportType: context.reportType,
    sensitivityLevel: context.sensitivityLevel,
    periodStart: result.periodStart || context.periodStart,
    periodEnd: result.periodEnd || context.periodEnd,
    createdBy: context.createdBy,
    confidence: result.confidence,
  };

  if (confidenceMeta.publish) {
    return {
      ...result,
      publishedFacts: result.facts || [],
      publish: true,
      preview,
      parserVersion: VAULT_PARSER_VERSION,
      confidenceMeta,
    };
  }

  return {
    ...result,
    publishedFacts: buildRawExtractFacts(extracted.intermediate, factContext),
    publish: false,
    preview,
    parserVersion: VAULT_PARSER_VERSION,
    confidenceMeta,
  };
}

/**
 * Client-side ingestion worker (post-upload). Writes facts + job status via Supabase RLS.
 */
export async function runVaultIngestion(supabase, { file, fileRecord, jobId, email }) {
  if (!supabase || !fileRecord?.id) {
    return { ok: false, error: "Missing registry context for ingestion." };
  }

  const context = {
    fileId: fileRecord.id,
    branchId: fileRecord.primary_branch_id,
    brandWide: fileRecord.brand_wide,
    department: fileRecord.department,
    reportType: fileRecord.report_type,
    sensitivityLevel: fileRecord.sensitivity_level,
    periodStart: fileRecord.period_start,
    periodEnd: fileRecord.period_end,
    createdBy: email,
  };

  const startedAt = new Date().toISOString();

  await supabase
    .from("ask_nac_ingestion_jobs")
    .update({ status: "processing", stage: "extract", started_at: startedAt })
    .eq("id", jobId);

  let parseResult;
  try {
    parseResult = await parseVaultStructuredFile(file, context);
  } catch (err) {
    const message = err?.message || "Parse failed";
    await supabase
      .from("ask_nac_ingestion_jobs")
      .update({
        status: "failed",
        stage: "parse",
        error: message,
        finished_at: new Date().toISOString(),
        stats: { parser: context.reportType, error: message },
      })
      .eq("id", jobId);
    return { ok: false, error: message, status: "failed" };
  }

  if (!parseResult.ok) {
    await supabase
      .from("ask_nac_ingestion_jobs")
      .update({
        status: "failed",
        stage: "parse",
        error: parseResult.error,
        finished_at: new Date().toISOString(),
        stats: {
          ...parseResult.stats,
          confidence: parseResult.confidence,
          preview: parseResult.preview,
          publish: false,
        },
      })
      .eq("id", jobId);

    await supabase
      .from("ask_nac_files")
      .update({
        classification_confidence: parseResult.confidence,
        parser_version: VAULT_PARSER_VERSION,
        updated_at: new Date().toISOString(),
      })
      .eq("id", fileRecord.id);

    return {
      ok: false,
      error: parseResult.error,
      status: "failed",
      confidence: parseResult.confidence,
      preview: parseResult.preview,
    };
  }

  const rowsToInsert = parseResult.publishedFacts || [];
  let insertedCount = 0;
  let insertedFacts = [];

  if (rowsToInsert.length > 0) {
    const { data, error } = await supabase.from("ask_nac_structured_facts").insert(rowsToInsert).select("id");
    if (error) {
      await supabase
        .from("ask_nac_ingestion_jobs")
        .update({
          status: "failed",
          stage: "persist",
          error: error.message,
          finished_at: new Date().toISOString(),
          stats: { ...parseResult.stats, confidence: parseResult.confidence, preview: parseResult.preview },
        })
        .eq("id", jobId);
      return { ok: false, error: error.message, status: "failed" };
    }
    insertedCount = data?.length || rowsToInsert.length;
    insertedFacts = (data || []).map((row, idx) => ({
      ...rowsToInsert[idx],
      id: row.id,
      file_id: fileRecord.id,
      branch_id: rowsToInsert[idx].branch_id || fileRecord.primary_branch_id,
    }));
  }

  const confidenceMeta = parseResult.confidenceMeta;
  const readiness = parseResult.publish
    ? confidenceMeta?.level === "high"
      ? "ready"
      : "partial"
    : "partial";
  const finishedAt = new Date().toISOString();

  await supabase
    .from("ask_nac_data_coverage")
    .update({
      fact_count: insertedCount,
      readiness_status: readiness,
      last_ingested_at: finishedAt,
      period_start: parseResult.periodStart || fileRecord.period_start,
      period_end: parseResult.periodEnd || fileRecord.period_end,
      updated_at: finishedAt,
    })
    .eq("source_file_id", fileRecord.id);

  await supabase
    .from("ask_nac_files")
    .update({
      classification_confidence: parseResult.confidence,
      parser_version: VAULT_PARSER_VERSION,
      period_start: parseResult.periodStart || fileRecord.period_start,
      period_end: parseResult.periodEnd || fileRecord.period_end,
      updated_at: finishedAt,
    })
    .eq("id", fileRecord.id);

  const jobStats = {
    ...parseResult.stats,
    confidence: parseResult.confidence,
    confidenceLevel: confidenceMeta?.level,
    confidenceExplanation: confidenceMeta?.explanation,
    publish: parseResult.publish,
    needsMapping: confidenceMeta?.needsMapping,
    factsExtracted: parseResult.facts?.length || 0,
    factsPersisted: insertedCount,
    preview: parseResult.preview,
    parserVersion: VAULT_PARSER_VERSION,
  };

  const stage = parseResult.publish
    ? confidenceMeta?.level === "medium"
      ? "facts_published_with_warnings"
      : "facts_published"
    : "raw_extract_only";

  await supabase
    .from("ask_nac_ingestion_jobs")
    .update({
      status: "completed",
      stage,
      finished_at: finishedAt,
      stats: jobStats,
      error: parseResult.publish
        ? confidenceMeta?.level === "medium"
          ? "Medium confidence — review recommended."
          : null
        : "Low confidence — raw extract saved. Needs mapping/review.",
    })
    .eq("id", jobId);

  if (insertedFacts.length > 0) {
    await rebuildTimelineForFile(supabase, {
      fileRecord,
      facts: insertedFacts,
    }).catch(() => null);
  }

  if (fileRecord.primary_branch_id) {
    await rebuildKnowledgeGraphForBranch(supabase, {
      branchId: fileRecord.primary_branch_id,
    }).catch(() => null);
  }

  return {
    ok: true,
    status: "completed",
    confidence: parseResult.confidence,
    confidenceLevel: confidenceMeta?.level,
    publish: parseResult.publish,
    needsMapping: confidenceMeta?.needsMapping,
    factsExtracted: parseResult.facts?.length || 0,
    factsPersisted: insertedCount,
    preview: parseResult.preview,
    stats: jobStats,
    warning: parseResult.publish
      ? confidenceMeta?.level === "medium"
        ? "Facts saved with review warnings."
        : null
      : "Needs mapping/review — raw extract saved only.",
  };
}
