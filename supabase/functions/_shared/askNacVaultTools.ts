/**
 * Ask NAC Data Vault query tools + deterministic answer builder (Edge).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { branchDisplayName } from "./askNacFoodicsTools.ts";
import { coercePlainTextDirectAnswer } from "./askNacResponseHelpers.ts";
import {
  assessSearchMatchConfidence,
  buildOperationalSearchDirectAnswer,
  buildSearchQueryContext,
  rankDocumentSearchChunks,
  scoreChunkRelevance,
  tokenizeDocumentSearchQuery,
} from "./vaultDocumentSearchRanking.ts";
import {
  classifyDocumentSearchError,
  DOCUMENT_SEARCH_MESSAGES,
  DOCUMENT_SEARCH_STATUS,
  escapeIlikePattern,
  searchVaultDocumentChunks,
} from "./vaultDocumentSearchRetrieval.ts";
import {
  buildSalesPerformanceExecutiveSummary,
  buildSalesPerformanceFactsAsSyntheticMatches,
  buildCashUpPeriodAggregateAnswer,
  buildCashUpDeliveryPlatformMetrics,
  buildCashUpPeriodCompareMetrics,
  isDeliveryPlatformPeriodQuery,
  scoreSalesPerformanceQueryFocus,
  appendCoverageToAggregateAnswer,
  extendedSalesPerformanceMetrics,
  formatManagerStyleAnswer,
  isSalesPerformanceExecutiveQuery,
  isSalesPerformanceKnowledgeQuery,
  CASH_UP_STRUCTURED_METRIC_KEYS,
  CASH_UP_PERIOD_AGGREGATION_METRIC_KEYS,
  CASH_UP_FACTS_QUERY_LIMIT,
} from "./vaultSalesPerformanceIntelligence.ts";
import { assessPeriodCoverage, buildCoverageAnswerLines } from "./coverageAwareness.ts";
import { resolveAnalyticalConfidence } from "./analyticalConfidence.ts";
import { buildCashUpExecutiveBrief } from "./vaultCashUpExecutiveBrief.ts";
import { buildVaultBusinessReasoningAnswer } from "./vaultBusinessReasoningAnswer.ts";
import { fetchExternalContextForNilPeriod } from "./vaultExternalContextRetrieval.ts";
import { fetchExecutiveMemory } from "./askNacExecutiveMemory.ts";
import {
  buildTeachOperatorAnswer,
  buildWeeklyDashboardAnswer,
  generateWeeklyDashboard,
  provideManualInputForSession,
  teachOperatorMemory,
} from "./askNacHumanInLoop.ts";
import {
  approveDriveDiscoveryRules,
  discoverDriveFolders,
} from "./askNacDriveDiscovery.ts";
import {
  buildPostgrestEquivalent,
  createEmptyCashUpProductionTrace,
  summarizeCoverageRawRow,
  summarizeMappedFactRow,
  type CashUpProductionTrace,
} from "./cashUpProductionTrace.ts";
import {
  buildCrossDocumentOperationalSummary,
  buildOperationalManagerAnswer,
  extractOperationalReviewTheme,
  groupOperationalMatches,
  isVaultOperationalReviewQuery,
  searchTermsForOperationalTheme,
} from "./vaultOperationalIntelligence.ts";
import {
  isVaultMonthlyOperationalSummaryQuery,
  scoreVaultMonthlyOperationalSummaryIntent,
  preferredMonthlyOperationalIntent,
} from "./vaultMonthlyOperationalSummaryRouting.ts";
import {
  aggregateCashUpFactsOverRange,
  buildCashUpRangeQueryLimit,
  enrichCashUpAggregationCoverageMeta,
  groupCashUpFactsByBusinessDate,
  shouldSkipDailyBreakdownForRange,
  shouldUseChunkedCashUpFetch,
  splitRangeIntoMonthChunks,
} from "./vaultCashUpAggregation.ts";
import { getCachedVaultCoverage, setCachedVaultCoverage } from "./askNacVaultCoverageCache.ts";
import {
  fetchCashUpRangeAggregationViaRpc,
  shouldUseCashUpRangeRpc,
} from "./askNacCashUpRangeRpc.ts";
import { runKnowledgeHealthQuery, buildKnowledgeHealthAnswer } from "./askNacKnowledgeHealth.ts";
import { MONTHLY_LOGBOOK_SUMMARY_METRIC_KEYS } from "./vaultMonthlyLogbookSummary.ts";

const LOGBOOK_SUMMARY_FACT_SELECT =
  "file_id,period_start,period_end,metric_key,metric_value,dimensions";

const FACT_SELECT =
  "id,file_id,branch_id,brand_wide,department,report_type,sensitivity_level,metric_key,metric_value,metric_unit,dimensions,period_start,period_end,grain,confidence,created_at,file:ask_nac_files(id,title,original_filename,classification_confidence,parser_version,sensitivity_level)";

const CASH_UP_RANGE_FACT_SELECT =
  "id,file_id,branch_id,report_type,metric_key,metric_value,dimensions,period_start,period_end,confidence";

const COVERAGE_SELECT =
  "id,branch_id,brand_wide,department,report_type,period_start,period_end,fact_count,readiness_status,last_ingested_at,source_file_id,source_file:ask_nac_files(id,title,original_filename,report_type,classification_confidence,parser_version,sensitivity_level)";

const COVERAGE_SLIM_SELECT =
  "id,branch_id,report_type,period_start,period_end,fact_count,readiness_status,last_ingested_at,source_file_id";

const MONTH_MAP: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
};

import {
  parseVaultPeriodFromQuestion,
  parseVaultComparePeriodsFromQuestion,
  parseVaultCustomCompareFromQuestion,
  parseExplicitDateRangeFromText,
  parseHalfMonthPhrase,
  hasVaultDayPeriod,
  isVaultRangePeriod,
  isVaultCashUpAnalyticsPeriod,
  isVaultFlexibleRangePeriod,
  buildPreviousEquivalentVaultPeriod,
  type VaultPeriod,
} from "./vaultPeriodParser.ts";

export type { VaultPeriod };
export {
  parseVaultPeriodFromQuestion,
  parseVaultComparePeriodsFromQuestion,
  parseVaultCustomCompareFromQuestion,
  parseExplicitDateRangeFromText,
  parseHalfMonthPhrase,
  hasVaultDayPeriod,
  isVaultRangePeriod,
  isVaultCashUpAnalyticsPeriod,
  isVaultFlexibleRangePeriod,
  buildPreviousEquivalentVaultPeriod,
};

export const VAULT_INTENTS = {
  CASH_UP: "vault_cash_up_summary",
  BUSINESS_REASONING: "vault_business_reasoning",
  RECEPTION: "vault_reception_summary",
  LOGBOOK: "vault_logbook_summary",
  GOOGLE_STARS: "vault_google_review_star_summary",
  CCM: "vault_ccm_reconciliation_summary",
  OPERATIONAL_DAY: "vault_operational_day_summary",
  MANAGEMENT_REPORT: "vault_management_report_from_vault",
  COVERAGE_LIST: "vault_coverage_list",
  DOCUMENT_SEARCH: "vault_document_search",
  DOCUMENT_SUMMARY: "vault_document_summary",
  OPERATIONAL_REVIEW: "vault_operational_review",
  WEEKLY_DASHBOARD: "vault_weekly_dashboard",
  TEACH_OPERATOR: "vault_teach_operator",
  PROVIDE_MANUAL_INPUT: "vault_provide_manual_input",
  DRIVE_DISCOVER: "vault_drive_discover",
  DRIVE_APPROVE_RULES: "vault_drive_approve_rules",
  DAILY_BRIEFING: "vault_daily_briefing_summary",
  BREAKAGE: "vault_breakage_summary",
  KNOWLEDGE_HEALTH: "vault_knowledge_health",
} as const;

export { isSalesPerformanceExecutiveQuery, isVaultOperationalReviewQuery };

const REPORT_LABELS: Record<string, string> = {
  cash_up: "Cash Up",
  reception_daily_report: "Reception Daily Report",
  daily_logbook: "Daily Logbook",
  ccm_reconciliation: "CCM Reconciliation",
};

/** Temporary production trace — remove after cash-up retrieval is stable. */
export type CashUpDebugPayload = {
  intent: string;
  selectedTool: string;
  normalizedBranch: string | null;
  branchLabel: string;
  vaultPeriod: VaultPeriod | null;
  selectedCoverageRow: Record<string, unknown> | null;
  factsQueryFilters: Record<string, unknown>;
  factsRowCount: number;
  firstFacts: Record<string, unknown>[];
  failureReason: string | null;
  queryStatus?: string | null;
  searchError?: string | null;
};

function summarizeCashUpFactForDebug(fact: Record<string, unknown>) {
  return {
    metricKey: fact.metricKey ?? fact.metric_key,
    metricValue: fact.metricValue ?? fact.metric_value,
    periodStart: fact.periodStart ?? fact.period_start,
    periodEnd: fact.periodEnd ?? fact.period_end,
    fileTitle: fact.fileTitle ?? fact.file_title,
    branchId: fact.branchId ?? fact.branch_id,
    reportType: fact.reportType ?? fact.report_type,
  };
}

function buildCashUpFactsQueryFilters({
  branch,
  startDate,
  endDate,
  reportType = "cash_up",
  metricKeys = CASH_UP_STRUCTURED_METRIC_KEYS,
  limit = CASH_UP_FACTS_QUERY_LIMIT,
  fileId = null,
}: {
  branch: string | null;
  startDate?: string | null;
  endDate?: string | null;
  reportType?: string;
  metricKeys?: readonly string[];
  limit?: number;
  fileId?: string | null;
}) {
  return {
    branch_id: branch,
    file_id: fileId,
    period_start_lte: endDate ?? null,
    period_end_gte: startDate ?? null,
    report_type: reportType,
    metric_keys: metricKeys,
    metric_key_neq: "raw_extract",
    limit,
  };
}

function inferCashUpFailureReason({
  facts,
  tool,
  readiness,
  route,
}: {
  facts: Record<string, unknown>[];
  tool: Record<string, unknown> | null;
  readiness: Record<string, unknown> | null;
  route: Record<string, unknown>;
}) {
  if (tool?.queryStatus === "connection_error") {
    return String(tool.searchError || "Cash-up facts query failed (connection_error).");
  }
  if (readiness && readiness.canQuery === false) {
    const reasons = readiness.reasons as string[] | undefined;
    if (reasons?.length) return reasons[0];
    return "Readiness blocked query (canQuery=false).";
  }
  if (!tool) {
    return "Query tool returned null — no vault tool result was produced.";
  }
  if (facts.length) return null;

  const coverage = (tool.coverage as Record<string, unknown>[]) || [];
  const vaultSources = (tool.vaultSources as unknown[]) || [];
  const routePeriod = route.vaultPeriod as { startDate?: string; label?: string } | undefined;
  const askedForDate = Boolean(routePeriod?.startDate || tool.startDate);

  if (tool.warnings && (tool.warnings as string[]).some((w) => /no business date/i.test(w))) {
    return "Coverage row found but resolveLatestCashUpBusinessDate returned no period_end.";
  }
  if (vaultSources.length || coverage.length) {
    return "Cash-up report exists, but structured facts query returned zero rows for the applied filters.";
  }
  if (askedForDate) {
    return `No cash-up facts matched ${tool.periodLabel || routePeriod?.label || "the requested date"}.`;
  }
  return "No cash_up coverage row with non-null period_end under the current branch/access scope.";
}

export function buildCashUpDebugPayload({
  intent,
  selectedTool,
  context,
  tool,
  readiness,
  route,
  selectedCoverageRow = null,
  factsQueryFilters,
  facts = [],
}: {
  intent: string;
  selectedTool: string;
  context: Record<string, unknown>;
  tool: Record<string, unknown> | null;
  readiness: Record<string, unknown> | null;
  route: Record<string, unknown>;
  selectedCoverageRow?: Record<string, unknown> | null;
  factsQueryFilters: Record<string, unknown>;
  facts?: Record<string, unknown>[];
}) {
  const normalizedBranch = resolveBranch(context);
  const factRows = facts.length ? facts : ((tool?.facts as Record<string, unknown>[]) || []);
  return {
    intent,
    selectedTool,
    normalizedBranch,
    branchLabel: normalizedBranch ? branchDisplayName(normalizedBranch) : "Network",
    vaultPeriod: (context.vaultPeriod as VaultPeriod | null) || (route.vaultPeriod as VaultPeriod | null) || null,
    selectedCoverageRow,
    factsQueryFilters,
    factsRowCount: factRows.length,
    firstFacts: factRows.slice(0, 5).map((row) => summarizeCashUpFactForDebug(row)),
    failureReason: inferCashUpFailureReason({ facts: factRows, tool, readiness, route }),
    queryStatus: tool?.queryStatus ? String(tool.queryStatus) : null,
    searchError: tool?.searchError ? String(tool.searchError) : null,
  } satisfies CashUpDebugPayload;
}

function normalizeVaultBranch(value: unknown): string | null {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "all" || raw === "brand" || raw === "network") return null;
  if (raw.includes("khobar")) return "khobar";
  if (raw.includes("riyadh")) return "riyadh";
  if (raw.includes("jeddah") || raw.includes("jedda")) return "jeddah";
  return raw;
}

