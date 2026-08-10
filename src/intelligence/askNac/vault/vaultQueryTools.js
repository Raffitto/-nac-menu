/**
 * Ask NAC Data Vault read-only query tools (ask_nac_structured_facts + ask_nac_data_coverage).
 * RLS enforces role/branch/sensitivity — never bypass client-side.
 */

import { resolveRbacQueryBranch } from "../../../lib/rbacQueryScope";
import { branchDisplayName } from "../../../dashboard/utils/rangeState";
import { extractDocumentSearchTerms } from "./vaultDocumentSearchRouting";
import {
  searchVaultDocumentChunks,
} from "./vaultDocumentSearchRetrieval";
import { summarizeVaultDocuments } from "./vaultDocumentSummary";
import {
  buildSalesPerformanceFactsAsSyntheticMatches,
  isSalesPerformanceKnowledgeQuery,
  CASH_UP_STRUCTURED_METRIC_KEYS,
  CASH_UP_PERIOD_AGGREGATION_METRIC_KEYS,
  CASH_UP_FACTS_QUERY_LIMIT,
  scoreSalesPerformanceQueryFocus,
} from "./vaultSalesPerformanceIntelligence";
import {
  aggregateCashUpFactsOverRange,
  buildCashUpRangeQueryLimit,
  enrichCashUpAggregationCoverageMeta,
  groupCashUpFactsByBusinessDate,
  shouldSkipDailyBreakdownForRange,
  shouldUseChunkedCashUpFetch,
  splitRangeIntoMonthChunks,
} from "./vaultCashUpAggregation";
import { isVaultCashUpAnalyticsPeriod, parseVaultComparePeriodsFromQuestion } from "./vaultPeriodParser";
import {
  extractOperationalReviewTheme,
  groupOperationalMatches,
  searchTermsForOperationalTheme,
} from "./vaultOperationalIntelligence";
import {
  isVaultMonthlyOperationalSummaryQuery,
} from "./vaultMonthlyOperationalSummaryRouting";
import { fetchExternalContextForNilPeriod } from "./vaultExternalContextRetrieval";
import { fetchExecutiveMemory } from "../executive/executiveMemory";
import { runKnowledgeHealthQuery } from "../knowledge/knowledgeHealthQueryTools";
import { getCachedVaultCoverage, setCachedVaultCoverage } from "./vaultCoverageCache";
import {
  fetchCashUpRangeAggregationViaRpc,
  shouldUseCashUpRangeRpc,
} from "./vaultCashUpRangeRpc";
import {
  approveDriveDiscoveryRules,
  discoverDriveFoldersFromRules,
} from "./driveDiscoveryQueryTools";
import { MONTHLY_LOGBOOK_SUMMARY_METRIC_KEYS } from "./vaultMonthlyLogbookSummary";

export { extractDocumentSearchTerms };

const LOGBOOK_SUMMARY_FACT_SELECT =
  "file_id,period_start,period_end,metric_key,metric_value,dimensions";

export async function getVaultLogbookSummaryFacts(
  supabase,
  {
    branch,
    startDate,
    endDate,
    profile,
    branchMention,
    filters,
    limit = 2500,
  } = {},
) {
  const scopedBranch = branch ?? resolveBranch({ profile, branchMention, filters });
  let query = supabase.from("ask_nac_structured_facts").select(LOGBOOK_SUMMARY_FACT_SELECT);
  query = periodOverlapFilter(query, startDate, endDate);
  if (scopedBranch) query = query.eq("branch_id", scopedBranch);
  query = query
    .eq("report_type", "daily_logbook")
    .in("metric_key", MONTHLY_LOGBOOK_SUMMARY_METRIC_KEYS)
    .order("period_start", { ascending: true });
  if (typeof limit === "number" && limit > 0) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const facts = (data || []).map((row) => ({
    fileId: row.file_id,
    metricKey: row.metric_key,
    metricValue: row.metric_value,
    dimensions: row.dimensions || {},
    periodStart: row.period_start,
    periodEnd: row.period_end,
    fileTitle: null,
  }));

  return {
    branch: scopedBranch,
    branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
    startDate,
    endDate,
    facts,
    sources: [{ name: "ask_nac_structured_facts", detail: "RLS-filtered daily_logbook summary facts" }],
  };
}

