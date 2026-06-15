/**
 * Ask NAC Data Vault read-only query tools (ask_nac_structured_facts + ask_nac_data_coverage).
 * RLS enforces role/branch/sensitivity — never bypass client-side.
 */

import { resolveRbacQueryBranch } from "../../../lib/rbacQueryScope";
import { branchDisplayName } from "../../../dashboard/utils/rangeState";

const FACT_SELECT =
  "id,file_id,branch_id,brand_wide,department,report_type,sensitivity_level,metric_key,metric_value,metric_unit,dimensions,period_start,period_end,grain,confidence,created_at,file:ask_nac_files(id,title,original_filename,classification_confidence,parser_version,sensitivity_level)";

const COVERAGE_SELECT =
  "id,branch_id,brand_wide,department,report_type,period_start,period_end,fact_count,readiness_status,last_ingested_at,source_file_id,source_file:ask_nac_files(id,title,original_filename,report_type,classification_confidence,parser_version,sensitivity_level)";

const CHUNK_SELECT =
  "id,file_id,chunk_index,chunk_text,page_no,section_label,branch_id,department,report_type,file:ask_nac_files(id,title,original_filename,report_type,sensitivity_level)";

function resolveBranch(context) {
  return resolveRbacQueryBranch(context.profile, context.branchMention || context.filters?.branch);
}

function periodOverlapFilter(query, startDate, endDate) {
  if (!startDate || !endDate) return query;
  return query.lte("period_start", endDate).gte("period_end", startDate);
}

export function mapVaultFactRow(row) {
  const file = row?.file || null;
  return {
    id: row.id,
    fileId: row.file_id,
    branchId: row.branch_id,
    department: row.department,
    reportType: row.report_type,
    metricKey: row.metric_key,
    metricValue: row.metric_value,
    metricUnit: row.metric_unit,
    dimensions: row.dimensions || {},
    periodStart: row.period_start,
    periodEnd: row.period_end,
    grain: row.grain,
    confidence: row.confidence,
    fileTitle: file?.title || file?.original_filename || null,
    fileConfidence: file?.classification_confidence,
    parserVersion: file?.parser_version,
    sensitivity: row.sensitivity_level,
  };
}

export function mapVaultCoverageRow(row) {
  const file = row?.source_file || null;
  return {
    id: row.id,
    branchId: row.branch_id,
    department: row.department,
    reportType: row.report_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    factCount: row.fact_count,
    readinessStatus: row.readiness_status,
    lastIngestedAt: row.last_ingested_at,
    sourceFileId: row.source_file_id,
    fileTitle: file?.title || file?.original_filename || null,
    fileConfidence: file?.classification_confidence,
    parserVersion: file?.parser_version,
  };
}

export function collectVaultSources(facts = [], coverage = []) {
  const map = new Map();
  for (const fact of facts) {
    if (!fact.fileId || !fact.fileTitle) continue;
    map.set(fact.fileId, {
      fileId: fact.fileId,
      title: fact.fileTitle,
      reportType: fact.reportType,
      confidence: fact.fileConfidence,
      parserVersion: fact.parserVersion,
    });
  }
  for (const row of coverage) {
    if (!row.sourceFileId || !row.fileTitle) continue;
    map.set(row.sourceFileId, {
      fileId: row.sourceFileId,
      title: row.fileTitle,
      reportType: row.reportType,
      confidence: row.fileConfidence,
      parserVersion: row.parserVersion,
      readinessStatus: row.readinessStatus,
    });
  }
  return [...map.values()];
}

