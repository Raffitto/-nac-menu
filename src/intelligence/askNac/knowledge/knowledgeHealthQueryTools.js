/**
 * Gather Knowledge Health snapshot from Supabase registry tables.
 */

import { branchDisplayName } from "../../../dashboard/utils/rangeState";
import { getVaultCoverage, getVaultFacts } from "../vault/vaultQueryTools";
import { fetchManualInputsForPeriod } from "../executive/manualInputs";
import { fetchCashUpRangeAggregationViaRpc } from "../vault/vaultCashUpRangeRpc";
import { computeKnowledgeHealth } from "./knowledgeHealthEngine";
import { OPERATIONAL_COVERAGE_REPORT_TYPES } from "./knowledgeHealthConstants";

const INGESTION_SELECT = "id, status, error, finished_at, file_id, ask_nac_files!inner(id, title, primary_branch_id, report_type)";
const PENDING_SESSION_SELECT = "id, branch_id, session_type, status, missing_fields, provided_inputs, context, created_by, expires_at";
const DISCOVERY_SELECT = "id, folder_path, detected_report_type, recommended_action, confidence, reason, status, branch_id, file_count";

function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function defaultPeriod() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    label: start.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

function resolvePeriod(context = {}) {
  const vp = context.vaultPeriod || {};
  if (vp.startDate && vp.endDate) {
    return {
      startDate: vp.startDate,
      endDate: vp.endDate,
      label: vp.label || `${vp.startDate} – ${vp.endDate}`,
    };
  }
  return defaultPeriod();
}

export async function gatherKnowledgeHealthSnapshot(supabase, context = {}) {
  if (!supabase) {
    return computeKnowledgeHealth({ branch: null, branchLabel: "Network", disclosures: ["Supabase client unavailable."] });
  }

  const branch = context.branch || context.branchMention || context.filters?.branch || null;
  const branchLabel = branch ? branchDisplayName(branch) : "Network";
  const period = resolvePeriod(context);
  const ingestionSince = addDays(period.endDate, -30);

  const [
    coverageResult,
    guestFeedbackCoverage,
    weekAggregation,
    logbookFactsResult,
    googleFactsResult,
    manualInputsResult,
    ingestionJobsResult,
    pendingSessionsResult,
    discoveryCandidatesResult,
    historicalDashboardCoverage,
  ] = await Promise.all([
    getVaultCoverage(supabase, { branch, startDate: period.startDate, endDate: period.endDate }).catch(() => ({ coverage: [] })),
    getVaultCoverage(supabase, { branch, startDate: period.startDate, endDate: period.endDate, reportType: "guest_feedback" }).catch(() => ({ coverage: [] })),
    fetchCashUpRangeAggregationViaRpc(supabase, { branch, startDate: period.startDate, endDate: period.endDate }).catch(() => ({ dayCount: 0 })),
    getVaultFacts(supabase, { branch, startDate: period.startDate, endDate: period.endDate, reportType: "daily_logbook" }).catch(() => ({ facts: [] })),
    getVaultFacts(supabase, {
      branch,
      startDate: period.startDate,
      endDate: period.endDate,
      metricKeys: ["google_review_1", "google_review_2", "google_review_3", "google_review_4", "google_review_5"],
    }).catch(() => ({ facts: [] })),
    branch
      ? fetchManualInputsForPeriod(supabase, { branch, periodStart: period.startDate, periodEnd: period.endDate }).catch(() => ({ inputs: [] }))
      : Promise.resolve({ inputs: [] }),
    fetchIngestionJobs(supabase, { branch, since: ingestionSince }).catch(() => ({ jobs: [] })),
    fetchPendingSessions(supabase, { branch }).catch(() => ({ sessions: [] })),
    fetchUnapprovedDiscoveryCandidates(supabase, { branch }).catch(() => ({ candidates: [] })),
    getVaultCoverage(supabase, { branch, startDate: period.startDate, endDate: period.endDate, reportType: "weekly_dashboard" }).catch(() => ({ coverage: [] })),
  ]);

  const snapshot = {
    branch,
    branchLabel,
    periodLabel: period.label,
    startDate: period.startDate,
    endDate: period.endDate,
    coverage: coverageResult.coverage || [],
    guestFeedbackCoverage: guestFeedbackCoverage.coverage || [],
    expectedTypes: OPERATIONAL_COVERAGE_REPORT_TYPES,
    weekAggregation,
    logbookFacts: logbookFactsResult.facts || [],
    googleReviewFacts: googleFactsResult.facts || [],
    manualInputs: manualInputsResult.inputs || [],
    ingestionJobs: ingestionJobsResult.jobs || [],
    pendingSessions: pendingSessionsResult.sessions || [],
    discoveryCandidates: discoveryCandidatesResult.candidates || [],
    historicalDashboardCoverage: historicalDashboardCoverage.coverage || [],
    sources: [
      { name: "ask_nac_data_coverage", detail: "coverage registry" },
      { name: "ask_nac_ingestion_jobs", detail: "ingestion status (last 30 days)" },
      { name: "ask_nac_manual_inputs", detail: "period manual inputs" },
      { name: "ask_nac_pending_sessions", detail: "open HITL sessions" },
      { name: "ask_nac_drive_discovery_candidates", detail: "unapproved Drive folders" },
      { name: "ask_nac_structured_facts", detail: "cash-up + logbook facts" },
    ],
  };

  return computeKnowledgeHealth(snapshot);
}

async function fetchIngestionJobs(supabase, { branch, since } = {}) {
  let query = supabase
    .from("ask_nac_ingestion_jobs")
    .select(INGESTION_SELECT)
    .gte("created_at", `${since}T00:00:00Z`)
    .order("created_at", { ascending: false })
    .limit(200);

  if (branch) {
    query = query.eq("ask_nac_files.primary_branch_id", branch);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const jobs = (data || []).map((row) => ({
    id: row.id,
    status: row.status,
    error: row.error,
    finishedAt: row.finished_at,
    fileTitle: row.ask_nac_files?.title,
    reportType: row.ask_nac_files?.report_type,
  }));

  return { jobs, sources: [{ name: "ask_nac_ingestion_jobs", detail: `${jobs.length} job(s) since ${since}` }] };
}

async function fetchPendingSessions(supabase, { branch } = {}) {
  let query = supabase
    .from("ask_nac_pending_sessions")
    .select(PENDING_SESSION_SELECT)
    .eq("status", "pending")
    .order("updated_at", { ascending: false })
    .limit(20);

  if (branch) query = query.eq("branch_id", branch);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const sessions = (data || []).map((row) => ({
    id: row.id,
    sessionType: row.session_type,
    missingFields: row.missing_fields,
    branchId: row.branch_id,
  }));

  return { sessions };
}

async function fetchUnapprovedDiscoveryCandidates(supabase, { branch } = {}) {
  let query = supabase
    .from("ask_nac_drive_discovery_candidates")
    .select(DISCOVERY_SELECT)
    .eq("status", "pending")
    .in("recommended_action", ["ask", "unknown_needs_review"])
    .order("folder_path", { ascending: true })
    .limit(50);

  if (branch) query = query.eq("branch_id", branch);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const candidates = (data || []).map((row) => ({
    folderPath: row.folder_path,
    detectedReportType: row.detected_report_type,
    recommendedAction: row.recommended_action,
    reason: row.reason,
    status: row.status,
  }));

  return { candidates };
}

export async function runKnowledgeHealthQuery(supabase, context = {}) {
  const health = await gatherKnowledgeHealthSnapshot(supabase, context);
  return {
    ...health,
    focus: context.healthFocus || "general",
    question: context.question || "",
  };
}