function attachLogbookFileTitles(facts = [], coverage = []) {
  const titleByFileId = new Map();
  const titleByDate = new Map();
  for (const row of coverage) {
    if (row.sourceFileId && row.fileTitle) titleByFileId.set(row.sourceFileId, row.fileTitle);
    if (row.periodStart && row.fileTitle) titleByDate.set(row.periodStart, row.fileTitle);
  }
  return facts.map((fact) => ({
    ...fact,
    fileTitle: titleByFileId.get(fact.fileId) || titleByDate.get(fact.periodStart) || fact.fileTitle,
  }));
}

export { attachLogbookFileTitles };

const FACT_SELECT =
  "id,file_id,branch_id,brand_wide,department,report_type,sensitivity_level,metric_key,metric_value,metric_unit,dimensions,period_start,period_end,grain,confidence,created_at,file:ask_nac_files(id,title,original_filename,classification_confidence,parser_version,sensitivity_level)";

const CASH_UP_RANGE_FACT_SELECT =
  "id,file_id,branch_id,report_type,metric_key,metric_value,dimensions,period_start,period_end,confidence";

const COVERAGE_SELECT =
  "id,branch_id,brand_wide,department,report_type,period_start,period_end,fact_count,readiness_status,last_ingested_at,source_file_id,source_file:ask_nac_files(id,title,original_filename,report_type,classification_confidence,parser_version,sensitivity_level)";

const COVERAGE_SLIM_SELECT =
  "id,branch_id,report_type,period_start,period_end,fact_count,readiness_status,last_ingested_at,source_file_id";

const CHUNK_SELECT =
  "id,file_id,chunk_index,chunk_text,page_no,section_label,branch_id,department,report_type,period_start,period_end,file:ask_nac_files(id,title,original_filename,report_type,sensitivity_level)";