export async function getVaultFacts(
  supabase,
  { branch, startDate, endDate, reportType, metricKeys, profile, branchMention, filters } = {},
) {
  const scopedBranch = branch ?? resolveBranch({ profile, branchMention, filters });
  let query = supabase.from("ask_nac_structured_facts").select(FACT_SELECT);
  query = periodOverlapFilter(query, startDate, endDate);
  if (scopedBranch) query = query.eq("branch_id", scopedBranch);
  if (reportType) query = query.eq("report_type", reportType);
  if (metricKeys?.length) query = query.in("metric_key", metricKeys);
  query = query.neq("metric_key", "raw_extract").order("metric_key");

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const facts = (data || []).map(mapVaultFactRow);
  return {
    branch: scopedBranch,
    branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
    startDate,
    endDate,
    facts,
    sources: [{ name: "ask_nac_structured_facts", detail: "RLS-filtered vault facts" }],
  };
}

export async function getVaultCoverage(
  supabase,
  { branch, startDate, endDate, reportType, profile, branchMention, filters } = {},
) {
  const scopedBranch = branch ?? resolveBranch({ profile, branchMention, filters });
  let query = supabase.from("ask_nac_data_coverage").select(COVERAGE_SELECT);
  query = periodOverlapFilter(query, startDate, endDate);
  if (scopedBranch) query = query.eq("branch_id", scopedBranch);
  if (reportType) query = query.eq("report_type", reportType);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data || []).map(mapVaultCoverageRow);
  return {
    branch: scopedBranch,
    branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
    startDate,
    endDate,
    coverage: rows,
    sources: [{ name: "ask_nac_data_coverage", detail: "RLS-filtered coverage registry" }],
  };
}

export async function probeVaultCoverage(
  supabase,
  { branch, startDate, endDate, reportTypes = [], profile, branchMention, filters } = {},
) {
  const result = await getVaultCoverage(supabase, {
    branch,
    startDate,
    endDate,
    profile,
    branchMention,
    filters,
  });
  const coverage = result.coverage || [];
  const byType = new Map(coverage.map((row) => [row.reportType, row]));
  const missingTypes = (reportTypes || []).filter((t) => !byType.has(t));
  const partialTypes = coverage
    .filter((row) => row.readinessStatus === "partial" || row.readinessStatus === "registered")
    .map((row) => row.reportType);
  const lowConfidence = coverage.filter(
    (row) => row.fileConfidence != null && row.fileConfidence < 0.55,
  );

  return {
    ...result,
    hasAny: coverage.length > 0,
    missingTypes,
    partialTypes: [...new Set(partialTypes)],
    lowConfidenceFiles: lowConfidence,
  };
}

export async function getVaultReportSources(supabase, context = {}) {
  const { startDate, endDate } = context.vaultPeriod || {};
  const coverageResult = await getVaultCoverage(supabase, {
    ...context,
    startDate,
    endDate,
  });
  const vaultSources = collectVaultSources([], coverageResult.coverage);
  return {
    ...coverageResult,
    vaultSources,
    periodLabel: context.vaultPeriod?.label || `${startDate} – ${endDate}`,
  };
}

export async function getVaultDaySummary(supabase, context = {}) {
  const { startDate, endDate } = context.vaultPeriod || {};
  const branch = resolveBranch(context);
  const factsResult = await getVaultFacts(supabase, {
    ...context,
    branch,
    startDate,
    endDate,
  });
  const coverageResult = await getVaultCoverage(supabase, {
    ...context,
    branch,
    startDate,
    endDate,
  });

  const facts = factsResult.facts || [];
  const byReport = groupFactsByReportType(facts);
  const vaultSources = collectVaultSources(facts, coverageResult.coverage);

  return {
    branch,
    branchLabel: factsResult.branchLabel,
    startDate,
    endDate,
    periodLabel: context.vaultPeriod?.label || startDate,
    facts,
    byReport,
    coverage: coverageResult.coverage,
    vaultSources,
    warnings: buildVaultWarnings(coverageResult.coverage, facts),
    sources: [
      { name: "ask_nac_structured_facts", detail: "day summary facts" },
      { name: "ask_nac_data_coverage", detail: "coverage registry" },
    ],
  };
}

