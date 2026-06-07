/**
 * Ask NAC Data Vault query tools + deterministic answer builder (Edge).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { branchDisplayName } from "./askNacFoodicsTools.ts";

const FACT_SELECT =
  "id,file_id,branch_id,brand_wide,department,report_type,sensitivity_level,metric_key,metric_value,metric_unit,dimensions,period_start,period_end,grain,confidence,created_at,file:ask_nac_files(id,title,original_filename,classification_confidence,parser_version,sensitivity_level)";

const COVERAGE_SELECT =
  "id,branch_id,brand_wide,department,report_type,period_start,period_end,fact_count,readiness_status,last_ingested_at,source_file_id,source_file:ask_nac_files(id,title,original_filename,report_type,classification_confidence,parser_version,sensitivity_level)";

const MONTH_MAP: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
};

export type VaultPeriod = {
  startDate: string;
  endDate: string;
  label: string;
  isSingleDay: boolean;
  isMonth?: boolean;
};

export const VAULT_INTENTS = {
  CASH_UP: "vault_cash_up_summary",
  RECEPTION: "vault_reception_summary",
  LOGBOOK: "vault_logbook_summary",
  GOOGLE_STARS: "vault_google_review_star_summary",
  CCM: "vault_ccm_reconciliation_summary",
  OPERATIONAL_DAY: "vault_operational_day_summary",
  MANAGEMENT_REPORT: "vault_management_report_from_vault",
  COVERAGE_LIST: "vault_coverage_list",
} as const;

const REPORT_LABELS: Record<string, string> = {
  cash_up: "Cash Up",
  reception_daily_report: "Reception Daily Report",
  daily_logbook: "Daily Logbook",
  ccm_reconciliation: "CCM Reconciliation",
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoDate(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function monthBounds(year: number, monthIndex: number): VaultPeriod {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return {
    startDate: isoDate(year, monthIndex + 1, 1),
    endDate: isoDate(year, monthIndex + 1, lastDay),
    label: new Date(Date.UTC(year, monthIndex, 1, 12)).toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
    isSingleDay: false,
    isMonth: true,
  };
}

export function parseVaultPeriodFromQuestion(question = "", referenceDate = new Date()): VaultPeriod | null {
  const q = String(question || "").toLowerCase().trim();
  if (!q) return null;

  const dmy = q.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})\b/);
  if (dmy) {
    const iso = isoDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
    return { startDate: iso, endDate: iso, label: iso, isSingleDay: true };
  }

  const dayMonthYear = q.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\b(?:\s+(20\d{2}))?/,
  );
  if (dayMonthYear) {
    const day = Number(dayMonthYear[1]);
    const monthIndex = MONTH_MAP[dayMonthYear[2]];
    let year = dayMonthYear[3] ? Number(dayMonthYear[3]) : referenceDate.getFullYear();
    if (!dayMonthYear[3] && monthIndex > referenceDate.getMonth()) year -= 1;
    const iso = isoDate(year, monthIndex + 1, day);
    const label = new Date(Date.UTC(year, monthIndex, day, 12)).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
    });
    return { startDate: iso, endDate: iso, label, isSingleDay: true };
  }

  const monthDay = q.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:\s+(20\d{2}))?/,
  );
  if (monthDay) {
    const monthIndex = MONTH_MAP[monthDay[1]];
    const day = Number(monthDay[2]);
    let year = monthDay[3] ? Number(monthDay[3]) : referenceDate.getFullYear();
    if (!monthDay[3] && monthIndex > referenceDate.getMonth()) year -= 1;
    const iso = isoDate(year, monthIndex + 1, day);
    const label = new Date(Date.UTC(year, monthIndex, day, 12)).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
    });
    return { startDate: iso, endDate: iso, label, isSingleDay: true };
  }

  if (/\b(this month|month to date|mtd)\b/.test(q)) {
    return monthBounds(referenceDate.getFullYear(), referenceDate.getMonth());
  }

  const monthOnly = q.match(
    /\b(?:for|in|during|cover(?:ing|age)?)\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\b(?:\s+(20\d{2}))?/,
  );
  if (monthOnly) {
    const monthIndex = MONTH_MAP[monthOnly[1]];
    let year = monthOnly[2] ? Number(monthOnly[2]) : referenceDate.getFullYear();
    if (!monthOnly[2] && monthIndex > referenceDate.getMonth()) year -= 1;
    return monthBounds(year, monthIndex);
  }

  return null;
}

export function hasVaultDayPeriod(question: string) {
  return Boolean(parseVaultPeriodFromQuestion(question)?.isSingleDay);
}

function resolveBranch(context: Record<string, unknown> = {}): string | null {
  const branchMention = context.branchMention as string | null;
  const filters = context.filters as { branch?: string } | undefined;
  const profile = context.profile as { branchScope?: string; allBranches?: boolean } | undefined;
  if (profile?.branchScope && !profile.allBranches) return profile.branchScope;
  return branchMention || filters?.branch || (context.branch as string | null) || null;
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
    startDate,
    endDate,
    reportType,
    metricKeys,
    branchMention,
    filters,
    profile,
  }: Record<string, unknown> = {},
) {
  const scopedBranch = (branch as string | null) ?? resolveBranch({ branchMention, filters, profile });
  let query = supabase.from("ask_nac_structured_facts").select(FACT_SELECT);
  query = periodOverlapFilter(query, startDate as string, endDate as string);
  if (scopedBranch) query = query.eq("branch_id", scopedBranch);
  if (reportType) query = query.eq("report_type", reportType);
  if (Array.isArray(metricKeys) && metricKeys.length) query = query.in("metric_key", metricKeys);
  query = query.neq("metric_key", "raw_extract").order("metric_key");

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
  }: Record<string, unknown> = {},
) {
  const scopedBranch = (branch as string | null) ?? resolveBranch({ branchMention, filters, profile });
  let query = supabase.from("ask_nac_data_coverage").select(COVERAGE_SELECT);
  query = periodOverlapFilter(query, startDate as string, endDate as string);
  if (scopedBranch) query = query.eq("branch_id", scopedBranch);
  if (reportType) query = query.eq("report_type", reportType);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data || []).map((row) => mapVaultCoverageRow(row as Record<string, unknown>));
  return {
    branch: scopedBranch,
    branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
    startDate,
    endDate,
    coverage: rows,
    sources: [{ name: "ask_nac_data_coverage", detail: "RLS-filtered coverage registry" }],
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
    case VAULT_INTENTS.COVERAGE_LIST:
      return getVaultReportSources(supabase, context);
    case VAULT_INTENTS.CASH_UP:
      return getVaultFacts(supabase, {
        ...context,
        startDate: vaultPeriod?.startDate,
        endDate: vaultPeriod?.endDate,
        reportType: "cash_up",
      });
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
      return getVaultDaySummary(supabase, context);
    case VAULT_INTENTS.MANAGEMENT_REPORT: {
      const summary = await getVaultDaySummary(supabase, context);
      return { ...summary, reportMode: "management" };
    }
    default:
      return null;
  }
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
    sourceEntry(String(f.title), `${REPORT_LABELS[String(f.reportType)] || f.reportType || "vault"} · uploaded file`),
  );
}

function vaultFileChips(tool: Record<string, unknown>) {
  return ((tool?.vaultSources as Record<string, unknown>[]) ||
    collectVaultSources(tool?.facts as Record<string, unknown>[] || [], tool?.coverage as Record<string, unknown>[] || []))
    .map((f) => ({
      fileId: f.fileId,
      title: f.title,
      reportType: f.reportType,
      confidence: f.confidence,
      parserVersion: f.parserVersion,
    }));
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

function buildVaultCashUpAnswer(route: Record<string, unknown>, tool: Record<string, unknown>, readiness: Record<string, unknown> | null): AskNacAnswer {
  const facts = (tool?.facts as Record<string, unknown>[]) || [];
  const metrics = cashUpMetrics(facts);
  const net = pickMetricValue(facts, "net_sales") ?? pickMetricValue(facts, "total_sales");
  const directAnswer = net != null
    ? `Cash-up vault data shows net/total sales of ${formatNumber(net)} SAR for ${tool.branchLabel} on ${tool.periodLabel}.`
    : `No cash-up structured facts found for ${tool.branchLabel} on ${tool.periodLabel}.`;

  return {
    ...baseVaultFields(route, tool, readiness),
    answerType: metrics.length ? "metric" : "missing_data",
    title: `Cash-up · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: metrics,
    insights: [],
    recommendations: [],
    missingData: [],
    exportOptions: [],
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
  if (cashFacts.length) sections.push("cash-up sales and guest counts");
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
  const facts = tool?.facts as unknown[] | undefined;
  const coverage = tool?.coverage as unknown[] | undefined;
  if (!facts?.length && !coverage?.length && readiness?.status === "missing") {
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
  return Object.values(VAULT_INTENTS).includes(intent as typeof VAULT_INTENTS[keyof typeof VAULT_INTENTS]);
}