function resolveBranch(context) {
  const branch = resolveRbacQueryBranch(context.profile, context.branchMention || context.filters?.branch);
  const raw = String(branch || "").trim().toLowerCase();
  if (!raw || raw === "all" || raw === "brand" || raw === "network") return null;
  return branch;
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

function mapVaultAggregationFactRow(row) {
  return {
    id: row.id,
    fileId: row.file_id,
    branchId: row.branch_id,
    reportType: row.report_type,
    metricKey: row.metric_key,
    metricValue: row.metric_value,
    dimensions: row.dimensions || {},
    periodStart: row.period_start,
    periodEnd: row.period_end,
    confidence: row.confidence,
    fileTitle: null,
    fileConfidence: null,
    parserVersion: null,
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
  {
    branch,
    fileId,
    startDate,
    endDate,
    reportType,
    metricKeys,
    profile,
    branchMention,
    filters,
    limit,
  } = {},
) {
  const scopedBranch = branch ?? resolveBranch({ profile, branchMention, filters });
  let query = supabase.from("ask_nac_structured_facts").select(FACT_SELECT);
  query = periodOverlapFilter(query, startDate, endDate);
  if (scopedBranch) query = query.eq("branch_id", scopedBranch);
  if (fileId) query = query.eq("file_id", String(fileId));
  if (reportType) query = query.eq("report_type", reportType);
  if (metricKeys?.length) query = query.in("metric_key", metricKeys);
  query = query.neq("metric_key", "raw_extract").order("metric_key");
  if (typeof limit === "number" && limit > 0) query = query.limit(limit);

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
  { branch, startDate, endDate, reportType, profile, branchMention, filters, slim = false } = {},
) {
  const scopedBranch = branch ?? resolveBranch({ profile, branchMention, filters });
  const cacheKey = { branch: scopedBranch, startDate, endDate, reportType, slim };
  const cached = getCachedVaultCoverage(cacheKey);
  if (cached) return cached;

  let query = supabase.from("ask_nac_data_coverage").select(slim ? COVERAGE_SLIM_SELECT : COVERAGE_SELECT);
  query = periodOverlapFilter(query, startDate, endDate);
  if (scopedBranch) query = query.eq("branch_id", scopedBranch);
  if (reportType) query = query.eq("report_type", reportType);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data || []).map(mapVaultCoverageRow);
  const result = {
    branch: scopedBranch,
    branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
    startDate,
    endDate,
    coverage: rows,
    sources: [{ name: "ask_nac_data_coverage", detail: "RLS-filtered coverage registry" }],
  };
  setCachedVaultCoverage(cacheKey, result);
  return result;
}

export async function getVaultCashUpAggregationFacts(
  supabase,
  { branch, startDate, endDate, profile, branchMention, filters, limit } = {},
) {
  const scopedBranch = branch ?? resolveBranch({ profile, branchMention, filters });
  let query = supabase.from("ask_nac_structured_facts").select(CASH_UP_RANGE_FACT_SELECT);
  query = periodOverlapFilter(query, startDate, endDate);
  if (scopedBranch) query = query.eq("branch_id", scopedBranch);
  query = query
    .eq("report_type", "cash_up")
    .in("metric_key", CASH_UP_PERIOD_AGGREGATION_METRIC_KEYS)
    .neq("metric_key", "raw_extract")
    .order("period_end", { ascending: true });
  if (typeof limit === "number" && limit > 0) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const facts = (data || []).map(mapVaultAggregationFactRow);
  return {
    branch: scopedBranch,
    branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
    startDate,
    endDate,
    facts,
    sources: [{ name: "ask_nac_structured_facts", detail: "RLS-filtered cash-up range facts" }],
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

function formatCashUpDayLabel(isoDate) {
  const parts = String(isoDate || "").split("-").map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return isoDate || "latest cash-up";
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function resolveCashUpBusinessDateFromCoverageRow(row) {
  const text = String(row?.period_end ?? row?.periodEnd ?? "").trim();
  return text || null;
}

export async function resolveLatestCashUpBusinessDate(supabase, { branch, fileId } = {}) {
  let query = supabase
    .from("ask_nac_structured_facts")
    .select("period_end")
    .eq("report_type", "cash_up")
    .not("period_end", "is", null)
    .neq("metric_key", "raw_extract")
    .order("period_end", { ascending: false })
    .limit(1);

  if (branch) query = query.eq("branch_id", branch);
  if (fileId) query = query.eq("file_id", fileId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const row = (data || [])[0];
  return row?.period_end ? String(row.period_end) : null;
}

export async function getVaultCashUpFactsOverRange(supabase, context = {}) {
  const vaultPeriod = context.vaultPeriod || {};
  const { startDate, endDate } = vaultPeriod;
  const scopedBranch = resolveBranch(context);
  const vaultCompare = context.vaultCompare || parseVaultComparePeriodsFromQuestion(context.question || "");

  if (vaultCompare?.current && vaultCompare?.previous) {
    // Keep daily rows for short windows so partial-period comparisons can match like-for-like days.
    const currentIncludeDaily = !shouldSkipDailyBreakdownForRange(
      vaultCompare.current.startDate,
      vaultCompare.current.endDate,
      vaultCompare.current.periodType,
    );
    const previousIncludeDaily = !shouldSkipDailyBreakdownForRange(
      vaultCompare.previous.startDate,
      vaultCompare.previous.endDate,
      vaultCompare.previous.periodType,
    );
    const currentResult = await fetchCashUpRangeBundle(supabase, context, {
      startDate: vaultCompare.current.startDate,
      endDate: vaultCompare.current.endDate,
      vaultPeriod: vaultCompare.current,
      includeDailyBreakdown: currentIncludeDaily,
      includeCoverage: false,
    });
    const previousResult = await fetchCashUpRangeBundle(supabase, context, {
      startDate: vaultCompare.previous.startDate,
      endDate: vaultCompare.previous.endDate,
      vaultPeriod: vaultCompare.previous,
      includeDailyBreakdown: previousIncludeDaily,
      includeCoverage: false,
    });

    const warnings = [
      ...(currentResult.warnings || []),
      ...(previousResult.warnings || []),
    ];
    if (currentResult.aggregation?.dayCount === 0) {
      warnings.push(`No cash-up facts found for ${vaultCompare.current.label}.`);
    }
    if (previousResult.aggregation?.dayCount === 0) {
      warnings.push(`No cash-up facts found for ${vaultCompare.previous.label}.`);
    }

    return {
      branch: scopedBranch,
      branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
      startDate: vaultCompare.current.startDate,
      endDate: vaultCompare.current.endDate,
      periodLabel: `${vaultCompare.current.label} vs ${vaultCompare.previous.label}`,
      facts: [],
      coverage: [],
      vaultSources: [],
      aggregation: currentResult.aggregation,
      previousAggregation: previousResult.aggregation,
      vaultCompare,
      warnings,
      sources: [{ name: "ask_nac_structured_facts", detail: "multi-day cash-up compare aggregation" }],
    };
  }

  return fetchCashUpRangeBundle(supabase, context, {
    startDate,
    endDate,
    vaultPeriod,
    includeDailyBreakdown: !shouldSkipDailyBreakdownForRange(startDate, endDate, vaultPeriod?.periodType),
    includeCoverage: true,
  });
}

async function fetchCashUpAggregationFactsResilient(supabase, params, vaultPeriod) {
  const { startDate, endDate } = params;
  const useChunks = shouldUseChunkedCashUpFetch(startDate, endDate, vaultPeriod?.periodType);

  if (!useChunks || !startDate || !endDate) {
    return getVaultCashUpAggregationFacts(supabase, params);
  }

  const chunks = splitRangeIntoMonthChunks(startDate, endDate);
  const allFacts = [];
  const chunkWarnings = [];
  let branch = null;
  let branchLabel = "Network";
  let loadedChunks = 0;

  const chunkResults = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const result = await getVaultCashUpAggregationFacts(supabase, {
          ...params,
          startDate: chunk.startDate,
          endDate: chunk.endDate,
          limit: buildCashUpRangeQueryLimit(chunk.startDate, chunk.endDate),
        });
        return { ok: true, chunk, result };
      } catch (err) {
        return {
          ok: false,
          chunk,
          error: err,
        };
      }
    }),
  );

  for (const entry of chunkResults) {
    if (entry.ok) {
      branch = entry.result.branch ?? branch;
      branchLabel = entry.result.branchLabel || branchLabel;
      allFacts.push(...(entry.result.facts || []));
      loadedChunks += 1;
    } else {
      chunkWarnings.push(
        `Cash-up facts for ${entry.chunk.label} (${entry.chunk.startDate} – ${entry.chunk.endDate}) could not be loaded: ${entry.error.message}`,
      );
    }
  }

  if (!allFacts.length) {
    throw new Error(chunkWarnings[0] || "Cash-up range facts query returned no rows.");
  }

  if (chunkWarnings.length > 0) {
    chunkWarnings.push(
      loadedChunks < chunks.length
        ? "YTD aggregation used partial monthly chunks — totals reflect loaded months only."
        : "Some monthly cash-up chunks reported errors but partial facts were merged.",
    );
  }

  return {
    branch,
    branchLabel,
    startDate,
    endDate,
    facts: allFacts,
    chunkWarnings,
    sources: [{ name: "ask_nac_structured_facts", detail: "RLS-filtered cash-up range facts (monthly chunks)" }],
  };
}

async function fetchCashUpRangeBundle(
  supabase,
  context,
  { startDate, endDate, vaultPeriod, includeDailyBreakdown = true, includeCoverage = true },
) {
  const scopedBranch = resolveBranch(context);
  const resolvedDailyBreakdown = includeDailyBreakdown
    ?? !shouldSkipDailyBreakdownForRange(startDate, endDate, vaultPeriod?.periodType);

  const useRpc = shouldUseCashUpRangeRpc({
    startDate,
    endDate,
    periodType: vaultPeriod?.periodType,
    includeDailyBreakdown: resolvedDailyBreakdown,
  });

  let factsResult;
  let aggregation;
  let factsByDate;

  if (useRpc) {
    try {
      aggregation = await fetchCashUpRangeAggregationViaRpc(supabase, {
        branch: scopedBranch,
        startDate,
        endDate,
        includeDailyBreakdown: false,
      });
      factsResult = {
        branch: scopedBranch,
        branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
        startDate,
        endDate,
        facts: [],
        chunkWarnings: [],
        sources: [{ name: "get_vault_cash_up_range_aggregate", detail: "server-side cash-up range aggregation" }],
      };
    } catch {
      factsResult = await fetchCashUpAggregationFactsResilient(supabase, {
        ...context,
        branch: scopedBranch,
        startDate,
        endDate,
        limit: buildCashUpRangeQueryLimit(startDate, endDate),
      }, vaultPeriod);
      factsByDate = groupCashUpFactsByBusinessDate(factsResult.facts || []);
      aggregation = aggregateCashUpFactsOverRange({
        startDate,
        endDate,
        branchId: scopedBranch,
        factsByDate,
        includeDailyBreakdown: resolvedDailyBreakdown,
      });
    }
  } else {
    factsResult = await fetchCashUpAggregationFactsResilient(supabase, {
      ...context,
      branch: scopedBranch,
      startDate,
      endDate,
      limit: buildCashUpRangeQueryLimit(startDate, endDate),
    }, vaultPeriod);
    factsByDate = groupCashUpFactsByBusinessDate(factsResult.facts || []);
    aggregation = aggregateCashUpFactsOverRange({
      startDate,
      endDate,
      branchId: scopedBranch,
      factsByDate,
      includeDailyBreakdown: resolvedDailyBreakdown,
    });
  }

  // Always attach requested-window coverage meta so matched comparisons can activate on Edge/client.
  aggregation = enrichCashUpAggregationCoverageMeta(aggregation, startDate, endDate);

  const resolvedFactsByDate = factsByDate
    ?? (resolvedDailyBreakdown
      ? groupCashUpFactsByBusinessDate(factsResult.facts || [])
      : undefined);

  let coverage = [];
  let warnings = [...(factsResult.chunkWarnings || [])];
  if (includeCoverage) {
    const coverageResult = await getVaultCoverage(supabase, {
      ...context,
      branch: scopedBranch,
      startDate,
      endDate,
      reportType: "cash_up",
      slim: true,
    });
    coverage = coverageResult.coverage;
    warnings = buildVaultWarnings(coverage, factsResult.facts || []);
  }

  if (aggregation.dayCount === 0) {
    warnings.push("No structured cash-up facts matched this date range under your access scope.");
  } else if (aggregation.dayCount < 2 && isVaultCashUpAnalyticsPeriod(vaultPeriod)) {
    warnings.push(`Only ${aggregation.dayCount} cash-up day(s) found in the requested range.`);
  }

  return {
    ...factsResult,
    periodLabel: vaultPeriod?.label || `${startDate} – ${endDate}`,
    coverage,
    vaultSources: collectVaultSources(factsResult.facts, coverage),
    factsByDate: resolvedDailyBreakdown ? resolvedFactsByDate : undefined,
    aggregation,
    warnings,
    sources: factsResult.sources || [{ name: "ask_nac_structured_facts", detail: "multi-day cash-up range aggregation" }],
  };
}

export async function getLatestVaultCashUpFacts(supabase, context = {}) {
  const scopedBranch = resolveBranch(context);
  let coverageQuery = supabase
    .from("ask_nac_data_coverage")
    .select(COVERAGE_SELECT)
    .eq("report_type", "cash_up")
    .not("period_end", "is", null)
    .order("period_end", { ascending: false });

  if (scopedBranch) coverageQuery = coverageQuery.eq("branch_id", scopedBranch);

  const { data, error } = await coverageQuery.limit(1);
  if (error) throw new Error(error.message);

  const latest = (data || [])[0];
  if (!latest) {
    return {
      branch: scopedBranch,
      branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
      facts: [],
      coverage: [],
      vaultSources: [],
      periodLabel: "latest cash-up",
    };
  }

  const branch = String(latest.branch_id || scopedBranch || "") || null;
  const fileId = latest.source_file_id ? String(latest.source_file_id) : null;
  const coverageRow = mapVaultCoverageRow(latest);
  const coveragePeriodEnd = resolveCashUpBusinessDateFromCoverageRow(latest);
  const businessDate = coveragePeriodEnd
    || await resolveLatestCashUpBusinessDate(supabase, { branch, fileId });

  if (!businessDate) {
    return {
      branch,
      branchLabel: branch ? branchDisplayName(branch) : "Network",
      facts: [],
      coverage: [coverageRow],
      vaultSources: collectVaultSources([], [coverageRow]),
      periodLabel: "latest cash-up",
      warnings: ["Cash-up coverage exists, but no business date was found in structured facts."],
    };
  }

  const factsResult = await getVaultFacts(supabase, {
    ...context,
    branch,
    fileId,
    startDate: businessDate,
    endDate: businessDate,
    reportType: "cash_up",
    metricKeys: CASH_UP_STRUCTURED_METRIC_KEYS,
    limit: CASH_UP_FACTS_QUERY_LIMIT,
  });

  return {
    ...factsResult,
    periodLabel: formatCashUpDayLabel(businessDate),
    coverage: [coverageRow],
    vaultSources: collectVaultSources(factsResult.facts, [coverageRow]),
  };
}

export async function fetchMonthlyLogbookOperationalReview(supabase, context = {}) {
  const { fetchMonthlyLogbookOperationalReview: fetchReview } = await import("./vaultMonthlyLogbookQuery.js");
  return fetchReview(supabase, context);
}

export async function searchOperationalReviewDocuments(supabase, context = {}) {
  const question = String(context.question || "");
  if (isVaultMonthlyOperationalSummaryQuery(question)) {
    const { fetchMonthlyLogbookOperationalReview: fetchReview } = await import("./vaultMonthlyLogbookQuery.js");
    const structured = await fetchReview(supabase, context);
    if (structured?.structuredLogbookReview) return structured;
  }

  const theme = context.reviewTheme || extractOperationalReviewTheme(question);
  const searchTerms = context.searchTerms || searchTermsForOperationalTheme(theme);
  const scopedBranch = resolveBranch(context);
  const reportTypes = ["daily_logbook", "reception_daily_report"];

  const hasRequestedPeriod = Boolean(context.vaultPeriod?.startDate && context.vaultPeriod?.endDate);
  const result = await searchVaultDocumentChunks(supabase, {
    select: CHUNK_SELECT,
    searchTerms,
    scopedBranch,
    vaultPeriod: context.vaultPeriod || null,
    reportTypes,
    preferRecent: hasRequestedPeriod
      || /\b(latest|recent|this month|this week|last\s+\d+\s+days?)\b/i.test(context.question || ""),
    // Time-bounded operational questions must not relax into out-of-window historical logbooks.
    strictMetadata: hasRequestedPeriod,
    mapRow: (row, terms) => mapVaultChunkRow(row, terms),
  });

  const grouped = groupOperationalMatches(result.matches);

  return {
    searchTerms,
    reviewTheme: theme,
    matches: result.matches,
    groupedFindings: grouped,
    branch: scopedBranch,
    branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
    periodLabel: context.vaultPeriod?.label || null,
    vaultPeriod: context.vaultPeriod || null,
    vaultSources: [...new Map(result.matches.map((m) => [m.fileId, {
      fileId: m.fileId,
      title: m.fileTitle,
      reportType: m.reportType,
    }])).values()],
    searchMethod: result.searchMethod,
    queryStatus: result.queryStatus,
    searchError: result.searchError,
    sources: [{ name: "ask_nac_document_chunks", detail: "Operational review search (RLS-filtered)" }],
  };
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
  if (match.periodStart) parts.push(match.periodStart);
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
    periodStart: row.period_start,
    periodEnd: row.period_end,
    fileTitle,
    excerpt: buildChunkExcerpt(chunkText, searchTerms),
    citation: formatChunkCitation({
      fileTitle,
      periodStart: row.period_start,
      pageNo: row.page_no,
      sectionLabel: row.section_label,
    }),
  };
}