export async function getVaultManagementReport(supabase, context = {}) {
  const summary = await getVaultDaySummary(supabase, context);
  return {
    ...summary,
    reportMode: "management",
  };
}

export function groupFactsByReportType(facts = []) {
  const groups = {};
  for (const fact of facts) {
    const key = fact.reportType || "unknown";
    if (!groups[key]) groups[key] = [];
    groups[key].push(fact);
  }
  return groups;
}

export function pickMetricValue(facts, metricKey) {
  const hit = (facts || []).find((f) => f.metricKey === metricKey && f.metricValue != null);
  return hit ? hit.metricValue : null;
}

export function pickTextFact(facts, metricKey) {
  const hit = (facts || []).find((f) => f.metricKey === metricKey && f.dimensions?.text_value);
  return hit?.dimensions?.text_value || null;
}

function buildVaultWarnings(coverage = [], facts = []) {
  const warnings = [];
  const partial = coverage.filter((c) => c.readinessStatus === "partial");
  if (partial.length) {
    warnings.push(
      `Partial vault coverage for: ${partial.map((c) => c.reportType).join(", ")} — review uploaded files.`,
    );
  }
  const lowConf = collectVaultSources(facts, coverage).filter(
    (s) => s.confidence != null && s.confidence < 0.55,
  );
  if (lowConf.length) {
    warnings.push("Some source files have low parser confidence — treat numbers as provisional.");
  }
  if (!facts.length) {
    warnings.push("No structured vault facts matched this period under your access scope.");
  }
  return warnings;
}

/** Strip intent phrasing to raw keyword query for FTS. */
export function extractDocumentSearchTerms(question = "") {
  let q = String(question || "").trim();
  q = q.replace(/^search uploaded reports for\s+/i, "");
  q = q.replace(/^(please\s+)?(find|search|look up|show references? to)\s+(mentions?\s+of\s+)?/i, "");
  q = q.replace(
    /\b(in uploaded (files|documents|reports)|from (the )?vault|in company knowledge)\b/gi,
    "",
  );
  return q.replace(/\?$/, "").trim();
}