function resolveBranch(context: Record<string, unknown> = {}): string | null {
  const branchMention = context.branchMention as string | null;
  const filters = context.filters as { branch?: string } | undefined;
  const profile = context.profile as { branchScope?: string; allBranches?: boolean } | undefined;
  // Prefer explicit question/UI branch before network-wide defaults.
  const fromMention = normalizeVaultBranch(branchMention);
  if (fromMention) return fromMention;
  const fromFilters = normalizeVaultBranch(filters?.branch || (context.branch as string | null));
  if (fromFilters) return fromFilters;
  if (profile?.branchScope && !profile.allBranches) return normalizeVaultBranch(profile.branchScope);
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function periodOverlapFilter(query: any, startDate?: string, endDate?: string) {
  if (!startDate || !endDate) return query;
  return query.lte("period_start", endDate).gte("period_end", startDate);
}

export function mapVaultFactRow(row: Record<string, unknown>) {
  const file = row?.file as Record<string, unknown> | null;
  return {
    id: row.id,
    fileId: row.file_id,
    branchId: row.branch_id,
    department: row.department,
    reportType: row.report_type,
    metricKey: row.metric_key,
    metricValue: row.metric_value,
    metricUnit: row.metric_unit,
    dimensions: (row.dimensions as Record<string, unknown>) || {},
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

function mapVaultAggregationFactRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    fileId: row.file_id,
    branchId: row.branch_id,
    reportType: row.report_type,
    metricKey: row.metric_key,
    metricValue: row.metric_value,
    dimensions: (row.dimensions as Record<string, unknown>) || {},
    periodStart: row.period_start,
    periodEnd: row.period_end,
    confidence: row.confidence,
    fileTitle: null,
    fileConfidence: null,
    parserVersion: null,
  };
}

export function mapVaultCoverageRow(row: Record<string, unknown>) {
  const file = row?.source_file as Record<string, unknown> | null;
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

export function collectVaultSources(facts: Record<string, unknown>[] = [], coverage: Record<string, unknown>[] = []) {
  const map = new Map<string, Record<string, unknown>>();
  for (const fact of facts) {
    if (!fact.fileId || !fact.fileTitle) continue;
    map.set(String(fact.fileId), {
      fileId: fact.fileId,
      title: fact.fileTitle,
      reportType: fact.reportType,
      confidence: fact.fileConfidence,
      parserVersion: fact.parserVersion,
    });
  }
  for (const row of coverage) {
    if (!row.sourceFileId || !row.fileTitle) continue;
    map.set(String(row.sourceFileId), {
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
  supabase: SupabaseClient,
  {
    branch,
    fileId,
    startDate,
    endDate,
    reportType,
    metricKeys,
    branchMention,
    filters,
    profile,
    limit,
  }: Record<string, unknown> = {},
) {
  const scopedBranch = (branch as string | null) ?? resolveBranch({ branchMention, filters, profile });
  let query = supabase.from("ask_nac_structured_facts").select(FACT_SELECT);
  query = periodOverlapFilter(query, startDate as string, endDate as string);
  if (scopedBranch) query = query.eq("branch_id", scopedBranch);
  if (fileId) query = query.eq("file_id", String(fileId));
  if (reportType) query = query.eq("report_type", reportType);
  if (Array.isArray(metricKeys) && metricKeys.length) query = query.in("metric_key", metricKeys);
  query = query.neq("metric_key", "raw_extract").order("metric_key");
  if (typeof limit === "number" && limit > 0) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const facts = (data || []).map((row) => mapVaultFactRow(row as Record<string, unknown>));
  return {
    branch: scopedBranch,
    branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
    startDate,
    endDate,
    facts,
    sources: [{ name: "ask_nac_structured_facts", detail: "RLS-filtered vault facts" }],
  };
}

export async function getVaultLogbookSummaryFacts(
  supabase: SupabaseClient,
  {
    branch,
    startDate,
    endDate,
    branchMention,
    filters,
    profile,
    limit = 2500,
  }: Record<string, unknown> = {},
) {
  const scopedBranch = (branch as string | null) ?? resolveBranch({ branchMention, filters, profile });
  let query = supabase.from("ask_nac_structured_facts").select(LOGBOOK_SUMMARY_FACT_SELECT);
  query = periodOverlapFilter(query, startDate as string, endDate as string);
  if (scopedBranch) query = query.eq("branch_id", scopedBranch);
  query = query
    .eq("report_type", "daily_logbook")
    .in("metric_key", [...MONTHLY_LOGBOOK_SUMMARY_METRIC_KEYS])
    .order("period_start", { ascending: true });
  if (typeof limit === "number" && limit > 0) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const facts = (data || []).map((row) => {
    const typed = row as Record<string, unknown>;
    return {
      fileId: typed.file_id,
      metricKey: typed.metric_key,
      metricValue: typed.metric_value,
      dimensions: (typed.dimensions as Record<string, unknown>) || {},
      periodStart: typed.period_start,
      periodEnd: typed.period_end,
      fileTitle: null,
    };
  });

  return {
    branch: scopedBranch,
    branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
    startDate,
    endDate,
    facts,
    sources: [{ name: "ask_nac_structured_facts", detail: "RLS-filtered daily_logbook summary facts" }],
  };
}

export function attachLogbookFileTitles(facts: Record<string, unknown>[] = [], coverage: Record<string, unknown>[] = []) {
  const titleByFileId = new Map<string, string>();
  const titleByDate = new Map<string, string>();
  for (const row of coverage) {
    if (row.sourceFileId && row.fileTitle) titleByFileId.set(String(row.sourceFileId), String(row.fileTitle));
    if (row.periodStart && row.fileTitle) titleByDate.set(String(row.periodStart), String(row.fileTitle));
  }
  return facts.map((fact) => ({
    ...fact,
    fileTitle: titleByFileId.get(String(fact.fileId)) || titleByDate.get(String(fact.periodStart)) || fact.fileTitle,
  }));
}

export async function getVaultCoverage(
  supabase: SupabaseClient,
  {
    branch,
    startDate,
    endDate,
    reportType,
    branchMention,
    filters,
    profile,
    slim = false,
  }: Record<string, unknown> = {},
) {
  const scopedBranch = (branch as string | null) ?? resolveBranch({ branchMention, filters, profile });
  const cacheKey = {
    branch: scopedBranch,
    startDate,
    endDate,
    reportType,
    slim,
  };
  const cached = getCachedVaultCoverage(cacheKey);
  if (cached) return cached as Record<string, unknown>;

  let query = supabase.from("ask_nac_data_coverage").select(slim ? COVERAGE_SLIM_SELECT : COVERAGE_SELECT);
  query = periodOverlapFilter(query, startDate as string, endDate as string);
  if (scopedBranch) query = query.eq("branch_id", scopedBranch);
  if (reportType) query = query.eq("report_type", reportType);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data || []).map((row) => mapVaultCoverageRow(row as Record<string, unknown>));
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

async function resolveLatestCompletedCashUpDate(
  supabase: SupabaseClient,
  branchId: string | null,
): Promise<string | null> {
  let query = supabase
    .from("ask_nac_data_coverage")
    .select("period_end")
    .eq("report_type", "cash_up")
    .not("period_end", "is", null)
    .order("period_end", { ascending: false })
    .limit(1);
  if (branchId) query = query.eq("branch_id", branchId);
  const { data, error } = await query;
  if (error || !data?.[0]?.period_end) return null;
  return String(data[0].period_end);
}

export async function getVaultCashUpAggregationFacts(
  supabase: SupabaseClient,
  {
    branch,
    startDate,
    endDate,
    branchMention,
    filters,
    profile,
    limit,
  }: Record<string, unknown> = {},
) {
  const scopedBranch = (branch as string | null) ?? resolveBranch({ branchMention, filters, profile });
  let query = supabase.from("ask_nac_structured_facts").select(CASH_UP_RANGE_FACT_SELECT);
  query = periodOverlapFilter(query, startDate as string, endDate as string);
  if (scopedBranch) query = query.eq("branch_id", scopedBranch);
  query = query
    .eq("report_type", "cash_up")
    .in("metric_key", [...CASH_UP_PERIOD_AGGREGATION_METRIC_KEYS])
    .neq("metric_key", "raw_extract")
    .order("period_end", { ascending: true });
  if (typeof limit === "number" && limit > 0) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const facts = (data || []).map((row) => mapVaultAggregationFactRow(row as Record<string, unknown>));
  return {
    branch: scopedBranch,
    branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
    startDate,
    endDate,
    facts,
    sources: [{ name: "ask_nac_structured_facts", detail: "RLS-filtered cash-up range facts" }],
  };
}

export function groupFactsByReportType(facts: Record<string, unknown>[] = []) {
  const groups: Record<string, Record<string, unknown>[]> = {};
  for (const fact of facts) {
    const key = String(fact.reportType || "unknown");
    if (!groups[key]) groups[key] = [];
    groups[key].push(fact);
  }
  return groups;
}

export function pickMetricValue(facts: Record<string, unknown>[], metricKey: string) {
  const hit = facts.find((f) => f.metricKey === metricKey && f.metricValue != null);
  return hit ? hit.metricValue : null;
}

export function pickTextFact(facts: Record<string, unknown>[], metricKey: string) {
  const hit = facts.find((f) => f.metricKey === metricKey && (f.dimensions as Record<string, unknown>)?.text_value);
  return (hit?.dimensions as Record<string, unknown>)?.text_value || null;
}

function buildVaultWarnings(coverage: Record<string, unknown>[] = [], facts: Record<string, unknown>[] = []) {
  const warnings: string[] = [];
  const partial = coverage.filter((c) => c.readinessStatus === "partial");
  if (partial.length) {
    warnings.push(`Partial vault coverage for: ${partial.map((c) => c.reportType).join(", ")} — review uploaded files.`);
  }
  const lowConf = collectVaultSources(facts, coverage).filter(
    (s) => s.confidence != null && Number(s.confidence) < 0.55,
  );
  if (lowConf.length) warnings.push("Some source files have low parser confidence — treat numbers as provisional.");
  if (!facts.length) warnings.push("No structured vault facts matched this period under your access scope.");
  return warnings;
}

async function getVaultReportSources(supabase: SupabaseClient, context: Record<string, unknown> = {}) {
  const vaultPeriod = context.vaultPeriod as VaultPeriod | undefined;
  const coverageResult = await getVaultCoverage(supabase, {
    ...context,
    startDate: vaultPeriod?.startDate,
    endDate: vaultPeriod?.endDate,
  });
  const vaultSources = collectVaultSources([], coverageResult.coverage as Record<string, unknown>[]);
  return {
    ...coverageResult,
    vaultSources,
    periodLabel: vaultPeriod?.label || `${vaultPeriod?.startDate} – ${vaultPeriod?.endDate}`,
  };
}

async function getVaultDaySummary(supabase: SupabaseClient, context: Record<string, unknown> = {}) {
  const vaultPeriod = context.vaultPeriod as VaultPeriod | undefined;
  const branch = resolveBranch(context);
  const factsResult = await getVaultFacts(supabase, {
    ...context,
    branch,
    startDate: vaultPeriod?.startDate,
    endDate: vaultPeriod?.endDate,
  });
  const coverageResult = await getVaultCoverage(supabase, {
    ...context,
    branch,
    startDate: vaultPeriod?.startDate,
    endDate: vaultPeriod?.endDate,
  });

  const facts = factsResult.facts as Record<string, unknown>[];
  const byReport = groupFactsByReportType(facts);
  const vaultSources = collectVaultSources(facts, coverageResult.coverage as Record<string, unknown>[]);

  return {
    branch,
    branchLabel: factsResult.branchLabel,
    startDate: vaultPeriod?.startDate,
    endDate: vaultPeriod?.endDate,
    periodLabel: vaultPeriod?.label || vaultPeriod?.startDate,
    facts,
    byReport,
    coverage: coverageResult.coverage,
    vaultSources,
    warnings: buildVaultWarnings(coverageResult.coverage as Record<string, unknown>[], facts),
    sources: [
      { name: "ask_nac_structured_facts", detail: "day summary facts" },
      { name: "ask_nac_data_coverage", detail: "coverage registry" },
    ],
  };
}

export async function runVaultQueryTool(supabase: SupabaseClient, intent: string, context: Record<string, unknown> = {}) {
  const vaultPeriod = context.vaultPeriod as VaultPeriod | undefined;
  switch (intent) {
    case VAULT_INTENTS.TEACH_OPERATOR:
      return teachOperatorMemory(supabase, context);
    case VAULT_INTENTS.WEEKLY_DASHBOARD:
      return generateWeeklyDashboard(supabase, context);
    case VAULT_INTENTS.PROVIDE_MANUAL_INPUT:
      return provideManualInputForSession(supabase, context);
    case VAULT_INTENTS.DRIVE_DISCOVER:
      return discoverDriveFolders(supabase, context);
    case VAULT_INTENTS.DRIVE_APPROVE_RULES:
      return approveDriveDiscoveryRules(supabase, context);
    case VAULT_INTENTS.DOCUMENT_SEARCH:
      return searchVaultDocuments(supabase, context);
    case VAULT_INTENTS.DOCUMENT_SUMMARY:
      return summarizeVaultDocuments(supabase, context);
    case VAULT_INTENTS.KNOWLEDGE_HEALTH:
      return runKnowledgeHealthQuery(supabase, context);
    case VAULT_INTENTS.COVERAGE_LIST:
      return getVaultReportSources(supabase, context);
    case VAULT_INTENTS.BUSINESS_REASONING: {
      const vaultCompare = (context.vaultCompare as { current?: VaultPeriod; previous?: VaultPeriod } | null)
        || parseVaultComparePeriodsFromQuestion(String(context.question || ""));
      const vaultPeriod = (context.vaultPeriod as VaultPeriod | undefined)?.startDate
        ? (context.vaultPeriod as VaultPeriod)
        : vaultCompare?.current;
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
        fetchExecutiveMemory(supabase, { branch: cashUp.branch as string | null }),
      ]);
      return {
        ...cashUp,
        externalContext,
        executiveMemory: executiveMemoryResult.memories || [],
        branchMemory: executiveMemoryResult.branchMemories || [],
        operatorMemory: executiveMemoryResult.operatorMemories || [],
      };
    }
    case VAULT_INTENTS.CASH_UP: {
      const question = String(context.question || "").toLowerCase();
      const vaultCompare = (context.vaultCompare as { current?: VaultPeriod; previous?: VaultPeriod } | null)
        || parseVaultComparePeriodsFromQuestion(String(context.question || ""));
      const queryFocus = String(context.queryFocus || context.route?.queryFocus || "");
      const performanceOverview = Boolean(context.performanceOverview || context.route?.performanceOverview);
      const hasResolvedWindow = Boolean(vaultPeriod?.startDate || vaultCompare?.current?.startDate);
      // Never silently substitute latest cash-up day when a management window/focus was resolved or intended.
      const forcePeriodPath = hasResolvedWindow
        || performanceOverview
        || ["performance_overview", "period_compare", "day_ranking"].includes(queryFocus)
        || scoreSalesPerformanceQueryFocus(String(context.question || "")) != null;
      const useLatestPath =
        !forcePeriodPath
        && (!vaultPeriod?.startDate && !vaultCompare?.current?.startDate)
        || (
          !forcePeriodPath
          && /\b(latest cash up|summarize.*cash up|what should management know from the cash up)\b/.test(question)
        );
      const selectedTool = useLatestPath
        ? "getLatestVaultCashUpFacts"
        : (vaultCompare || isVaultCashUpAnalyticsPeriod(vaultPeriod || null))
          ? "getVaultCashUpFactsOverRange"
          : "getVaultFacts";
      try {
        if (useLatestPath) {
          return await getLatestVaultCashUpFacts(supabase, context);
        }
        if (vaultCompare || isVaultCashUpAnalyticsPeriod(vaultPeriod || null)) {
          return await getVaultCashUpFactsOverRange(supabase, {
            ...context,
            vaultPeriod: vaultPeriod?.startDate ? vaultPeriod : vaultCompare?.current,
            vaultCompare,
          });
        }
        if (vaultPeriod?.isSingleDay) {
          const branch = resolveBranch(context);
          const factsQueryFilters = buildCashUpFactsQueryFilters({
            branch,
            startDate: vaultPeriod?.startDate,
            endDate: vaultPeriod?.endDate,
          });
          const factsResult = await getVaultFacts(supabase, {
            ...context,
            startDate: vaultPeriod?.startDate,
            endDate: vaultPeriod?.endDate,
            reportType: "cash_up",
            metricKeys: CASH_UP_STRUCTURED_METRIC_KEYS,
            limit: CASH_UP_FACTS_QUERY_LIMIT,
          });
          const toolPayload = {
            ...factsResult,
            periodLabel: vaultPeriod?.label || factsResult.startDate,
          };
          return {
            ...toolPayload,
            cashUpDebug: buildCashUpDebugPayload({
              intent: VAULT_INTENTS.CASH_UP,
              selectedTool,
              context,
              tool: toolPayload,
              readiness: null,
              route: { vaultPeriod },
              factsQueryFilters,
              facts: factsResult.facts as Record<string, unknown>[],
            }),
          };
        }
        return await getVaultCashUpFactsOverRange(supabase, context);
      } catch (err) {
        const branch = resolveBranch(context);
        const errorTool = {
          branch,
          branchLabel: branch ? branchDisplayName(branch) : "Network",
          facts: [],
          coverage: [],
          vaultSources: [],
          periodLabel: vaultPeriod?.label || "cash-up",
          queryStatus: "connection_error",
          searchError: (err as Error)?.message || "Cash-up facts query failed.",
        };
        return {
          ...errorTool,
          cashUpDebug: buildCashUpDebugPayload({
            intent: VAULT_INTENTS.CASH_UP,
            selectedTool,
            context,
            tool: errorTool,
            readiness: null,
            route: { vaultPeriod },
            factsQueryFilters: buildCashUpFactsQueryFilters({
              branch,
              startDate: vaultPeriod?.startDate,
              endDate: vaultPeriod?.endDate,
            }),
          }),
        };
      }
    }
    case VAULT_INTENTS.OPERATIONAL_REVIEW:
      return searchOperationalReviewDocuments(supabase, context);
    case VAULT_INTENTS.RECEPTION: {
      const reception = await getVaultFacts(supabase, {
        ...context,
        startDate: vaultPeriod?.startDate,
        endDate: vaultPeriod?.endDate,
        reportType: "reception_daily_report",
      });
      const logbook = await getVaultFacts(supabase, {
        ...context,
        startDate: vaultPeriod?.startDate,
        endDate: vaultPeriod?.endDate,
        reportType: "daily_logbook",
        metricKeys: ["reservations", "covers", "walkins", "no_shows", "cancellations", "final_covers"],
      });
      const facts = [...(reception.facts as Record<string, unknown>[]), ...(logbook.facts as Record<string, unknown>[])];
      return { ...reception, facts, vaultSources: collectVaultSources(facts, []) };
    }
    case VAULT_INTENTS.LOGBOOK:
      return getVaultFacts(supabase, {
        ...context,
        startDate: vaultPeriod?.startDate,
        endDate: vaultPeriod?.endDate,
        reportType: "daily_logbook",
      });
    case VAULT_INTENTS.DAILY_BRIEFING:
      return getVaultFacts(supabase, {
        ...context,
        startDate: vaultPeriod?.startDate,
        endDate: vaultPeriod?.endDate,
        reportType: "daily_briefing",
      });
    case VAULT_INTENTS.BREAKAGE:
      return searchVaultDocuments(supabase, {
        ...context,
        searchTerms: "breakage issues",
        reportTypes: ["breakage_report"],
      });
    case VAULT_INTENTS.GOOGLE_STARS:
      return getVaultFacts(supabase, {
        ...context,
        startDate: vaultPeriod?.startDate,
        endDate: vaultPeriod?.endDate,
        metricKeys: ["google_review_1", "google_review_2", "google_review_3", "google_review_4", "google_review_5"],
      });
    case VAULT_INTENTS.CCM:
      return getVaultFacts(supabase, {
        ...context,
        startDate: vaultPeriod?.startDate,
        endDate: vaultPeriod?.endDate,
        reportType: "ccm_reconciliation",
      });
    case VAULT_INTENTS.OPERATIONAL_DAY:
      return getVaultDaySummary(supabase, context).then(async (summary) => {
        const facts = (summary.facts as Record<string, unknown>[]) || [];
        if (facts.length) return summary;
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
            ...((summary.warnings as string[]) || []),
            "No structured vault facts matched; searched uploaded document chunks instead.",
          ],
        };
      });
    case VAULT_INTENTS.MANAGEMENT_REPORT: {
      const summary = await getVaultDaySummary(supabase, context);
      return { ...summary, reportMode: "management" };
    }
    default:
      return null;
  }
}

const DOC_SEARCH_ACTION =
  /\b(find|search|look up|show|list|summarize|summary|show references? to|mentions? of|contains?|entries?)\b/i;
const DOC_SEARCH_SCOPE =
  /\b(company knowledge|data vault|uploaded documents?|uploaded reports?|uploaded files?|documents?|logbooks?|daily logbooks?|document search|vault)\b/i;
const EXPLICIT_DOCUMENT_SCOPE =
  /\b(logbooks?|daily logbooks?|uploaded reports?|uploaded documents?|documents?|vault|company knowledge)\b/i;
const SEARCH_PREFIX =
  /\b(search company knowledge|search uploaded documents|search uploaded reports|find mentions of|look up)\b/i;
const DOCUMENT_SCOPE =
  /\b(logbooks?|daily logbooks?|uploaded reports?|uploaded documents?|documents?|files?|vault|company knowledge)\b/i;
const CASH_UP_INTENT_SIGNAL =
  /\b(cash[\s-]?up|cashup|cash report|daily cash report|cash reconciliation|cash[\s-]?up sales)\b/i;

export function isDocumentSummaryFollowUp(q = ""): boolean {
  const text = String(q || "").trim().toLowerCase();
  if (!text) return false;
  if (/\b(summarize|summary|executive|takeaways?|management know|brief me|overview)\b/.test(text)) return true;
  if (/^(provide an? executive summary|key takeaways|what should management know)\b/.test(text)) return true;
  return false;
}

export function isVaultDocumentSummaryQuery(q = "", documentContext: Record<string, unknown> | null = null): boolean {
  const text = String(q || "").trim().toLowerCase();
  if (!text) return false;
  const ctx = documentContext as { fileIds?: string[] } | null;
  if (ctx?.fileIds?.length && isDocumentSummaryFollowUp(text)) return true;
  if (SEARCH_PREFIX.test(text)) return false;
  if (CASH_UP_INTENT_SIGNAL.test(text)) return false;
  if (isVaultMonthlyOperationalSummaryQuery(text)
    && preferredMonthlyOperationalIntent(text) === "vault_document_summary") {
    return true;
  }
  if (/\bsummarize\b/.test(text) && DOCUMENT_SCOPE.test(text)) return true;
  if (/\bsummarize (this|that|the) (document|report|logbook|file|upload)\b/.test(text)) return true;
  if (/\b(provide|give me) (an? )?executive summary\b/.test(text)) return true;
  if (/\bexecutive summary\b/.test(text)) return true;
  if (/\bkey takeaways?\b/.test(text)) return true;
  if (/\bwhat should management know\b/.test(text) && !/\b(logbooks?|uploaded logbooks)\b/.test(text)) return true;
  if (/\bsummarize the\b/.test(text) && /\b(logbook|document|report|upload)\b/.test(text)) return true;
  if (/\bsummarize\b/.test(text) && /\b(june|july|august|september|october|november|december|january|february|march|april|may)\b/.test(text)) {
    if (/\b(branch|operation|operational|cash[\s-]?up|what happened)\b/.test(text)) return false;
    if (/\b(logbook|document|report|upload|file|khobar|riyadh|jeddah)\b/.test(text)) return true;
    return false;
  }
  if (/\bsummarize\b/.test(text) && /\b(khobar|riyadh|jeddah)\b/.test(text) && /\blogbook\b/.test(text)) return true;
  return false;
}

export function scoreVaultDocumentSummaryIntent(q = "", documentContext: Record<string, unknown> | null = null): number {
  const monthlyScore = scoreVaultMonthlyOperationalSummaryIntent(q);
  if (monthlyScore && preferredMonthlyOperationalIntent(q) === "vault_document_summary") {
    return monthlyScore;
  }
  if (!isVaultDocumentSummaryQuery(q, documentContext)) return 0;
  if (CASH_UP_INTENT_SIGNAL.test(q)) return 0;
  const ctx = documentContext as { fileIds?: string[] } | null;
  if (ctx?.fileIds?.length && isDocumentSummaryFollowUp(q)) return 34;
  if (/\bsummarize\b/.test(q) && DOCUMENT_SCOPE.test(q)) return 34;
  if (/\bwhat should management know\b/.test(q)) return 33;
  if (/\bexecutive summary\b/.test(q)) return 33;
  if (/\bkey takeaways?\b/.test(q)) return 32;
  if (/\bsummarize (this|that|the) (document|report|logbook|file)\b/.test(q)) return 32;
  if (/\bsummarize the\b/.test(q) && /\blogbook\b/.test(q)) return 31;
  return 30;
}

export function extractDocumentSummarySubject(question = ""): string {
  let q = String(question || "").trim();
  q = q.replace(/^summarize (this|that|the) (document|report|logbook|file|upload)\s*/i, "");
  q = q.replace(/^summarize\s+(the\s+)?/i, "");
  q = q.replace(/^(please\s+)?(provide|give me) (an? )?executive summary (of|for|on|about)?\s*/i, "");
  q = q.replace(/^executive summary (of|for|on|about)?\s*/i, "");
  q = q.replace(/^key takeaways (from|for|on|about)?\s*/i, "");
  q = q.replace(/^what should management know (about|from|regarding)?\s*/i, "");
  q = q.replace(/^summarize (the )?/i, "");
  q = q.replace(/\b(from (the )?vault|in company knowledge|uploaded documents?)\b/gi, "");
  return q.replace(/\?$/, "").trim();
}

export function isVaultDocumentSearchQuery(q = ""): boolean {
  const text = String(q || "").trim().toLowerCase();
  if (!text) return false;
  if (isVaultDocumentSummaryQuery(text)) return false;
  if (isSalesPerformanceExecutiveQuery(text)) return false;
  if (/\bsearch company knowledge for cash[\s-]?up\b/.test(text)) return false;
  if (!DOC_SEARCH_ACTION.test(text) && isVaultOperationalReviewQuery(text)) return false;
  if (/\b(historical weekly dashboards?|weekly dashboards?|executive reports?)\b/.test(text)) return true;
  if (/\b(show|list|summarize|everything learned from|learned from)\b/.test(text) && /\bweekly dashboard\b/.test(text)) return true;
  if (/\bfind mentions of\b/.test(text)) return true;
  if (/\bsearch company knowledge\b/.test(text)) return true;
  if (/\bsearch uploaded documents\b/.test(text)) return true;
  if (/\bsearch uploaded reports for\b/.test(text)) return true;
  if (/\bsummarize (the )?(uploaded )?(document|report|logbook)\b/.test(text)) return false;
  if (/\bsummarize the\b/.test(text) && /\blogbook\b/.test(text)) return false;
  if (/\blatest uploaded logbook\b/.test(text)) return true;
  if (DOC_SEARCH_ACTION.test(text) && DOC_SEARCH_SCOPE.test(text)) return true;
  if (DOC_SEARCH_ACTION.test(text) && EXPLICIT_DOCUMENT_SCOPE.test(text)) return true;
  if (/\b(find|search|summarize)\b/.test(text) && /\blogbook\b/.test(text)) return true;
  if (
    /\b(find|search|look up|mentions? of|contains?)\b/.test(text) &&
    /\b(uploaded|document|file|report|vault|knowledge|sop)\b/.test(text)
  ) {
    return true;
  }
  if (/\b(find|search)\b/.test(text) && /\b(waste|complaint|terrace|ac)\b/.test(text)) return true;
  return false;
}

export function scoreVaultDocumentSearchIntent(q = ""): number {
  const text = String(q || "").trim().toLowerCase();
  if (!isVaultDocumentSearchQuery(text)) return 0;
  if (/\b(historical weekly dashboards?|everything learned from)\b/.test(text)) return 32;
  if (/\b(show|list|summarize|learned from)\b/.test(text) && /\bweekly dashboard\b/.test(text)) return 31;
  if (/\bfind mentions of\b/.test(text)) return 30;
  if (/\bsearch company knowledge\b/.test(text)) return 30;
  if (/\bsearch uploaded documents\b/.test(text)) return 30;
  if (/\bsearch uploaded reports for\b/.test(text)) return 30;
  if (DOC_SEARCH_ACTION.test(text) && EXPLICIT_DOCUMENT_SCOPE.test(text)) return 30;
  if (/\bsummarize (the )?(uploaded )?(document|report|logbook)\b/.test(text)) return 0;
  if (/\bsummarize the\b/.test(text) && /\blogbook\b/.test(text)) return 0;
  if (/\blatest uploaded logbook\b/.test(text)) return 29;
  if (/\b(find|search|summarize)\b/.test(text) && /\blogbook\b/.test(text)) return 28;
  if (DOC_SEARCH_ACTION.test(text) && DOC_SEARCH_SCOPE.test(text)) return 27;
  return 26;
}

export function extractDocumentSearchTerms(question = ""): string {
  let q = String(question || "").trim();
  q = q.replace(/^show me everything learned from historical weekly dashboards\.?\s*/i, "");
  q = q.replace(/^everything learned from historical weekly dashboards\.?\s*/i, "");
  q = q.replace(/^show me everything learned from\s+/i, "");
  q = q.replace(/^search company knowledge for\s+/i, "");
  q = q.replace(/^search uploaded documents for\s+/i, "");
  q = q.replace(/^search uploaded reports for\s+/i, "");
  q = q.replace(/^summarize (the )?(uploaded )?(document|report|logbook)\s+/i, "");
  q = q.replace(/^summarize (the )?/i, "");
  q = q.replace(/^(please\s+)?(find|search|look up|show references? to)\s+(mentions?\s+of\s+)?/i, "");
  q = q.replace(
    /\b(in uploaded (files|documents|reports)|from (the )?vault|in company knowledge|from company knowledge|in (the )?data vault)\b/gi,
    "",
  );
  return q.replace(/\?$/, "").trim();
}

function buildChunkExcerpt(chunkText: string, searchTerms: string, maxLen = 240): string {
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

function formatChunkCitation(match: { fileTitle?: string; pageNo?: number | null; sectionLabel?: string | null; periodStart?: string | null }) {
  const parts = [match.fileTitle || "Uploaded file"];
  if (match.periodStart) parts.push(match.periodStart);
  if (match.pageNo != null) parts.push(`p. ${match.pageNo}`);
  if (match.sectionLabel) parts.push(match.sectionLabel);
  return parts.join(" · ");
}

const CHUNK_SELECT =
  "id,file_id,chunk_index,chunk_text,page_no,section_label,branch_id,department,report_type,period_start,period_end,file:ask_nac_files(id,title,original_filename,report_type,sensitivity_level)";

function mapVaultChunkMatchRow(row: Record<string, unknown>, searchTerms: string) {
  const file = row.file as Record<string, unknown> | null;
  const fileTitle = String(file?.title || file?.original_filename || "Uploaded file");
  const chunkText = String(row.chunk_text || "");
  return {
    id: row.id,
    fileId: row.file_id,
    chunkIndex: row.chunk_index,
    chunkText,
    pageNo: row.page_no,
    sectionLabel: row.section_label,
    fileTitle,
    reportType: row.report_type || file?.report_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    excerpt: buildChunkExcerpt(chunkText, searchTerms),
    citation: formatChunkCitation({
      fileTitle,
      periodStart: row.period_start as string | null,
      pageNo: row.page_no as number | null,
      sectionLabel: row.section_label as string | null,
    }),
  };
}

function formatCashUpDayLabel(isoDate: string) {
  const parts = String(isoDate || "").split("-").map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return isoDate || "latest cash-up";
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function normalizeCashUpIsoDate(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function resolveCashUpBusinessDateFromCoverageRow(row: Record<string, unknown> | null | undefined): string | null {
  return normalizeCashUpIsoDate(row?.period_end ?? row?.periodEnd);
}

export async function resolveLatestCashUpBusinessDate(
  supabase: SupabaseClient,
  { branch, fileId }: { branch: string | null; fileId: string | null },
): Promise<string | null> {
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

  const row = (data || [])[0] as Record<string, unknown> | undefined;
  return row?.period_end ? String(row.period_end) : null;
}

export async function getVaultCashUpFactsOverRange(supabase: SupabaseClient, context: Record<string, unknown> = {}) {
  const vaultPeriod = (context.vaultPeriod as VaultPeriod | undefined) || undefined;
  const startDate = vaultPeriod?.startDate;
  const endDate = vaultPeriod?.endDate;
  const scopedBranch = resolveBranch(context);
  const vaultCompare = (context.vaultCompare as { current: VaultPeriod; previous: VaultPeriod } | null)
    || parseVaultComparePeriodsFromQuestion(String(context.question || ""));

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
      ...((currentResult.warnings as string[]) || []),
      ...((previousResult.warnings as string[]) || []),
    ];
    if ((currentResult.aggregation as { dayCount?: number })?.dayCount === 0) {
      warnings.push(`No cash-up facts found for ${vaultCompare.current.label}.`);
    }
    if ((previousResult.aggregation as { dayCount?: number })?.dayCount === 0) {
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

async function fetchCashUpAggregationFactsResilient(
  supabase: SupabaseClient,
  params: Record<string, unknown> & { startDate?: string; endDate?: string },
  vaultPeriod?: VaultPeriod,
) {
  const startDate = params.startDate as string | undefined;
  const endDate = params.endDate as string | undefined;
  const useChunks = shouldUseChunkedCashUpFetch(startDate, endDate, vaultPeriod?.periodType);

  if (!useChunks || !startDate || !endDate) {
    return getVaultCashUpAggregationFacts(supabase, params);
  }

  const chunks = splitRangeIntoMonthChunks(startDate, endDate);
  const allFacts: Record<string, unknown>[] = [];
  const chunkWarnings: string[] = [];
  let branch: string | null = null;
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
        return { ok: true as const, chunk, result };
      } catch (err) {
        return { ok: false as const, chunk, error: err as Error };
      }
    }),
  );

  for (const entry of chunkResults) {
    if (entry.ok) {
      branch = (entry.result.branch as string | null) ?? branch;
      branchLabel = String(entry.result.branchLabel || branchLabel);
      allFacts.push(...((entry.result.facts as Record<string, unknown>[]) || []));
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
  supabase: SupabaseClient,
  context: Record<string, unknown>,
  {
    startDate,
    endDate,
    vaultPeriod,
    includeDailyBreakdown = true,
    includeCoverage = true,
  }: {
    startDate?: string;
    endDate?: string;
    vaultPeriod?: VaultPeriod;
    includeDailyBreakdown?: boolean;
    includeCoverage?: boolean;
  },
) {
  const scopedBranch = resolveBranch(context);
  let resolvedStart = startDate;
  let resolvedEnd = endDate;
  let resolvedPeriod = vaultPeriod;
  if (vaultPeriod?.periodType === "latest_available_sale") {
    const latest = await resolveLatestCompletedCashUpDate(supabase, scopedBranch);
    if (latest) {
      resolvedStart = latest;
      resolvedEnd = latest;
      resolvedPeriod = {
        ...vaultPeriod,
        startDate: latest,
        endDate: latest,
        label: latest,
      };
    }
  }
  const resolvedDailyBreakdown = includeDailyBreakdown
    ?? !shouldSkipDailyBreakdownForRange(resolvedStart, resolvedEnd, resolvedPeriod?.periodType);

  const useRpc = shouldUseCashUpRangeRpc({
    startDate: resolvedStart,
    endDate: resolvedEnd,
    periodType: resolvedPeriod?.periodType,
    includeDailyBreakdown: resolvedDailyBreakdown,
  });

  let factsResult: Record<string, unknown>;
  let aggregation: Record<string, unknown>;
  let factsByDate: Record<string, Record<string, unknown>[]> | undefined;

  if (useRpc) {
    try {
      aggregation = await fetchCashUpRangeAggregationViaRpc(supabase, {
        branch: scopedBranch,
        startDate: resolvedStart,
        endDate: resolvedEnd,
        includeDailyBreakdown: Boolean(resolvedDailyBreakdown),
      });
      factsResult = {
        branch: scopedBranch,
        branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
        startDate: resolvedStart,
        endDate: resolvedEnd,
        facts: [],
        chunkWarnings: [],
        sources: [{ name: "get_vault_cash_up_range_aggregate", detail: "server-side cash-up range aggregation" }],
      };
    } catch {
      factsResult = await fetchCashUpAggregationFactsResilient(supabase, {
        ...context,
        branch: scopedBranch,
        startDate: resolvedStart,
        endDate: resolvedEnd,
        limit: buildCashUpRangeQueryLimit(resolvedStart, resolvedEnd),
      }, resolvedPeriod);
      factsByDate = groupCashUpFactsByBusinessDate((factsResult.facts as Record<string, unknown>[]) || []);
      aggregation = aggregateCashUpFactsOverRange({
        startDate: resolvedStart,
        endDate: resolvedEnd,
        branchId: scopedBranch,
        factsByDate,
        includeDailyBreakdown: resolvedDailyBreakdown,
      });
    }
  } else {
    factsResult = await fetchCashUpAggregationFactsResilient(supabase, {
      ...context,
      branch: scopedBranch,
      startDate: resolvedStart,
      endDate: resolvedEnd,
      limit: buildCashUpRangeQueryLimit(resolvedStart, resolvedEnd),
    }, resolvedPeriod);
    factsByDate = groupCashUpFactsByBusinessDate((factsResult.facts as Record<string, unknown>[]) || []);
    aggregation = aggregateCashUpFactsOverRange({
      startDate: resolvedStart,
      endDate: resolvedEnd,
      branchId: scopedBranch,
      factsByDate,
      includeDailyBreakdown: resolvedDailyBreakdown,
    });
  }

  // Always attach requested-window coverage meta so matched comparisons can activate on Edge.
  aggregation = enrichCashUpAggregationCoverageMeta(aggregation, resolvedStart, resolvedEnd) as Record<string, unknown>;

  const resolvedFactsByDate = factsByDate
    ?? (resolvedDailyBreakdown
      ? groupCashUpFactsByBusinessDate((factsResult.facts as Record<string, unknown>[]) || [])
      : undefined);

  let coverage: Record<string, unknown>[] = [];
  let warnings: string[] = [...((factsResult.chunkWarnings as string[]) || [])];
  if (includeCoverage) {
    const coverageResult = await getVaultCoverage(supabase, {
      ...context,
      branch: scopedBranch,
      startDate: resolvedStart,
      endDate: resolvedEnd,
      reportType: "cash_up",
      slim: true,
    });
    coverage = (coverageResult.coverage as Record<string, unknown>[]) || [];
    warnings = buildVaultWarnings(coverage, (factsResult.facts as Record<string, unknown>[]) || []);
  }

  if (aggregation.dayCount === 0) {
    warnings.push("No structured cash-up facts matched this date range under your access scope.");
    const latestCompletedDate = await resolveLatestCompletedCashUpDate(supabase, scopedBranch);
    if (latestCompletedDate && latestCompletedDate !== resolvedStart && latestCompletedDate !== resolvedEnd) {
      aggregation = { ...aggregation, latestCompletedDate };
    }
  } else if (aggregation.dayCount < 2 && isVaultCashUpAnalyticsPeriod(resolvedPeriod || null)) {
    warnings.push(`Only ${aggregation.dayCount} cash-up day(s) found in the requested range.`);
  }

  return {
    ...factsResult,
    periodLabel: resolvedPeriod?.label || `${resolvedStart} – ${resolvedEnd}`,
    coverage,
    vaultSources: collectVaultSources((factsResult.facts as Record<string, unknown>[]) || [], coverage),
    factsByDate: resolvedDailyBreakdown ? resolvedFactsByDate : undefined,
    aggregation,
    warnings,
    sources: (factsResult.sources as Record<string, unknown>[])
      || [{ name: "ask_nac_structured_facts", detail: "multi-day cash-up range aggregation" }],
  };
}

export async function getLatestVaultCashUpFacts(supabase: SupabaseClient, context: Record<string, unknown> = {}) {
  const scopedBranch = resolveBranch(context);
  const selectedTool = "getLatestVaultCashUpFacts";
  const productionTrace = createEmptyCashUpProductionTrace();
  productionTrace.question = String(context.question || "");
  productionTrace.selectedTool = selectedTool;
  productionTrace.branchFilter = {
    rawBranchFromFilters: (context.filters as Record<string, unknown> | undefined)?.branch ?? null,
    rawBranchFromRequest: context.branch ?? null,
    branchMention: (context.branchMention as string | null) ?? null,
    normalizedBranch: scopedBranch,
    profileHint: context.profile ?? null,
  };

  const coverageFilters: Record<string, unknown> = {
    report_type: "cash_up",
    period_end: "not.is.null",
    branch_id: scopedBranch ?? null,
    order: "period_end.desc",
    limit: 1,
  };
  const coveragePostgrest = buildPostgrestEquivalent("ask_nac_data_coverage", {
    select: COVERAGE_SELECT,
    eq: {
      report_type: "cash_up",
      ...(scopedBranch ? { branch_id: scopedBranch } : {}),
    },
    not: [{ column: "period_end", op: "is", value: "null" }],
    order: "period_end.desc",
    limit: 1,
  });

  let allCoverageQuery = supabase
    .from("ask_nac_data_coverage")
    .select(COVERAGE_SELECT)
    .eq("report_type", "cash_up")
    .order("period_end", { ascending: false })
    .limit(10);
  if (scopedBranch) allCoverageQuery = allCoverageQuery.eq("branch_id", scopedBranch);
  const { data: allCoverageRows, error: allCoverageError } = await allCoverageQuery;

  let coverageQuery = supabase
    .from("ask_nac_data_coverage")
    .select(COVERAGE_SELECT)
    .eq("report_type", "cash_up")
    .not("period_end", "is", null)
    .order("period_end", { ascending: false });

  if (scopedBranch) coverageQuery = coverageQuery.eq("branch_id", scopedBranch);

  const { data, error } = await coverageQuery.limit(1);

  productionTrace.coverageQuery = {
    postgrestEquivalent: coveragePostgrest,
    filters: coverageFilters,
    error: error?.message || allCoverageError?.message || null,
    rowCount: (data || []).length,
    allMatchingRows: (allCoverageRows || []).map((row) =>
      summarizeCoverageRawRow(row as Record<string, unknown>),
    ),
    selectedRow: null,
  };

  if (error) {
    productionTrace.failurePoint = "coverage_query_error";
    productionTrace.factsRowCount = 0;
    return {
      branch: scopedBranch,
      branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
      facts: [],
      coverage: [],
      vaultSources: [],
      periodLabel: "latest cash-up",
      queryStatus: "connection_error",
      searchError: error.message,
      cashUpProductionTrace: productionTrace,
      cashUpDebug: buildCashUpDebugPayload({
        intent: VAULT_INTENTS.CASH_UP,
        selectedTool,
        context,
        tool: { queryStatus: "connection_error", searchError: error.message, facts: [] },
        readiness: null,
        route: { vaultPeriod: context.vaultPeriod },
        factsQueryFilters: buildCashUpFactsQueryFilters({
          branch: scopedBranch,
          startDate: null,
          endDate: null,
        }),
      }),
    };
  }

  const latest = (data || [])[0] as Record<string, unknown> | undefined;
  if (!latest) {
    productionTrace.failurePoint = "coverage_query_zero_rows";
    productionTrace.factsRowCount = 0;
    return {
      branch: scopedBranch,
      branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
      facts: [],
      coverage: [],
      vaultSources: [],
      periodLabel: "latest cash-up",
      cashUpProductionTrace: productionTrace,
      cashUpDebug: buildCashUpDebugPayload({
        intent: VAULT_INTENTS.CASH_UP,
        selectedTool,
        context,
        tool: { facts: [], coverage: [] },
        readiness: null,
        route: { vaultPeriod: context.vaultPeriod },
        factsQueryFilters: buildCashUpFactsQueryFilters({
          branch: scopedBranch,
          startDate: null,
          endDate: null,
        }),
      }),
    };
  }

  const branch = String(latest.branch_id || scopedBranch || "") || null;
  const fileId = latest.source_file_id ? String(latest.source_file_id) : null;
  const coverageRow = mapVaultCoverageRow(latest);
  productionTrace.coverageQuery.selectedRow = summarizeCoverageRawRow(latest);

  const coveragePeriodEnd = resolveCashUpBusinessDateFromCoverageRow(latest);
  let businessDate = coveragePeriodEnd;
  let businessDateError: string | null = null;

  if (businessDate) {
    productionTrace.businessDateQuery = {
      postgrestEquivalent: "(skipped — coverage.period_end)",
      filters: {
        resolutionSource: "coverage.period_end",
        coverage_period_end: businessDate,
        structured_facts_scan: false,
        branch_id: branch ?? null,
        file_id: fileId ?? null,
      },
      error: null,
      resolvedBusinessDate: businessDate,
    };
  } else {
    const businessDateFilters: Record<string, unknown> = {
      resolutionSource: "structured_facts_scan",
      report_type: "cash_up",
      period_end: "not.is.null",
      metric_key: "neq.raw_extract",
      branch_id: branch ?? null,
      file_id: fileId ?? null,
      order: "period_end.desc",
      limit: 1,
    };
    const businessDatePostgrest = buildPostgrestEquivalent("ask_nac_structured_facts", {
      select: "period_end",
      eq: {
        report_type: "cash_up",
        ...(branch ? { branch_id: branch } : {}),
        ...(fileId ? { file_id: fileId } : {}),
      },
      neq: { metric_key: "raw_extract" },
      not: [{ column: "period_end", op: "is", value: "null" }],
      order: "period_end.desc",
      limit: 1,
    });

    let businessDateQuery = supabase
      .from("ask_nac_structured_facts")
      .select("period_end")
      .eq("report_type", "cash_up")
      .not("period_end", "is", null)
      .neq("metric_key", "raw_extract")
      .order("period_end", { ascending: false })
      .limit(1);
    if (branch) businessDateQuery = businessDateQuery.eq("branch_id", branch);
    if (fileId) businessDateQuery = businessDateQuery.eq("file_id", fileId);
    const { data: businessDateRows, error: businessDateScanError } = await businessDateQuery;
    businessDateError = businessDateScanError?.message || null;
    const businessDateRow = (businessDateRows || [])[0] as Record<string, unknown> | undefined;
    businessDate = businessDateRow?.period_end ? String(businessDateRow.period_end) : null;

    productionTrace.businessDateQuery = {
      postgrestEquivalent: businessDatePostgrest,
      filters: businessDateFilters,
      error: businessDateError,
      resolvedBusinessDate: businessDate,
    };
  }

  if (!businessDate) {
    productionTrace.failurePoint = "business_date_resolution_null";
    productionTrace.factsRowCount = 0;
    return {
      branch,
      branchLabel: branch ? branchDisplayName(branch) : "Network",
      facts: [],
      coverage: [coverageRow],
      vaultSources: collectVaultSources([], [coverageRow]),
      periodLabel: "latest cash-up",
      warnings: ["Cash-up coverage exists, but no business date was found in structured facts."],
      cashUpProductionTrace: productionTrace,
      cashUpDebug: buildCashUpDebugPayload({
        intent: VAULT_INTENTS.CASH_UP,
        selectedTool,
        context,
        tool: { facts: [], coverage: [coverageRow], warnings: ["no business date"] },
        readiness: null,
        route: { vaultPeriod: context.vaultPeriod },
        selectedCoverageRow: coverageRow,
        factsQueryFilters: buildCashUpFactsQueryFilters({
          branch,
          fileId,
          startDate: null,
          endDate: null,
        }),
      }),
    };
  }

  const factsQueryFilters = buildCashUpFactsQueryFilters({
    branch,
    fileId,
    startDate: businessDate,
    endDate: businessDate,
  });

  const factsPostgrest = buildPostgrestEquivalent("ask_nac_structured_facts", {
    select: FACT_SELECT,
    eq: {
      report_type: "cash_up",
      ...(branch ? { branch_id: branch } : {}),
      ...(fileId ? { file_id: fileId } : {}),
    },
    neq: { metric_key: "raw_extract" },
    inFilters: { metric_key: [...CASH_UP_STRUCTURED_METRIC_KEYS] },
    lte: { period_start: businessDate },
    gte: { period_end: businessDate },
    order: "metric_key.asc",
    limit: CASH_UP_FACTS_QUERY_LIMIT,
  });

  let factsResult: Awaited<ReturnType<typeof getVaultFacts>>;
  let factsQueryError: string | null = null;
  try {
    factsResult = await getVaultFacts(supabase, {
      ...context,
      branch,
      fileId,
      startDate: businessDate,
      endDate: businessDate,
      reportType: "cash_up",
      metricKeys: CASH_UP_STRUCTURED_METRIC_KEYS,
      limit: CASH_UP_FACTS_QUERY_LIMIT,
    });
  } catch (factsErr) {
    factsQueryError = (factsErr as Error)?.message || String(factsErr);
    factsResult = {
      branch,
      branchLabel: branch ? branchDisplayName(branch) : "Network",
      startDate: businessDate,
      endDate: businessDate,
      facts: [],
      sources: [],
    };
  }

  const factRows = factsResult.facts as Record<string, unknown>[];
  productionTrace.factsQuery = {
    postgrestEquivalent: factsPostgrest,
    filters: factsQueryFilters,
    error: factsQueryError,
    rowCount: factRows.length,
    firstTenFacts: factRows.slice(0, 10).map((row) => summarizeMappedFactRow(row)),
  };
  productionTrace.factsRowCount = factRows.length;
  if (factsQueryError) {
    productionTrace.failurePoint = "facts_query_error";
  } else if (!factRows.length) {
    productionTrace.failurePoint = "facts_query_zero_rows";
  }

  const toolPayload = {
    ...factsResult,
    periodLabel: formatCashUpDayLabel(businessDate),
    coverage: [coverageRow],
    vaultSources: collectVaultSources(factRows, [coverageRow]),
    ...(factsQueryError
      ? { queryStatus: "connection_error", searchError: factsQueryError }
      : {}),
  };

  return {
    ...toolPayload,
    cashUpProductionTrace: productionTrace,
    cashUpDebug: buildCashUpDebugPayload({
      intent: VAULT_INTENTS.CASH_UP,
      selectedTool,
      context,
      tool: toolPayload,
      readiness: null,
      route: { vaultPeriod: context.vaultPeriod },
      selectedCoverageRow: coverageRow,
      factsQueryFilters,
      facts: factRows,
    }),
  };
}

export async function searchOperationalReviewDocuments(supabase: SupabaseClient, context: Record<string, unknown> = {}) {
  const question = String(context.question || "");
  if (isVaultMonthlyOperationalSummaryQuery(question)) {
    const { fetchMonthlyLogbookOperationalReview } = await import("./vaultMonthlyLogbookQuery.ts");
    const structured = await fetchMonthlyLogbookOperationalReview(supabase, context);
    if (structured?.structuredLogbookReview) return structured;
  }

  const theme = (context.reviewTheme as string) || extractOperationalReviewTheme(question);
  const searchTerms = (context.searchTerms as string) || searchTermsForOperationalTheme(theme);
  const scopedBranch = resolveBranch(context);
  const reportTypes = ["daily_logbook", "reception_daily_report"];
  const vaultPeriod = (context.vaultPeriod as VaultPeriod | null) || null;
  const hasRequestedPeriod = Boolean(vaultPeriod?.startDate && vaultPeriod?.endDate);

  const result = await searchVaultDocumentChunks(supabase, {
    select: CHUNK_SELECT,
    searchTerms,
    scopedBranch,
    vaultPeriod,
    reportTypes,
    preferRecent: hasRequestedPeriod
      || /\b(latest|recent|this month|this week|last\s+\d+\s+days?)\b/i.test(String(context.question || "")),
    // Time-bounded operational questions must not relax into out-of-window historical logbooks.
    strictMetadata: hasRequestedPeriod,
    mapRow: (row, terms) => mapVaultChunkMatchRow(row as Record<string, unknown>, terms),
  });

  const grouped = groupOperationalMatches(result.matches as Record<string, unknown>[]);

  return {
    searchTerms,
    reviewTheme: theme,
    matches: result.matches,
    groupedFindings: grouped,
    branch: scopedBranch,
    branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
    periodLabel: vaultPeriod?.label || null,
    vaultPeriod,
    vaultSources: [...new Map(result.matches.map((m) => [m.fileId, {
      fileId: m.fileId,
      title: m.fileTitle,
      reportType: m.reportType,
      periodStart: m.periodStart,
      periodEnd: m.periodEnd,
    }])).values()],
    searchMethod: result.searchMethod,
    queryStatus: result.queryStatus,
    searchError: result.searchError,
    sources: [{ name: "ask_nac_document_chunks", detail: "Operational review search (RLS-filtered)" }],
  };
}

export async function searchVaultDocuments(
  supabase: SupabaseClient,
  context: Record<string, unknown> = {},
) {
  const searchTerms =
    (context.searchTerms as string) ||
    extractDocumentSearchTerms(String(context.question || ""));

  const scopedBranch = resolveBranch(context);
  const q = String(context.question || "");

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
    mapRow: (row, terms) => mapVaultChunkMatchRow(row as Record<string, unknown>, terms),
  });

  let matches = result.matches;
  let searchMethod = result.searchMethod;
  let warnings = result.warnings || [];

  if (!matches.length && isSalesPerformanceKnowledgeQuery(String(context.question || ""))) {
    const latest = await getLatestVaultCashUpFacts(supabase, context);
    const latestFacts = latest.facts as Record<string, unknown>[] | undefined;
    if (latestFacts?.length) {
      const fileTitle = String((latest.vaultSources as Record<string, unknown>[])?.[0]?.title || "Latest sales performance report");
      matches = buildSalesPerformanceFactsAsSyntheticMatches(latestFacts, fileTitle);
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
    searchMethod,
    queryStatus: result.queryStatus,
    searchError: result.searchError,
    vaultSources,
    branch: scopedBranch,
    branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
    sources: [{ name: "ask_nac_document_chunks", detail: methodDetail }],
    warnings,
  };
}

async function resolveDocumentSummaryFilesEdge(supabase: SupabaseClient, context: Record<string, unknown>) {
  const docCtx = (context.documentContext || {}) as { fileIds?: string[]; fileTitles?: string[] };
  if (docCtx.fileIds?.length) {
    return { fileIds: docCtx.fileIds, fileTitles: docCtx.fileTitles || [], source: "conversation" };
  }
  const subject = extractDocumentSummarySubject(String(context.question || ""));
  const tokens = tokenizeDocumentSearchQuery(subject);
  const queryContext = buildSearchQueryContext(subject);
  if (!tokens.length) return { fileIds: [] as string[], fileTitles: [] as string[], source: null };
  const orClause = tokens.slice(0, 8).map((token) => `original_filename.ilike.%${escapeIlikePattern(token)}%`).join(",");
  const { data, error } = await supabase
    .from("ask_nac_files")
    .select("id,title,original_filename,report_type,search_status,chunk_count")
    .eq("status", "active")
    .or(orClause)
    .limit(20);
  if (error) throw new Error(error.message);
  const ranked = (data || [])
    .map((row) => ({
      row,
      score: scoreChunkRelevance(
        { chunk_text: String(row.original_filename || row.title || "") },
        queryContext,
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, 3).map((entry) => entry.row);
  return {
    fileIds: top.map((row) => String(row.id)),
    fileTitles: top.map((row) => String(row.title || row.original_filename || "Uploaded file")),
    files: top,
    source: "filename_match",
  };
}

function summarizeChunkSentence(chunkText = "") {
  const text = String(chunkText || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const sentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  return sentence.length > 220 ? `${sentence.slice(0, 219)}…` : sentence;
}

function buildDocumentSummaryAnswerContentEdge(
  chunks: Record<string, unknown>[],
  fileTitles: string[],
  branchLabel: string,
) {
  const names = [...new Set(fileTitles.length ? fileTitles : chunks.map((c) => String(c.fileTitle || "")))];
  const titleLabel = names.length ? names.join(" · ") : "uploaded document";
  const insights = chunks.map((chunk) => {
    const sentence = summarizeChunkSentence(String(chunk.chunkText || ""));
    const pageRef = chunk.pageNo != null ? ` (p. ${chunk.pageNo})` : "";
    const sectionRef = chunk.sectionLabel ? ` · ${chunk.sectionLabel}` : "";
    return `${chunk.fileTitle}${pageRef}${sectionRef}: ${sentence} [${chunk.citation}]`;
  });
  return {
    directAnswer:
      `Executive summary of ${titleLabel} from Company Knowledge (${chunks.length} section${chunks.length === 1 ? "" : "s"}, ${branchLabel}). ` +
      `${insights.slice(0, 2).join(" ")}`,
    insights,
    keyMetrics: chunks.slice(0, 8).map((chunk) =>
      metricEntry(String(chunk.fileTitle), summarizeChunkSentence(String(chunk.chunkText || "")), {
        unit: chunk.pageNo != null ? `p. ${chunk.pageNo}` : String(chunk.sectionLabel || ""),
        source: String(chunk.citation || ""),
      }),
    ),
    recommendations: [`Sources: ${[...new Set(chunks.map((c) => String(c.citation || "")))].slice(0, 5).join("; ")}`],
  };
}

export async function summarizeVaultDocuments(
  supabase: SupabaseClient,
  context: Record<string, unknown> = {},
) {
  const question = String(context.question || "");
  if (isVaultMonthlyOperationalSummaryQuery(question)) {
    const { fetchMonthlyLogbookOperationalReview } = await import("./vaultMonthlyLogbookQuery.ts");
    const structured = await fetchMonthlyLogbookOperationalReview(supabase, context);
    if (structured?.structuredLogbookReview) {
      return {
        ...structured,
        chunks: [],
        matches: [],
        fileIds: ((structured.vaultSources as Array<Record<string, unknown>>) || []).map((s) => s.fileId).filter(Boolean),
        fileTitles: ((structured.vaultSources as Array<Record<string, unknown>>) || []).map((s) => s.title).filter(Boolean),
      };
    }
  }

  const resolved = await resolveDocumentSummaryFilesEdge(supabase, context);
  if (!resolved.fileIds.length) {
    return {
      fileIds: [],
      fileTitles: [],
      chunks: [] as Record<string, unknown>[],
      matches: [] as Record<string, unknown>[],
      vaultSources: [],
      queryStatus: "no_document",
      sources: [{ name: "ask_nac_document_chunks", detail: "No uploaded document resolved for summary" }],
      warnings: [],
    };
  }

  const { data, error } = await supabase
    .from("ask_nac_document_chunks")
    .select(CHUNK_SELECT)
    .in("file_id", resolved.fileIds)
    .order("chunk_index", { ascending: true });

  if (error) {
    return {
      fileIds: resolved.fileIds,
      fileTitles: resolved.fileTitles,
      chunks: [] as Record<string, unknown>[],
      matches: [] as Record<string, unknown>[],
      vaultSources: [],
      queryStatus: "connection_error",
      searchError: error.message,
      sources: [{ name: "ask_nac_document_chunks", detail: "Chunk load failed" }],
      warnings: [],
    };
  }

  const chunks = (data || []).map((row) => mapVaultChunkMatchRow(row as Record<string, unknown>, resolved.fileTitles.join(" ")));
  const vaultSources = chunks.length
    ? [...new Map(chunks.map((m) => [m.fileId, { fileId: m.fileId, title: m.fileTitle }])).values()]
    : ((resolved.files as Record<string, unknown>[]) || []).map((file) => ({
      fileId: file.id,
      title: file.title || file.original_filename || "Uploaded file",
      reportType: file.report_type,
      chunkCount: file.chunk_count,
      searchStatus: file.search_status,
    }));
  return {
    fileIds: resolved.fileIds,
    fileTitles: resolved.fileTitles,
    chunks,
    matches: chunks,
    vaultSources,
    resolveSource: resolved.source,
    queryStatus: chunks.length ? "ok" : "no_chunks",
    sources: [{ name: "ask_nac_document_chunks", detail: "Uploaded document chunks (RLS-filtered)" }],
    warnings: [],
  };
}

// --- Answer builder (ported from vaultAnswerBuilder.js) ---

type MetricEntry = { label: string; value: unknown; unit?: string; source?: string; note?: string };
type AskNacAnswer = Record<string, unknown>;

function metricEntry(label: string, value: unknown, opts: { unit?: string; source?: string; note?: string } = {}): MetricEntry {
  return { label, value, unit: opts.unit || "", source: opts.source || "", note: opts.note || "" };
}

function sourceEntry(name: string, detail = "") {
  return { name, detail };
}

function formatNumber(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (Number.isFinite(n)) return n.toLocaleString();
  return String(value);
}

function vaultConfidence(tool: Record<string, unknown>) {
  const sources = (tool?.vaultSources as Record<string, unknown>[]) ||
    collectVaultSources(tool?.facts as Record<string, unknown>[] || [], tool?.coverage as Record<string, unknown>[] || []);
  const low = sources.some((s) => s.confidence != null && Number(s.confidence) < 0.55);
  const partial = (tool?.coverage as Record<string, unknown>[] || []).some((c) => c.readinessStatus === "partial");
  if (low || partial) return "medium";
  if (!(tool?.facts as unknown[])?.length) return "low";
  return "high";
}

function vaultSourceEntries(tool: Record<string, unknown>) {
  const files = (tool?.vaultSources as Record<string, unknown>[]) ||
    collectVaultSources(tool?.facts as Record<string, unknown>[] || [], tool?.coverage as Record<string, unknown>[] || []);
  return files.map((f) =>
    sourceEntry(String(f.title), [
      REPORT_LABELS[String(f.reportType)] || f.reportType || "vault",
      f.periodStart || f.periodEnd || null,
      "uploaded file",
    ].filter(Boolean).join(" · ")),
  );
}

function vaultFileChips(tool: Record<string, unknown>) {
  return ((tool?.vaultSources as Record<string, unknown>[]) ||
    collectVaultSources(tool?.facts as Record<string, unknown>[] || [], tool?.coverage as Record<string, unknown>[] || []))
    .map((f) => ({
      fileId: f.fileId,
      title: f.title,
      reportType: f.reportType,
      periodStart: f.periodStart,
      periodEnd: f.periodEnd,
      confidence: f.confidence,
      parserVersion: f.parserVersion,
    }));
}

function formatKnowledgeSource(item: Record<string, unknown> = {}) {
  const title = item.title || item.fileTitle || "Uploaded file";
  const reportType = item.reportType ? (REPORT_LABELS[String(item.reportType)] || String(item.reportType)) : null;
  const date = item.periodStart || item.periodEnd || item.date || null;
  return [title, date, reportType].filter(Boolean).join(" — ");
}

function buildKnowledgeSourceLines(items: Record<string, unknown>[] = []) {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const item of items) {
    const line = formatKnowledgeSource(item);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    lines.push(`• ${line}`);
    if (lines.length >= 8) break;
  }
  return lines;
}

function buildSourcesRecommendation(items: Record<string, unknown>[] = []) {
  const lines = buildKnowledgeSourceLines(items);
  return lines.length ? `Sources:\n${lines.join("\n")}` : null;
}

function baseVaultFields(route: Record<string, unknown>, tool: Record<string, unknown>, readiness: Record<string, unknown> | null) {
  const debug = route.debug as Record<string, unknown> | undefined;
  const vaultPeriod = route.vaultPeriod as VaultPeriod | undefined;
  return {
    branchLabel: tool?.branchLabel || debug?.branchLabel || null,
    periodLabel: tool?.periodLabel || vaultPeriod?.label || vaultPeriod?.startDate,
    confidence: vaultConfidence(tool),
    vaultSources: vaultFileChips(tool),
    sources: [
      ...vaultSourceEntries(tool),
      ...((tool?.sources as { name: string; detail?: string }[]) || []).map((s) => sourceEntry(s.name, s.detail)),
    ],
    warnings: [
      ...((tool?.warnings as string[]) || []),
      ...((readiness?.warnings as string[]) || []),
      ...(readiness?.status === "partial" ? (readiness?.reasons as string[]) || [] : []),
    ],
    isAiGenerated: false,
    intent: route.intent,
  };
}

function cashUpMetrics(facts: Record<string, unknown>[]) {
  const keys: [string, string, string][] = [
    ["total_sales", "Total sales", "SAR"],
    ["net_sales", "Net sales", "SAR"],
    ["guest_count", "Guest count", ""],
    ["order_count", "Order count", ""],
    ["avg_per_guest", "Average per guest", "SAR"],
  ];
  return keys
    .map(([key, label, unit]) => {
      const value = pickMetricValue(facts, key);
      if (value == null) return null;
      return metricEntry(label, formatNumber(value), { unit, source: "cash_up" });
    })
    .filter(Boolean) as MetricEntry[];
}

function receptionMetrics(facts: Record<string, unknown>[]) {
  const keys: [string, string][] = [
    ["reservations", "Reservations"],
    ["covers", "Covers"],
    ["walkins", "Walk-ins"],
    ["no_shows", "No-shows"],
    ["cancellations", "Cancellations"],
    ["final_covers", "Final covers"],
  ];
  return keys
    .map(([key, label]) => {
      const value = pickMetricValue(facts, key);
      if (value == null) return null;
      return metricEntry(label, formatNumber(value), { source: "reception / logbook" });
    })
    .filter(Boolean) as MetricEntry[];
}

function googleStarMetrics(facts: Record<string, unknown>[]) {
  return [1, 2, 3, 4, 5]
    .map((star) => {
      const value = pickMetricValue(facts, `google_review_${star}`);
      if (value == null) return null;
      return metricEntry(`${star}-star Google reviews`, formatNumber(value), { source: "logbook / reception" });
    })
    .filter(Boolean) as MetricEntry[];
}

function logbookNotes(facts: Record<string, unknown>[]) {
  const notes: string[] = [];
  const textKeys: [string, string][] = [
    ["mod_on_duty", "MOD on duty"],
    ["chef_on_duty", "Chef on duty"],
    ["complaints", "Complaints"],
    ["training_notes", "Training notes"],
    ["operational_issues", "Operational issues"],
    ["dinner_notes", "Dinner notes"],
  ];
  for (const [key, label] of textKeys) {
    const text = pickTextFact(facts, key);
    if (text) notes.push(`${label}: ${text}`);
  }
  return notes;
}

function ccmMetrics(facts: Record<string, unknown>[]) {
  const keys: [string, string, string][] = [
    ["ccm_expected", "CCM expected", "SAR"],
    ["ccm_actual", "CCM actual", "SAR"],
    ["ccm_difference", "CCM difference", "SAR"],
    ["reconciliation_status", "Reconciliation status", ""],
    ["payment_method_total", "Payment method total", "SAR"],
  ];
  return keys
    .map(([key, label, unit]) => {
      const value = pickMetricValue(facts, key);
      if (value == null) return null;
      return metricEntry(label, formatNumber(value), { unit, source: "ccm_reconciliation" });
    })
    .filter(Boolean) as MetricEntry[];
}

function buildVaultCoverageListAnswer(route: Record<string, unknown>, tool: Record<string, unknown>, readiness: Record<string, unknown> | null): AskNacAnswer {
  const rows = (tool?.coverage as Record<string, unknown>[]) || [];
  const directAnswer = rows.length
    ? `${rows.length} uploaded vault file coverage record(s) for ${tool.periodLabel || "the requested period"}.`
    : `No uploaded vault files cover ${tool.periodLabel || "the requested period"} under your access scope.`;

  return {
    ...baseVaultFields(route, tool, readiness),
    answerType: rows.length ? "comparison" : "missing_data",
    title: `Vault file coverage · ${tool.periodLabel || "period"}`,
    directAnswer,
    keyMetrics: rows.map((row) =>
      metricEntry(String(row.fileTitle || "Uploaded file"), row.factCount ?? "—", {
        unit: "facts",
        note: `${REPORT_LABELS[String(row.reportType)] || row.reportType} · ${row.readinessStatus || "registered"}`,
        source: String(row.sourceFileId || ""),
      }),
    ),
    insights: rows.map(
      (row) =>
        `${row.fileTitle}: ${REPORT_LABELS[String(row.reportType)] || row.reportType} (${row.periodStart} – ${row.periodEnd})`,
    ),
    recommendations: [],
    missingData: [],
    exportOptions: [],
  };
}

function resolveRouteQuestion(route: Record<string, unknown>) {
  const debug = route.debug as { nlu?: { normalizedQuestion?: string } } | undefined;
  return String(route.question || debug?.nlu?.normalizedQuestion || "");
}

function buildVaultCashUpAnswer(route: Record<string, unknown>, tool: Record<string, unknown>, readiness: Record<string, unknown> | null): AskNacAnswer {
  const facts = (tool?.facts as Record<string, unknown>[]) || [];
  const aggregation = tool?.aggregation as Record<string, unknown> | null | undefined;

  if (aggregation) {
    if ((aggregation.dayCount as number) === 0) {
      return {
        ...baseVaultFields(route, tool, readiness),
        answerType: "missing_data",
        title: `Cash-up · ${tool?.periodLabel || "query"}`,
        directAnswer: `No cash-up structured facts matched ${tool?.periodLabel || (route?.vaultPeriod as { label?: string })?.label || "the requested period"}.`,
        keyMetrics: [],
        insights: [],
        recommendations: [],
        missingData: [],
        exportOptions: [],
        warnings: (tool?.warnings as string[]) || [],
      };
    }

    const question = resolveRouteQuestion(route);
    const previousAggregation = tool.previousAggregation as Record<string, unknown> | null | undefined;
    const previousPeriodLabel = (tool.vaultCompare as { previous?: { label?: string } } | null)?.previous?.label || null;
    // Prefer the current window label — compare tool periodLabel is "current vs previous".
    const currentPeriodLabel = String(
      (tool.vaultCompare as { current?: { label?: string } } | null)?.current?.label
      || (route?.vaultPeriod as { label?: string } | undefined)?.label
      || tool.periodLabel
      || "the period",
    );

    const coverageAssessment = assessPeriodCoverage({
      requestedPeriod: (route?.vaultPeriod as { startDate?: string; endDate?: string; label?: string; periodType?: string }) || {
        startDate: tool?.startDate as string | undefined,
        endDate: tool?.endDate as string | undefined,
        label: currentPeriodLabel,
        periodType: (route?.vaultPeriod as { periodType?: string })?.periodType,
      },
      aggregation: aggregation as never,
    });
    const confidenceResult = resolveAnalyticalConfidence({ route, tool, coverageAssessment });

    let directAnswer = buildCashUpPeriodAggregateAnswer(question, aggregation as never, {
      branchLabel: String(tool.branchLabel || "Network"),
      periodLabel: currentPeriodLabel,
      previousAggregation: (previousAggregation as never) || null,
      previousPeriodLabel,
    });
    directAnswer = appendCoverageToAggregateAnswer(
      directAnswer,
      question,
      aggregation as never,
      (route?.vaultPeriod as { label?: string; periodType?: string }) || { label: String(tool.periodLabel || ""), periodType: (route?.vaultPeriod as { periodType?: string })?.periodType },
    ) || directAnswer;

    const isPlatformQuery = isDeliveryPlatformPeriodQuery(question) && !previousAggregation;
    const isPerformanceOverview =
      Boolean(route.performanceOverview)
      || scoreSalesPerformanceQueryFocus(question) === "performance_overview";
    const metrics: MetricEntry[] = previousAggregation && !isPerformanceOverview
      ? buildCashUpPeriodCompareMetrics(aggregation as never, previousAggregation as never)
      : isPlatformQuery
        ? buildCashUpDeliveryPlatformMetrics(aggregation as never, question)
        : [];
    if (!isPlatformQuery && (!previousAggregation || isPerformanceOverview)) {
    if (aggregation.totalSales != null) {
      metrics.push(metricEntry("Total sales", formatNumber(aggregation.totalSales), { unit: "SAR", source: "cash_up" }));
      if ((aggregation.dayCount as number) > 0) {
        metrics.push(metricEntry(
          "Average sales per day",
          formatNumber(Number(aggregation.totalSales) / Number(aggregation.dayCount)),
          { unit: "SAR", source: "cash_up" },
        ));
      }
    }
    if (aggregation.totalGuests != null) {
      metrics.push(metricEntry("Total guests", formatNumber(aggregation.totalGuests), { source: "cash_up" }));
    }
    if (aggregation.totalOrders != null) {
      metrics.push(metricEntry("Total orders", formatNumber(aggregation.totalOrders), { source: "cash_up" }));
    }
    if (aggregation.averageSpend != null) {
      metrics.push(metricEntry("Average spend", formatNumber(aggregation.averageSpend), { unit: "SAR", source: "cash_up" }));
    }
    if (!isPerformanceOverview && aggregation.totalDeliverySales != null) {
      metrics.push(metricEntry("Total delivery sales", formatNumber(aggregation.totalDeliverySales), { unit: "SAR", source: "cash_up" }));
      if ((aggregation.dayCount as number) > 0) {
        metrics.push(metricEntry(
          "Average delivery sales per day",
          formatNumber(Number(aggregation.totalDeliverySales) / Number(aggregation.dayCount)),
          { unit: "SAR", source: "cash_up" },
        ));
      }
    }
    if (!isPerformanceOverview && aggregation.totalDeliveryOrders != null) {
      metrics.push(metricEntry("Total delivery orders", formatNumber(aggregation.totalDeliveryOrders), { source: "cash_up" }));
    }
    metrics.push(metricEntry("Days included", formatNumber(aggregation.dayCount), { source: "cash_up" }));
    if (previousAggregation && isPerformanceOverview) {
      metrics.push(...buildCashUpPeriodCompareMetrics(aggregation as never, previousAggregation as never).filter(
        (row) => !metrics.some((m) => m.label === row.label),
      ));
    }
    }

    const platformBreakdown = aggregation.deliveryPlatformBreakdown as Record<string, { sales?: number; orders?: number }> | undefined;
    const platformInsights = isPlatformQuery && platformBreakdown
      ? Object.keys(platformBreakdown)
        .sort((a, b) => (platformBreakdown[b]?.sales || 0) - (platformBreakdown[a]?.sales || 0))
        .map((key) => {
          const row = platformBreakdown[key];
          return `${key}: ${formatNumber(row.sales ?? null)} SAR sales, ${formatNumber(row.orders ?? null)} orders`;
        })
      : [];

    const dailyBreakdown = (aggregation.dailyBreakdown as { date: string; totalSales?: number | null }[]) || [];

    const coverageWarnings = [
      ...((tool?.warnings as string[]) || []),
      ...coverageAssessment.coverageNotes.filter(
        (note) => !((tool?.warnings as string[]) || []).some((w) => String(w).includes(note.slice(0, 24))),
      ),
    ];

    return {
      ...baseVaultFields(route, tool, readiness),
      answerType: metrics.length ? "metric" : "executive",
      title: isPlatformQuery
        ? `Delivery platform breakdown · ${currentPeriodLabel}`
        : (route.performanceOverview || scoreSalesPerformanceQueryFocus(question) === "performance_overview")
          ? `Performance overview · ${currentPeriodLabel}`
          : previousAggregation
            ? `Period comparison · ${currentPeriodLabel}`
            : `Sales performance · ${currentPeriodLabel}`,
      directAnswer: directAnswer || `Cash-up aggregation for ${currentPeriodLabel}.`,
      keyMetrics: metrics,
      insights: [
        ...(isPlatformQuery
          ? platformInsights
          : dailyBreakdown.slice(0, 7).map(
            (row) => `${row.date}: ${row.totalSales != null ? `${formatNumber(row.totalSales)} SAR` : "sales n/a"}`,
          )),
        ...buildCoverageAnswerLines(coverageAssessment).filter(
          (line) => !String(directAnswer || "").includes(line.slice(0, 20)),
        ),
      ],
      recommendations: [],
      missingData: [],
      exportOptions: [],
      warnings: coverageWarnings,
      confidence: confidenceResult.level,
      dataConfidence: confidenceResult.dataConfidence,
      conversationDataset: {
        kind: "cash_up_aggregation",
        reportType: "cash_up",
        metric: "net_sales",
        aggregation: {
          totalSales: aggregation.totalSales ?? null,
          totalGuests: aggregation.totalGuests ?? null,
          totalDeliverySales: aggregation.totalDeliverySales ?? null,
          totalDeliveryOrders: aggregation.totalDeliveryOrders ?? null,
          averageSpend: aggregation.averageSpend ?? null,
          dayCount: aggregation.dayCount ?? null,
          dailyBreakdown,
          deliveryPlatformBreakdown: aggregation.deliveryPlatformBreakdown ?? null,
        },
        dailyBreakdown,
      },
      vaultPeriod: (route?.vaultPeriod as Record<string, unknown>) || null,
    };
  }

  if (tool?.queryStatus === "connection_error") {
    return {
      ...baseVaultFields(route, tool, readiness),
      answerType: "missing_data",
      title: `Cash-up · ${tool?.periodLabel || "query"}`,
      directAnswer: `I could not query cash-up facts because the vault database returned an error: ${tool.searchError || "connection failed"}.`,
      keyMetrics: [],
      insights: [],
      recommendations: [],
      missingData: [],
      exportOptions: [],
      warnings: ["This is a real database/query failure, not a missing cash-up report."],
    };
  }
  if (!facts.length) {
    const hasReport = Boolean(((tool?.vaultSources as unknown[]) || []).length || ((tool?.coverage as unknown[]) || []).length);
    const routePeriod = route?.vaultPeriod as { startDate?: string; label?: string } | undefined;
    const askedForDate = Boolean(routePeriod?.startDate || tool?.startDate);
    const directAnswer = hasReport
      ? "Cash-up report exists, but it contains no extracted sales fields for this request."
      : askedForDate
        ? `No cash-up report matched ${tool?.periodLabel || routePeriod?.label || "that date"}.`
        : "No cash-up reports are available in Company Knowledge yet.";
    return {
      ...baseVaultFields(route, tool, readiness),
      answerType: "missing_data",
      title: `Cash-up · ${tool?.periodLabel || "query"}`,
      directAnswer,
      keyMetrics: [],
      insights: [],
      recommendations: [],
      missingData: [],
      exportOptions: [],
      warnings: hasReport
        ? ["The file is reachable, but structured cash-up fields were not extracted."]
        : ["No cash_up coverage row was found under the current branch/access scope."],
    };
  }
  const fileTitle = String((tool?.vaultSources as Record<string, unknown>[])?.[0]?.title || "") || null;
  const executive = buildSalesPerformanceExecutiveSummary(facts, {
    branchLabel: String(tool.branchLabel || "Network"),
    periodLabel: String(tool.periodLabel || "the period"),
    fileTitle,
    question: String(route.question || ""),
  });
  const metrics = extendedSalesPerformanceMetrics(facts).map((row) =>
    metricEntry(row.label, row.value, { unit: row.unit, source: "sales_performance" }),
  );

  const relatedFindings = [
    ...executive.performanceBreakdown.map((p) => ({
      fileTitle: executive.source,
      excerpt: `${p.label}: ${p.value}${p.unit ? ` ${p.unit}` : ""}`,
    })),
    ...(executive.reconciliationNote
      ? [{ fileTitle: executive.source, excerpt: executive.reconciliationNote }]
      : []),
  ];

  const managerDirectAnswer = formatManagerStyleAnswer({
    answer: executive.answer,
    managementNote: executive.managementNote,
    source: executive.source,
    relatedFindings,
    confidence: metrics.length ? "high" : executive.missingFields.length ? "medium" : "low",
  });

  const executiveBrief = buildCashUpExecutiveBrief({
    facts,
    branchLabel: String(tool.branchLabel || "Network"),
    periodLabel: String(tool.periodLabel || "the period"),
    businessDate: String(
      tool.startDate
      || tool.periodEnd
      || (facts[0]?.period_end as string)
      || (facts[0]?.periodEnd as string)
      || "",
    ) || null,
    fileTitle,
    vaultSources: (tool?.vaultSources as Record<string, unknown>[]) || [],
    coverage: (tool?.coverage as Record<string, unknown>[]) || [],
    question: String(route.question || ""),
  });

  const directAnswer = coercePlainTextDirectAnswer(
    executiveBrief?.executiveSummary || managerDirectAnswer,
    { executiveBrief },
  ) || managerDirectAnswer;

  return {
    ...baseVaultFields(route, tool, readiness),
    answerType: metrics.length ? "executive" : "missing_data",
    title: `Sales performance · ${tool.periodLabel}`,
    directAnswer,
    executiveBrief,
    keyMetrics: metrics,
    insights: [
      ...(executive.risks || []),
      ...(executive.actions || []).map((a: string) => `Action: ${a}`),
      ...(executive.missingFields.length
        ? [`Missing fields: ${executive.missingFields.join(", ")}`]
        : []),
    ],
    recommendations: [],
    missingData: [],
    exportOptions: [],
    warnings: [
      ...((tool?.warnings as string[]) || []),
      ...(executive.missingFields.length
        ? [`Sales report missing: ${executive.missingFields.join(", ")}`]
        : []),
    ],
  };
}

function buildVaultOperationalReviewAnswer(
  route: Record<string, unknown>,
  tool: Record<string, unknown>,
  readiness: Record<string, unknown> | null,
): AskNacAnswer {
  const monthlySummary = tool?.monthlyLogbookSummary as Record<string, unknown> | undefined;
  if (monthlySummary) {
    return {
      ...baseVaultFields(route, tool, readiness),
      answerType: "executive",
      title: String(monthlySummary.title || `Operational summary · ${tool.periodLabel || "period"}`),
      directAnswer: String(monthlySummary.directAnswer || ""),
      keyMetrics: ((monthlySummary.keyMetrics as Array<Record<string, unknown>>) || []).map((m) =>
        metricEntry(String(m.label), String(m.value), { note: "daily_logbook structured facts" }),
      ),
      insights: (monthlySummary.insights as string[]) || [],
      recommendations: (monthlySummary.recommendations as string[]) || [],
      confidence: String(monthlySummary.confidence || "low"),
      isAiGenerated: false,
      intent: route.intent,
      branchLabel: tool?.branchLabel,
      vaultSources: (tool?.vaultSources as unknown[]) || monthlySummary.vaultSources || [],
      missingData: [],
      exportOptions: [],
      warnings: Number(monthlySummary.logbookDays || 0) < 10
        ? [`Only ${monthlySummary.logbookDays} logbook day(s) covered for this month.`]
        : [],
    };
  }

  const grouped = (tool?.groupedFindings as Record<string, unknown>[]) || [];
  const theme = String(tool?.reviewTheme || "general");
  const synthesis = buildCrossDocumentOperationalSummary(grouped, theme);
  const sourcesBlock = buildSourcesRecommendation(grouped);

  const directAnswer = formatManagerStyleAnswer({
    answer: synthesis.answer,
    managementNote: synthesis.managementNote,
    source: synthesis.source || "Uploaded logbooks",
    relatedFindings: synthesis.relatedFindings as { fileTitle?: string; excerpt?: string }[],
    confidence: grouped.length >= 3 ? "high" : grouped.length ? "medium" : "low",
  });

  return {
    ...baseVaultFields(route, tool, readiness),
    answerType: grouped.length ? "executive" : "document_no_match",
    title: `Operational review · ${tool.periodLabel || theme}`,
    directAnswer,
    keyMetrics: grouped.slice(0, 8).map((item) =>
      metricEntry(String(item.date || item.fileTitle), String(item.excerpt || "").slice(0, 100), {
        note: `${item.issueType} · ${item.severity}`,
        source: String(item.source || ""),
      }),
    ),
    insights: grouped.slice(0, 8).map(
      (item) => `${item.date || item.fileTitle} · ${item.issueType}: ${item.excerpt} [${item.source}]`,
    ),
    recommendations: [
      grouped.length ? `Review ${grouped.length} finding(s) across uploaded logbooks.` : null,
      sourcesBlock,
    ].filter(Boolean),
    missingData: [],
    exportOptions: [],
    searchTerms: tool?.searchTerms,
  };
}

function buildVaultReceptionAnswer(route: Record<string, unknown>, tool: Record<string, unknown>, readiness: Record<string, unknown> | null): AskNacAnswer {
  const facts = (tool?.facts as Record<string, unknown>[]) || [];
  const metrics = receptionMetrics(facts);
  const reservations = pickMetricValue(facts, "reservations");
  const directAnswer = reservations != null
    ? `Reception/logbook vault data: ${formatNumber(reservations)} reservations for ${tool.branchLabel} on ${tool.periodLabel}.`
    : `No reception or logbook reservation metrics found for ${tool.branchLabel} on ${tool.periodLabel}.`;

  return {
    ...baseVaultFields(route, tool, readiness),
    answerType: metrics.length ? "metric" : "missing_data",
    title: `Reception · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: metrics,
    insights: [],
    recommendations: [],
    missingData: [],
    exportOptions: [],
  };
}

function buildVaultDailyBriefingAnswer(route: Record<string, unknown>, tool: Record<string, unknown>, readiness: Record<string, unknown> | null): AskNacAnswer {
  const facts = (tool?.facts as Record<string, unknown>[]) || [];
  const metrics = briefingMetrics(facts);
  const notes = briefingNotes(facts);
  const directAnswer = notes.length
    ? `Daily briefing for ${tool.branchLabel} · ${tool.periodLabel}: ${notes[0]}`
    : metrics.length
      ? `Daily briefing metrics for ${tool.branchLabel} · ${tool.periodLabel} are listed below.`
      : `No daily briefing structured facts found for ${tool.branchLabel} on ${tool.periodLabel}.`;

  return {
    ...baseVaultFields(route, tool, readiness),
    answerType: metrics.length || notes.length ? "metric" : "missing_data",
    title: `Daily briefing · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: metrics,
    insights: notes,
    recommendations: [],
    missingData: [],
    exportOptions: [],
  };
}

function briefingMetrics(facts: Record<string, unknown>[] = []) {
  const keys = ["breakfast_reservations", "lunch_reservations", "dinner_reservations", "mod_breakfast", "mod_lunch", "mod_dinner"];
  return keys
    .map((key) => {
      const value = pickMetricValue(facts, key);
      if (value == null) return null;
      return { label: key.replace(/_/g, " "), value: String(value) };
    })
    .filter(Boolean) as Array<{ label: string; value: string }>;
}

function briefingNotes(facts: Record<string, unknown>[] = []) {
  return facts
    .filter((fact) => String(fact.metric_key || "").includes("_line"))
    .map((fact) => {
      const dims = fact.dimensions as Record<string, unknown> | undefined;
      return dims?.text_value ? String(dims.text_value) : null;
    })
    .filter(Boolean)
    .slice(0, 8) as string[];
}

function buildVaultLogbookAnswer(route: Record<string, unknown>, tool: Record<string, unknown>, readiness: Record<string, unknown> | null): AskNacAnswer {
  const facts = (tool?.facts as Record<string, unknown>[]) || [];
  const metrics = receptionMetrics(facts);
  const notes = logbookNotes(facts);
  const directAnswer = notes.length
    ? `Logbook notes for ${tool.branchLabel} on ${tool.periodLabel}: ${notes[0]}`
    : metrics.length
      ? `Logbook operational metrics for ${tool.branchLabel} on ${tool.periodLabel} are listed below.`
      : `No logbook structured facts found for ${tool.branchLabel} on ${tool.periodLabel}.`;

  return {
    ...baseVaultFields(route, tool, readiness),
    answerType: metrics.length || notes.length ? "metric" : "missing_data",
    title: `Logbook · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: metrics,
    insights: notes,
    recommendations: [],
    missingData: [],
    exportOptions: [],
  };
}

function buildVaultGoogleStarsAnswer(route: Record<string, unknown>, tool: Record<string, unknown>, readiness: Record<string, unknown> | null): AskNacAnswer {
  const facts = (tool?.facts as Record<string, unknown>[]) || [];
  const metrics = googleStarMetrics(facts);
  const five = pickMetricValue(facts, "google_review_5");
  const directAnswer = five != null
    ? `${tool.branchLabel} recorded ${formatNumber(five)} five-star Google reviews on ${tool.periodLabel} (from uploaded logbook/reception files).`
    : `No Google review star counts found in vault files for ${tool.branchLabel} on ${tool.periodLabel}.`;

  return {
    ...baseVaultFields(route, tool, readiness),
    answerType: metrics.length ? "metric" : "missing_data",
    title: `Google review stars · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: metrics,
    insights: [],
    recommendations: [],
    missingData: [],
    exportOptions: [],
  };
}

function buildVaultCcmAnswer(route: Record<string, unknown>, tool: Record<string, unknown>, readiness: Record<string, unknown> | null): AskNacAnswer {
  const facts = (tool?.facts as Record<string, unknown>[]) || [];
  const metrics = ccmMetrics(facts);
  const status = pickMetricValue(facts, "reconciliation_status");
  const directAnswer = status != null
    ? `CCM reconciliation status for ${tool.branchLabel} on ${tool.periodLabel}: ${status}.`
    : metrics.length
      ? `CCM reconciliation metrics for ${tool.branchLabel} on ${tool.periodLabel} are listed below.`
      : `No CCM reconciliation facts found for ${tool.branchLabel} on ${tool.periodLabel}.`;

  return {
    ...baseVaultFields(route, tool, readiness),
    answerType: metrics.length ? "metric" : "missing_data",
    title: `CCM reconciliation · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: metrics,
    insights: [],
    recommendations: [],
    missingData: [],
    exportOptions: [],
  };
}

function buildVaultOperationalDayAnswer(route: Record<string, unknown>, tool: Record<string, unknown>, readiness: Record<string, unknown> | null): AskNacAnswer {
  const byReport = (tool?.byReport as Record<string, Record<string, unknown>[]>) ||
    groupFactsByReportType((tool?.facts as Record<string, unknown>[]) || []);
  const cashFacts = byReport.cash_up || [];
  const receptionFacts = [...(byReport.reception_daily_report || []), ...(byReport.daily_logbook || [])];
  const logbookFacts = byReport.daily_logbook || [];
  const ccmFacts = byReport.ccm_reconciliation || [];

  const keyMetrics = [
    ...cashUpMetrics(cashFacts),
    ...receptionMetrics(receptionFacts),
    ...googleStarMetrics([...receptionFacts, ...logbookFacts]),
    ...ccmMetrics(ccmFacts),
  ];
  const notes = logbookNotes(logbookFacts);
  const sections: string[] = [];
  if (cashFacts.length) sections.push("sales performance and guest counts");
  if (receptionFacts.length) sections.push("reception reservations and covers");
  if (logbookFacts.some((f) => String(f.metricKey).startsWith("google_review_"))) sections.push("Google review star counts");
  if (notes.length) sections.push("operational logbook notes");
  if (ccmFacts.length) sections.push("CCM reconciliation");

  const directAnswer = keyMetrics.length || notes.length
    ? `Operational summary for ${tool.branchLabel} on ${tool.periodLabel}${sections.length ? `: ${sections.join("; ")}` : "."} All figures are from uploaded vault files only.`
    : `No vault structured facts cover ${tool.branchLabel} on ${tool.periodLabel} under your access scope.`;

  return {
    ...baseVaultFields(route, tool, readiness),
    answerType: keyMetrics.length || notes.length ? "comparison" : "missing_data",
    title: `Operational day · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics,
    insights: notes,
    recommendations: (tool?.vaultSources as Record<string, unknown>[])?.length
      ? [`Source files: ${(tool.vaultSources as Record<string, unknown>[]).map((s) => s.title).join(" · ")}`]
      : [],
    missingData: [],
    exportOptions: [],
  };
}

function buildVaultManagementReportAnswer(route: Record<string, unknown>, tool: Record<string, unknown>, readiness: Record<string, unknown> | null): AskNacAnswer {
  const dayAnswer = buildVaultOperationalDayAnswer(route, tool, readiness);
  return {
    ...dayAnswer,
    title: `Management report · ${tool.periodLabel}`,
    directAnswer: `Management report for ${tool.branchLabel} on ${tool.periodLabel} (Data Vault only — no live POS estimates). ${dayAnswer.directAnswer}`,
    insights: [
      ...((dayAnswer.insights as string[]) || []),
      "Figures are deterministic from ask_nac_structured_facts; missing sections were omitted rather than estimated.",
    ],
  };
}

function buildVaultDriveDiscoveryAnswer(
  route: Record<string, unknown>,
  tool: Record<string, unknown>,
  readiness: Record<string, unknown> | null,
): AskNacAnswer {
  const lines = (tool?.answerLines as string[]) || ["Drive discovery completed."];
  const summary = (tool?.summary as Record<string, unknown>) || {};
  return {
    ...baseVaultFields(route, tool, readiness),
    answerType: "executive",
    title: route.intent === VAULT_INTENTS.DRIVE_APPROVE_RULES
      ? "Drive ingestion rules updated"
      : "Drive folder discovery",
    directAnswer: lines.join("\n"),
    keyMetrics: [
      { label: "Discovered folders", value: String(summary.discoveredFolders ?? 0) },
      { label: "Needs approval", value: String(summary.needsApprovalCount ?? 0) },
      { label: "Approved ingest", value: String(summary.approvedIngestCount ?? 0) },
      { label: "Ignored", value: String(summary.ignoredCount ?? 0) },
    ],
    insights: lines.slice(2),
    confidence: "high",
    isAiGenerated: false,
    intent: route.intent,
    branchLabel: tool?.branchLabel as string | undefined,
    vaultSources: [],
  };
}

function buildVaultMissingToolResponse(route: Record<string, unknown>, _tool: Record<string, unknown>, readiness: Record<string, unknown> | null): AskNacAnswer {
  const vaultPeriod = route.vaultPeriod as VaultPeriod | undefined;
  return {
    answerType: "missing_data",
    title: "Vault data not available",
    directAnswer:
      (readiness?.reasons as string[])?.[0] ||
      `No uploaded vault coverage matches ${vaultPeriod?.label || "this period"} for the required report types.`,
    keyMetrics: [],
    insights: [],
    recommendations: [],
    sources: [],
    warnings: (readiness?.reasons as string[]) || [],
    missingData: (readiness?.missingData as unknown[]) || [],
    confidence: "none",
    exportOptions: [],
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: vaultPeriod?.label,
    vaultSources: [],
    readiness,
  };
}

export function buildVaultAnswer(
  route: Record<string, unknown>,
  tool: Record<string, unknown> | null,
  readiness: Record<string, unknown> | null = null,
): AskNacAnswer {
  const documentFallback = tool?.documentFallback as Record<string, unknown> | undefined;
  if ((documentFallback?.matches as unknown[])?.length) {
    return buildVaultAnswer(
      { ...route, intent: VAULT_INTENTS.DOCUMENT_SEARCH },
      documentFallback,
      readiness,
    );
  }

  if (route.intent === VAULT_INTENTS.DOCUMENT_SUMMARY) {
    if (tool?.monthlyLogbookSummary) {
      return buildVaultOperationalReviewAnswer(route, tool, readiness);
    }
    const chunks = (tool?.chunks as Record<string, unknown>[]) || (tool?.matches as Record<string, unknown>[]) || [];
    const queryStatus = String(tool?.queryStatus || "");
    if (queryStatus === "connection_error") {
      return {
        answerType: "error",
        title: "Document summary",
        directAnswer: DOCUMENT_SEARCH_MESSAGES.CONNECTION_FAILED,
        keyMetrics: [],
        insights: [],
        confidence: "none",
        isAiGenerated: false,
        intent: route.intent,
        warnings: tool?.searchError ? [String(tool.searchError)] : [],
      };
    }
    if (!chunks.length) {
      return {
        answerType: "document_no_match",
        title: "Document summary",
        directAnswer: queryStatus === "no_document"
          ? "No uploaded document was found to summarize under your access scope."
          : queryStatus === "no_chunks"
            ? `The document was found (${((tool?.fileTitles as string[]) || []).join(" · ") || "uploaded file"}), but no searchable text chunks are available for Ask NAC to summarize.`
            : DOCUMENT_SEARCH_MESSAGES.NO_MATCH,
        keyMetrics: [],
        insights: [],
        confidence: "low",
        isAiGenerated: false,
        intent: route.intent,
        vaultSources: tool?.vaultSources || [],
        warnings: queryStatus === "no_chunks"
          ? ["Document metadata was found, but searchable chunk text is missing or empty."]
          : [],
      };
    }
    const summary = buildDocumentSummaryAnswerContentEdge(
      chunks,
      (tool?.fileTitles as string[]) || [],
      String(tool?.branchLabel || "Network"),
    );
    return {
      answerType: "executive",
      title: `Document summary · ${(tool?.fileTitles as string[])?.[0] || chunks[0]?.fileTitle || "Uploaded document"}`,
      directAnswer: summary.directAnswer,
      keyMetrics: summary.keyMetrics,
      insights: summary.insights,
      recommendations: summary.recommendations,
      confidence: "high",
      isAiGenerated: false,
      intent: route.intent,
      vaultSources: tool?.vaultSources || [],
    };
  }

  if (route.intent === VAULT_INTENTS.DOCUMENT_SEARCH) {
    const matches = (tool?.matches as unknown[]) || [];
    const searchTerms = String(tool?.searchTerms || extractDocumentSearchTerms(String(route.question || "")));
    const queryStatus = String(tool?.queryStatus || "");

    if (queryStatus === DOCUMENT_SEARCH_STATUS.CONNECTION_ERROR) {
      return {
        answerType: "error",
        title: "Document search",
        directAnswer: DOCUMENT_SEARCH_MESSAGES.CONNECTION_FAILED,
        keyMetrics: [],
        insights: [],
        confidence: "none",
        isAiGenerated: false,
        intent: route.intent,
        warnings: tool?.searchError ? [String(tool.searchError)] : [],
      };
    }

    if (queryStatus === DOCUMENT_SEARCH_STATUS.AUTH_ERROR) {
      return {
        answerType: "error",
        title: "Document search",
        directAnswer: DOCUMENT_SEARCH_MESSAGES.AUTH_FAILED,
        keyMetrics: [],
        insights: [],
        confidence: "none",
        isAiGenerated: false,
        intent: route.intent,
        warnings: tool?.searchError ? [String(tool.searchError)] : [],
      };
    }

    if (!matches.length) {
      return {
        answerType: "document_no_match",
        title: "Document search",
        directAnswer: DOCUMENT_SEARCH_MESSAGES.NO_MATCH,
        keyMetrics: [],
        insights: [],
        confidence: "low",
        isAiGenerated: false,
        intent: route.intent,
        warnings: [],
        searchMethod: tool?.searchMethod || null,
      };
    }
    const fileNames = [...new Set(matches.map((m) => (m as Record<string, unknown>).fileTitle))];
    const sourcesBlock = buildSourcesRecommendation(matches as Record<string, unknown>[]);
    const manager = buildOperationalManagerAnswer(searchTerms, matches as Record<string, unknown>[]);
    const operationalAnswer = manager
      ? formatManagerStyleAnswer({
          answer: String(manager.answer || ""),
          managementNote: manager.managementNote as string | null,
          source: manager.source as string | null,
          relatedFindings: (manager.relatedFindings as { fileTitle?: string; excerpt?: string }[]) || [],
          confidence: assessSearchMatchConfidence(matches as Record<string, unknown>[], searchTerms),
        })
      : buildOperationalSearchDirectAnswer(
          searchTerms,
          matches as Record<string, unknown>[],
        );
    const confidenceLevel = assessSearchMatchConfidence(matches as Record<string, unknown>[], searchTerms);
    return {
      answerType: "comparison",
      title: `Document search · “${searchTerms}”`,
      directAnswer:
        operationalAnswer ||
        `Found ${matches.length} mention${matches.length === 1 ? "" : "s"} of “${searchTerms}” across ${fileNames.length} file${fileNames.length === 1 ? "" : "s"}.`,
      keyMetrics: matches.slice(0, 8).map((m) => {
        const row = m as Record<string, unknown>;
        return metricEntry(String(row.fileTitle), row.excerpt, {
          unit: row.pageNo != null ? `p. ${row.pageNo}` : String(row.sectionLabel || ""),
          source: String(row.citation || ""),
        });
      }),
      insights: [
        ...matches.slice(0, 5).map((m) => {
          const row = m as Record<string, unknown>;
          return `${row.fileTitle}${row.pageNo != null ? ` (p. ${row.pageNo})` : ""}${row.sectionLabel ? ` · ${row.sectionLabel}` : ""}: “${row.excerpt}” [${row.citation}]`;
        }),
        ...((manager?.relatedFindings as Record<string, unknown>[]) || []).map(
          (item) => `Related: ${item.fileTitle}${item.sectionLabel ? ` · ${item.sectionLabel}` : ""} — ${item.excerpt}`,
        ),
      ],
      recommendations: [
        sourcesBlock,
        `Citations: ${matches.slice(0, 5).map((m) => String((m as Record<string, unknown>).citation || "")).join("; ")}`,
      ].filter(Boolean),
      confidence: confidenceLevel === "high" ? "high" : confidenceLevel === "medium" ? "medium" : "low",
      isAiGenerated: false,
      intent: route.intent,
      vaultSources: tool?.vaultSources || [],
      searchMethod: tool?.searchMethod || "fts",
    };
  }

  if (route.intent === VAULT_INTENTS.OPERATIONAL_REVIEW) {
    return buildVaultOperationalReviewAnswer(route, tool || {}, readiness);
  }

  if (route.intent === VAULT_INTENTS.BUSINESS_REASONING) {
    return buildVaultBusinessReasoningAnswer(route, tool || {}, readiness);
  }

  if (route.intent === VAULT_INTENTS.TEACH_OPERATOR) {
    return buildTeachOperatorAnswer(route, tool || {}, readiness);
  }

  if (route.intent === VAULT_INTENTS.KNOWLEDGE_HEALTH) {
    return buildKnowledgeHealthAnswer(route, tool || {}, readiness);
  }

  if (route.intent === VAULT_INTENTS.WEEKLY_DASHBOARD || route.intent === VAULT_INTENTS.PROVIDE_MANUAL_INPUT) {
    return buildWeeklyDashboardAnswer(route, tool || {}, readiness);
  }

  if (route.intent === VAULT_INTENTS.DRIVE_DISCOVER || route.intent === VAULT_INTENTS.DRIVE_APPROVE_RULES) {
    return buildVaultDriveDiscoveryAnswer(route, tool || {}, readiness);
  }

  if (route.intent === VAULT_INTENTS.BREAKAGE) {
    const matches = (tool?.matches as unknown[]) || [];
    if (matches.length) {
      return buildVaultAnswer(
        { ...route, intent: VAULT_INTENTS.DOCUMENT_SEARCH },
        tool || {},
        readiness,
      );
    }
    return buildVaultMissingToolResponse(route, tool || {}, readiness);
  }

  if (route.intent === VAULT_INTENTS.DAILY_BRIEFING) {
    return buildVaultDailyBriefingAnswer(route, tool || {}, readiness);
  }

  const facts = tool?.facts as unknown[] | undefined;
  const coverage = tool?.coverage as unknown[] | undefined;
  const aggregationDayCount = (tool?.aggregation as { dayCount?: number } | undefined)?.dayCount;
  if (
    !facts?.length
    && !coverage?.length
    && !aggregationDayCount
    && tool?.status !== "pending"
    && tool?.status !== "complete"
    && readiness?.status === "missing"
  ) {
    return buildVaultMissingToolResponse(route, tool || {}, readiness);
  }

  switch (route.intent) {
    case VAULT_INTENTS.COVERAGE_LIST:
      return buildVaultCoverageListAnswer(route, tool || {}, readiness);
    case VAULT_INTENTS.CASH_UP:
      return buildVaultCashUpAnswer(route, tool || {}, readiness);
    case VAULT_INTENTS.RECEPTION:
      return buildVaultReceptionAnswer(route, tool || {}, readiness);
    case VAULT_INTENTS.LOGBOOK:
      return buildVaultLogbookAnswer(route, tool || {}, readiness);
    case VAULT_INTENTS.DAILY_BRIEFING:
      return buildVaultDailyBriefingAnswer(route, tool || {}, readiness);
    case VAULT_INTENTS.GOOGLE_STARS:
      return buildVaultGoogleStarsAnswer(route, tool || {}, readiness);
    case VAULT_INTENTS.CCM:
      return buildVaultCcmAnswer(route, tool || {}, readiness);
    case VAULT_INTENTS.OPERATIONAL_DAY:
      return buildVaultOperationalDayAnswer(route, tool || {}, readiness);
    case VAULT_INTENTS.MANAGEMENT_REPORT:
      return buildVaultManagementReportAnswer(route, tool || {}, readiness);
    default:
      return buildVaultMissingToolResponse(route, tool || {}, readiness);
  }
}

export function isVaultDataIntent(intent: string) {
  return (
    Object.values(VAULT_INTENTS).includes(intent as typeof VAULT_INTENTS[keyof typeof VAULT_INTENTS]) &&
    intent !== VAULT_INTENTS.DOCUMENT_SEARCH &&
    intent !== VAULT_INTENTS.DOCUMENT_SUMMARY &&
    intent !== VAULT_INTENTS.OPERATIONAL_REVIEW
  );
}

export function isVaultDocumentSearchIntent(intent: string) {
  return intent === VAULT_INTENTS.DOCUMENT_SEARCH;
}

export function isVaultDocumentSummaryIntent(intent: string) {
  return intent === VAULT_INTENTS.DOCUMENT_SUMMARY;
}

export function isVaultDocumentIntent(intent: string) {
  return isVaultDocumentSearchIntent(intent) || isVaultDocumentSummaryIntent(intent) || intent === VAULT_INTENTS.OPERATIONAL_REVIEW;
}