export async function searchVaultDocuments(supabase, context = {}) {
  const searchTerms =
    context.searchTerms || extractDocumentSearchTerms(context.question || context.route?.question || "");
  const scopedBranch = resolveBranch(context);
  const q = String(context.question || context.route?.question || "");

  const result = await searchVaultDocumentChunks(supabase, {
    select: CHUNK_SELECT,
    searchTerms,
    scopedBranch,
    vaultPeriod: context.vaultPeriod || null,
    reportTypes: /\b(historical weekly dashboards?|weekly dashboards?|learned from weekly dashboard)\b/i.test(q)
      ? ["weekly_dashboard"]
      : /\blogbook|logbooks|daily report\b/i.test(q)
      ? ["daily_logbook"]
      : /\breception\b/i.test(q)
        ? ["reception_daily_report"]
        : /\bcash[\s-]?up\b/i.test(q)
          ? ["cash_up"]
          : [],
    preferRecent: /\b(latest|recent|newest|this month|this week)\b/i.test(q),
    mapRow: (row, terms) => mapVaultChunkRow(row, terms),
  });

  let matches = result.matches;
  let searchMethod = result.searchMethod;
  let warnings = result.warnings || [];

  if (!matches.length && isSalesPerformanceKnowledgeQuery(context.question || "")) {
    const latest = await getLatestVaultCashUpFacts(supabase, context);
    if (latest.facts?.length) {
      const fileTitle = latest.vaultSources?.[0]?.title || "Latest sales performance report";
      matches = buildSalesPerformanceFactsAsSyntheticMatches(latest.facts, fileTitle);
      searchMethod = "sales_performance_facts_fallback";
      warnings = [...warnings, "Document chunks unavailable — answered from structured sales performance facts."];
    }
  }

  const vaultSources = [...new Map(matches.map((m) => [m.fileId, {
    fileId: m.fileId,
    title: m.fileTitle,
    reportType: m.reportType,
    periodStart: m.periodStart,
    periodEnd: m.periodEnd,
  }])).values()];

  const methodDetail =
    searchMethod === "fts"
      ? "PostgreSQL full-text search (RLS-filtered)"
      : searchMethod === "fallback"
        ? "ILIKE token overlap fallback (RLS-filtered)"
        : searchMethod === "sales_performance_facts_fallback"
          ? "Structured sales performance facts fallback"
          : "No search executed";

  return {
    searchTerms: result.searchTerms,
    matches,
    branch: scopedBranch,
    branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
    vaultSources,
    searchMethod,
    queryStatus: result.queryStatus,
    searchError: result.searchError,
    sources: [{ name: "ask_nac_document_chunks", detail: methodDetail }],
    warnings,
  };
}