export function buildChunkExcerpt(chunkText, searchTerms, maxLen = 240) {
  const text = String(chunkText || "");
  if (!text) return "";
  const lower = text.toLowerCase();
  const terms = String(searchTerms || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  let idx = -1;
  for (const term of terms) {
    const hit = lower.indexOf(term);
    if (hit >= 0 && (idx < 0 || hit < idx)) idx = hit;
  }
  if (idx < 0) {
    return text.length <= maxLen ? text : `${text.slice(0, maxLen - 1)}…`;
  }
  const start = Math.max(0, idx - 80);
  const slice = text.slice(start, start + maxLen);
  const prefix = start > 0 ? "…" : "";
  const suffix = start + maxLen < text.length ? "…" : "";
  return `${prefix}${slice}${suffix}`.trim();
}

export function formatChunkCitation(match) {
  const parts = [match.fileTitle || "Uploaded file"];
  if (match.pageNo != null) parts.push(`p. ${match.pageNo}`);
  if (match.sectionLabel) parts.push(match.sectionLabel);
  return parts.join(" · ");
}

export function mapVaultChunkRow(row, searchTerms) {
  const file = row?.file || null;
  const fileTitle = file?.title || file?.original_filename || "Uploaded file";
  const chunkText = row.chunk_text || "";
  return {
    id: row.id,
    fileId: row.file_id,
    chunkIndex: row.chunk_index,
    chunkText,
    pageNo: row.page_no,
    sectionLabel: row.section_label,
    branchId: row.branch_id,
    department: row.department,
    reportType: row.report_type || file?.report_type,
    fileTitle,
    excerpt: buildChunkExcerpt(chunkText, searchTerms),
    citation: formatChunkCitation({
      fileTitle,
      pageNo: row.page_no,
      sectionLabel: row.section_label,
    }),
  };
}

export async function searchVaultDocuments(supabase, context = {}) {
  const searchTerms =
    context.searchTerms || extractDocumentSearchTerms(context.question || context.route?.question || "");
  if (!searchTerms || searchTerms.length < 2) {
    return {
      searchTerms,
      matches: [],
      branch: resolveBranch(context),
      branchLabel: resolveBranch(context) ? branchDisplayName(resolveBranch(context)) : "Network",
      sources: [{ name: "ask_nac_document_chunks", detail: "No search terms extracted" }],
      warnings: ["Could not extract search terms from the question."],
    };
  }

  const scopedBranch = resolveBranch(context);
  let query = supabase
    .from("ask_nac_document_chunks")
    .select(CHUNK_SELECT)
    .textSearch("search_vector", searchTerms, { type: "websearch", config: "english" })
    .limit(20);

  if (scopedBranch) query = query.eq("branch_id", scopedBranch);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const matches = (data || []).map((row) => mapVaultChunkRow(row, searchTerms));
  const vaultSources = [...new Map(matches.map((m) => [m.fileId, {
    fileId: m.fileId,
    title: m.fileTitle,
    reportType: m.reportType,
  }])).values()];

  return {
    searchTerms,
    matches,
    branch: scopedBranch,
    branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
    vaultSources,
    sources: [{ name: "ask_nac_document_chunks", detail: "PostgreSQL full-text search (RLS-filtered)" }],
    warnings: matches.length ? [] : ["No matching document chunks under your access scope."],
  };
}

export async function runVaultQueryTool(supabase, intent, context = {}) {
  switch (intent) {
    case "vault_document_search":
      return searchVaultDocuments(supabase, context);
    case "vault_coverage_list":
      return getVaultReportSources(supabase, context);
    case "vault_cash_up_summary":
      return getVaultFacts(supabase, {
        ...context,
        startDate: context.vaultPeriod?.startDate,
        endDate: context.vaultPeriod?.endDate,
        reportType: "cash_up",
      });
    case "vault_reception_summary":
      return getVaultFacts(supabase, {
        ...context,
        startDate: context.vaultPeriod?.startDate,
        endDate: context.vaultPeriod?.endDate,
        reportType: "reception_daily_report",
      }).then(async (reception) => {
        const logbook = await getVaultFacts(supabase, {
          ...context,
          startDate: context.vaultPeriod?.startDate,
          endDate: context.vaultPeriod?.endDate,
          reportType: "daily_logbook",
          metricKeys: [
            "reservations",
            "covers",
            "walkins",
            "no_shows",
            "cancellations",
            "final_covers",
          ],
        });
        const facts = [...(reception.facts || []), ...(logbook.facts || [])];
        return {
          ...reception,
          facts,
          vaultSources: collectVaultSources(facts, []),
        };
      });
    case "vault_logbook_summary":
      return getVaultFacts(supabase, {
        ...context,
        startDate: context.vaultPeriod?.startDate,
        endDate: context.vaultPeriod?.endDate,
        reportType: "daily_logbook",
      });
    case "vault_google_review_star_summary":
      return getVaultFacts(supabase, {
        ...context,
        startDate: context.vaultPeriod?.startDate,
        endDate: context.vaultPeriod?.endDate,
        metricKeys: [
          "google_review_1",
          "google_review_2",
          "google_review_3",
          "google_review_4",
          "google_review_5",
        ],
      });
    case "vault_ccm_reconciliation_summary":
      return getVaultFacts(supabase, {
        ...context,
        startDate: context.vaultPeriod?.startDate,
        endDate: context.vaultPeriod?.endDate,
        reportType: "ccm_reconciliation",
      });
    case "vault_operational_day_summary":
      return getVaultDaySummary(supabase, context);
    case "vault_management_report_from_vault":
      return getVaultManagementReport(supabase, context);
    default:
      return null;
  }
}