export async function runVaultQueryTool(supabase, intent, context = {}) {
  switch (intent) {
    case "vault_drive_discover":
      return discoverDriveFoldersFromRules(supabase, context);
    case "vault_drive_approve_rules":
      return approveDriveDiscoveryRules(supabase, context);
    case "vault_document_search":
      return searchVaultDocuments(supabase, context);
    case "vault_document_summary":
      return summarizeVaultDocuments(supabase, context);
    case "vault_coverage_list":
      return getVaultReportSources(supabase, context);
    case "vault_business_reasoning": {
      const vaultCompare = context.vaultCompare || parseVaultComparePeriodsFromQuestion(context.question || "");
      const vaultPeriod = context.vaultPeriod?.startDate ? context.vaultPeriod : vaultCompare?.current;
      const cashUp = await getVaultCashUpFactsOverRange(supabase, {
        ...context,
        vaultPeriod,
        vaultCompare,
      });
      const [externalContext, executiveMemoryResult] = await Promise.all([
        fetchExternalContextForNilPeriod(supabase, {
          ...context,
          branch: cashUp.branch,
          branchLabel: cashUp.branchLabel,
          periodLabel: cashUp.periodLabel,
          vaultCompare: cashUp.vaultCompare || vaultCompare,
          vaultPeriod,
        }),
        fetchExecutiveMemory(supabase, { branch: cashUp.branch }),
      ]);
      return {
        ...cashUp,
        externalContext,
        branchMemory: executiveMemoryResult.branchMemories || [],
        operatorMemory: executiveMemoryResult.operatorMemories || [],
        executiveMemory: executiveMemoryResult.memories || [],
      };
    }
    case "vault_cash_up_summary": {
      const question = String(context.question || "").toLowerCase();
      const vaultPeriod = context.vaultPeriod || {};
      const vaultCompare = context.vaultCompare || parseVaultComparePeriodsFromQuestion(context.question || "");
      const queryFocus = String(context.queryFocus || "");
      const performanceOverview = Boolean(context.performanceOverview);
      const hasResolvedWindow = Boolean(vaultPeriod?.startDate || vaultCompare?.current?.startDate);
      const forcePeriodPath = hasResolvedWindow
        || performanceOverview
        || ["performance_overview", "period_compare", "day_ranking"].includes(queryFocus)
        || scoreSalesPerformanceQueryFocus(String(context.question || "")) != null;
      try {
        if (
          !forcePeriodPath
          && (
            (!vaultPeriod?.startDate && !vaultCompare?.current?.startDate)
            || /\b(latest cash up|summarize.*cash up|what should management know from the cash up)\b/.test(question)
          )
        ) {
          return await getLatestVaultCashUpFacts(supabase, context);
        }
        if (vaultCompare || isVaultCashUpAnalyticsPeriod(vaultPeriod)) {
          return await getVaultCashUpFactsOverRange(supabase, {
            ...context,
            vaultPeriod: vaultPeriod?.startDate ? vaultPeriod : vaultCompare?.current,
            vaultCompare,
          });
        }
        if (vaultPeriod.isSingleDay) {
          return await getVaultFacts(supabase, {
            ...context,
            startDate: vaultPeriod.startDate,
            endDate: vaultPeriod.endDate,
            reportType: "cash_up",
            metricKeys: CASH_UP_STRUCTURED_METRIC_KEYS,
            limit: CASH_UP_FACTS_QUERY_LIMIT,
          });
        }
        return await getVaultCashUpFactsOverRange(supabase, context);
      } catch (err) {
        return {
          branch: resolveBranch(context),
          branchLabel: resolveBranch(context) ? branchDisplayName(resolveBranch(context)) : "Network",
          facts: [],
          coverage: [],
          vaultSources: [],
          periodLabel: context.vaultPeriod?.label || "cash-up",
          queryStatus: "connection_error",
          searchError: err?.message || "Cash-up facts query failed.",
        };
      }
    }
    case "vault_operational_review":
      return searchOperationalReviewDocuments(supabase, context);
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
    case "vault_daily_briefing_summary":
      return getVaultFacts(supabase, {
        ...context,
        startDate: context.vaultPeriod?.startDate,
        endDate: context.vaultPeriod?.endDate,
        reportType: "daily_briefing",
      });
    case "vault_breakage_summary":
      return searchVaultDocuments(supabase, {
        ...context,
        searchTerms: "breakage issues",
        reportTypes: ["breakage_report"],
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
      return getVaultDaySummary(supabase, context).then(async (summary) => {
        if ((summary.facts || []).length) return summary;
        const question = String(context.question || "");
        if (!/\bwhat happened|summarize|summary|operational day|day summary\b/i.test(question)) {
          return summary;
        }
        const documentFallback = await searchVaultDocuments(supabase, {
          ...context,
          searchTerms: question,
        });
        return {
          ...summary,
          documentFallback,
          warnings: [
            ...(summary.warnings || []),
            "No structured vault facts matched; searched uploaded document chunks instead.",
          ],
        };
      });
    case "vault_knowledge_health":
      return runKnowledgeHealthQuery(supabase, context);
    case "vault_management_report_from_vault":
      return getVaultManagementReport(supabase, context);
    default:
      return null;
  }
}
