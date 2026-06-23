/**
 * Knowledge Health Engine (Edge) — registry-derived completeness scoring.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { branchDisplayName } from "./askNacEdgeAnswerBuilder.ts";
import { getVaultCoverage, getVaultFacts } from "./askNacVaultTools.ts";
import { fetchCashUpRangeAggregationViaRpc } from "./askNacCashUpRangeRpc.ts";

const COVERAGE_TYPE_WEIGHTS: Record<string, number> = {
  cash_up: 0.45,
  daily_logbook: 0.35,
  reception_daily_report: 0.1,
  daily_briefing: 0.1,
};
const REQUIRED_COVERAGE_REPORT_TYPES = ["cash_up", "daily_logbook"];
const OPTIONAL_COVERAGE_REPORT_TYPES = ["reception_daily_report", "daily_briefing"];
const EXECUTIVE_CORE_WEIGHTS: Record<string, number> = { cash_up: 0.55, daily_logbook: 0.45 };
const EXECUTIVE_OPTIONAL_SOURCES = ["daily_briefing", "guest_feedback", "weekly_dashboard"];
const FILE_INVENTORY_PERIOD_GAP_CREDIT = 0.5;
const REPORT_TYPE_LABELS: Record<string, string> = {
  cash_up: "Cash Up",
  daily_briefing: "Daily Briefing",
  daily_logbook: "Daily Logbook",
  reception_daily_report: "Reception Daily Report",
  guest_feedback: "Guest Feedback",
  weekly_dashboard: "Weekly Dashboard",
};

const DASHBOARD_READINESS_CHECKS = [
  { key: "cash_up_week", label: "Cash-up sales for the week", weight: 0.4 },
  { key: "seven_rooms_covers", label: "7Rooms covers", weight: 0.3 },
  { key: "logbook_google_reviews", label: "Google review counts (logbook)", weight: 0.2 },
  { key: "logbook_commentary", label: "Daily logbook commentary", weight: 0.1 },
];

const MANUAL_INPUT_REQUIREMENTS = [{ key: "seven_rooms_covers", label: "7Rooms covers", prompt: "What were 7Rooms covers for this week?" }];

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function reportLabel(reportType: string) {
  return REPORT_TYPE_LABELS[reportType] || reportType;
}

function readinessCredit(status: string, factCount = 0) {
  if (status === "ready") return 1;
  if (status === "partial") return 0.5;
  if (status === "stale") return 0.25;
  if (factCount > 0) return 0.4;
  return 0;
}

export function detectKnowledgeHealthFocus(question = "") {
  const q = String(question || "").toLowerCase();
  if (/\bdashboard readiness\b/.test(q)) return "dashboard";
  if (/\bwhy is confidence low\b|\bwhy.*confidence.*low\b/.test(q)) return "confidence";
  if (/\bwhat am i missing\b|\bwhat(?:'s| is) missing\b/.test(q)) return "missing";
  return "general";
}

function addDays(iso: string, days: number) {
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

function scoreCoverageCompleteness(coverage: Record<string, unknown>[], fileInventory: Record<string, number> = {}) {
  const byType = new Map<string, number>();
  for (const row of coverage) {
    const type = String(row.reportType || row.report_type || "");
    const credit = readinessCredit(String(row.readinessStatus || row.readiness_status || ""), Number(row.factCount ?? row.fact_count ?? 0));
    byType.set(type, Math.max(byType.get(type) || 0, credit));
  }
  let creditSum = 0;
  let weightSum = 0;
  const missingTypes: string[] = [];
  const periodGapTypes: Array<Record<string, unknown>> = [];
  for (const [type, weight] of Object.entries(COVERAGE_TYPE_WEIGHTS)) {
    weightSum += weight;
    let credit = byType.get(type) || 0;
    if (!credit && (fileInventory[type] || 0) > 0) {
      credit = FILE_INVENTORY_PERIOD_GAP_CREDIT;
      periodGapTypes.push({ reportType: type, label: reportLabel(type), fileCount: fileInventory[type], reason: "Files registered but period not indexed for this window." });
    }
    creditSum += credit * weight;
    if (credit < 0.5) missingTypes.push(type);
  }
  return { score: clampScore(weightSum > 0 ? (creditSum / weightSum) * 100 : 0), missingTypes, periodGapTypes };
}

function scoreIngestionSuccess(jobs: Record<string, unknown>[]) {
  const terminal = jobs.filter((j) => ["completed", "failed", "skipped"].includes(String(j.status)));
  if (!terminal.length) return { score: null as number | null, noJobs: true, failed: 0, completed: 0 };
  const completed = terminal.filter((j) => j.status === "completed").length;
  const failed = terminal.filter((j) => j.status === "failed").length;
  const stuck = jobs.filter((j) => ["registered", "queued", "processing"].includes(String(j.status))).length;
  let score = (completed / terminal.length) * 100;
  if (stuck > 0) score -= Math.min(15, stuck * 3);
  return { score: clampScore(score), noJobs: false, failed, completed };
}

function scoreParserSuccess(coverage: Record<string, unknown>[]) {
  if (!coverage.length) return { score: 0 };
  let creditSum = 0;
  for (const row of coverage) {
    creditSum += readinessCredit(String(row.readinessStatus || row.readiness_status || ""), Number(row.factCount ?? row.fact_count ?? 0));
  }
  return { score: clampScore((creditSum / coverage.length) * 100) };
}

function assessDashboardReadiness(snapshot: Record<string, unknown>) {
  const weekAggregation = snapshot.weekAggregation as { dayCount?: number; totalSales?: number } | null;
  const manualInputs = (snapshot.manualInputs as Record<string, unknown>[]) || [];
  const logbookFacts = (snapshot.logbookFacts as Record<string, unknown>[]) || [];
  const googleReviewFacts = (snapshot.googleReviewFacts as Record<string, unknown>[]) || [];
  const historicalDashboardCoverage = (snapshot.historicalDashboardCoverage as unknown[]) || [];
  const manualKeys = new Set(manualInputs.map((i) => String(i.metricKey || i.metric_key || "")));

  const checks = DASHBOARD_READINESS_CHECKS.map((check) => {
    let satisfied = false;
    let detail = "";
    switch (check.key) {
      case "cash_up_week":
        satisfied = Boolean(weekAggregation?.dayCount && weekAggregation.dayCount > 0 && weekAggregation.totalSales != null);
        detail = satisfied ? `${weekAggregation?.dayCount} cash-up day(s)` : "No cash-up aggregation";
        break;
      case "seven_rooms_covers":
        satisfied = manualKeys.has("seven_rooms_covers");
        detail = satisfied ? "Manual input present" : "7Rooms covers not provided";
        break;
      case "logbook_google_reviews": {
        const facts = googleReviewFacts.length ? googleReviewFacts : logbookFacts.filter((f) => /^google_review_\d$/.test(String(f.metricKey || f.metric_key)));
        const total = facts.reduce((sum, f) => sum + (Number(f.metricValue ?? f.metric_value) || 0), 0);
        satisfied = total > 0;
        detail = satisfied ? `${total} review count(s)` : "No Google review counts";
        break;
      }
      case "logbook_commentary":
        satisfied = logbookFacts.some((f) => String((f.dimensions as Record<string, unknown>)?.text_value || "").trim().length > 8);
        detail = satisfied ? "Commentary indexed" : "No logbook commentary";
        break;
      default:
        detail = "";
    }
    return { ...check, satisfied, detail };
  });

  const historyCount = historicalDashboardCoverage.length;
  const dashboardHistoryDepth = {
    fileCount: historyCount,
    depthLabel: historyCount === 0
      ? "No weekly dashboard files indexed yet (folder recently created)."
      : historyCount < 4
        ? `Shallow history (${historyCount} file${historyCount === 1 ? "" : "s"}) — expected while the weekly folder is new.`
        : `Moderate history (${historyCount} files).`,
    informational: true,
  };

  const weighted = checks.reduce((sum, c) => sum + (c.satisfied ? c.weight : 0), 0);
  return { score: clampScore(weighted * 100), checks, missing: checks.filter((c) => !c.satisfied).map((c) => c.label), dashboardHistoryDepth };
}

function assessExecutiveReadiness(
  coverage: Record<string, unknown>[],
  guestFeedbackCoverage: Record<string, unknown>[],
  fileInventory: Record<string, number> = {},
) {
  const byType = new Map<string, number>();
  for (const row of [...coverage, ...guestFeedbackCoverage]) {
    const type = String(row.reportType || row.report_type);
    const credit = readinessCredit(String(row.readinessStatus || row.readiness_status || ""), Number(row.factCount ?? row.fact_count ?? 0));
    byType.set(type, Math.max(byType.get(type) || 0, credit));
  }
  let creditSum = 0;
  let weightSum = 0;
  const missing: string[] = [];
  const present: string[] = [];
  for (const [type, weight] of Object.entries(EXECUTIVE_CORE_WEIGHTS)) {
    weightSum += weight;
    const credit = byType.get(type) || 0;
    creditSum += credit * weight;
    if (credit >= 0.5) present.push(reportLabel(type));
    else missing.push(reportLabel(type));
  }
  const optionalAvailable: string[] = [];
  const optionalInactive: string[] = [];
  for (const type of EXECUTIVE_OPTIONAL_SOURCES) {
    const credit = byType.get(type) || 0;
    const hasFiles = (fileInventory[type] || 0) > 0;
    if (credit >= 0.5) optionalAvailable.push(reportLabel(type));
    else if (hasFiles) optionalInactive.push(`${reportLabel(type)} (files present, not indexed for period)`);
    else optionalInactive.push(`${reportLabel(type)} (optional — not in active use)`);
  }
  return {
    score: clampScore(weightSum > 0 ? (creditSum / weightSum) * 100 : 0),
    missing,
    present,
    optionalAvailable,
    optionalInactive,
    confidenceReductionReasons: missing.map((label) => `${label} missing or not indexed for executive analysis`),
  };
}

function buildRegistry(snapshot: Record<string, unknown>, periodGapTypes: Array<Record<string, unknown>> = []) {
  const coverage = (snapshot.coverage as Record<string, unknown>[]) || [];
  const fileInventory = (snapshot.fileInventory as Record<string, number>) || {};
  const coveredTypes = new Set(coverage.map((r) => String(r.reportType || r.report_type)));
  const periodLabel = String(snapshot.periodLabel || "");
  const missingReports = REQUIRED_COVERAGE_REPORT_TYPES
    .filter((t) => !coveredTypes.has(t) || coverage.filter((r) => String(r.reportType || r.report_type) === t)
      .every((r) => readinessCredit(String(r.readinessStatus || r.readiness_status), Number(r.factCount ?? r.fact_count)) < 0.5))
    .map((reportType) => ({
      label: reportLabel(reportType),
      reason: `No usable coverage for ${periodLabel || "assessed period"}.`,
      howToFix: `Upload or sync ${reportLabel(reportType)} via Company Knowledge.`,
    }));
  const informationalGaps = [
    ...periodGapTypes.map((gap) => ({
      label: String(gap.label),
      reason: String(gap.reason),
      howToFix: "Optional for health score — index period dates when parser supports it.",
    })),
  ];
  const failedExtractions = ((snapshot.ingestionJobs as Record<string, unknown>[]) || [])
    .filter((j) => j.status === "failed")
    .map((j) => ({
      fileTitle: j.fileTitle || j.file_id,
      error: j.error || "failed",
      howToFix: "Re-upload or re-ingest the file.",
    }));
  const manualKeys = new Set(((snapshot.manualInputs as Record<string, unknown>[]) || []).map((i) => String(i.metricKey || i.metric_key)));
  const missingManualInputs = MANUAL_INPUT_REQUIREMENTS.filter((f) => !manualKeys.has(f.key)).map((f) => ({
    label: f.label,
    howToFix: f.prompt,
  }));
  const pendingSessions = ((snapshot.pendingSessions as Record<string, unknown>[]) || []).map((s) => ({
    sessionType: s.sessionType || s.session_type,
    missingFields: ((s.missingFields || s.missing_fields) as Array<{ label?: string; key?: string }> || []).map((f) => f.label || f.key),
    howToFix: "Reply to the pending Ask NAC follow-up.",
  }));
  const unapprovedFolders = ((snapshot.discoveryCandidates as Record<string, unknown>[]) || []).map((c) => ({
    folderPath: c.folderPath || c.folder_path,
    detectedReportType: c.detectedReportType || c.detected_report_type,
    reason: c.reason || "Awaiting approval",
    howToFix: "Approve Drive discovery rules for this folder.",
  }));
  return { missingReports, informationalGaps, failedExtractions: failedExtractions.slice(0, 12), missingManualInputs, pendingSessions, unapprovedFolders, missingDates: [] };
}

function buildRecommendations(health: Record<string, unknown>) {
  const registry = health.missingRegistry as Record<string, unknown[]>;
  const recs: { what: string; why: string; how: string }[] = [];
  const push = (what: string, why: string, how: string) => recs.push({ what, why, how });
  for (const item of registry.missingReports || []) push(String((item as { label: string }).label), String((item as { reason: string }).reason), String((item as { howToFix: string }).howToFix));
  for (const item of registry.failedExtractions || []) push(String((item as { fileTitle: string }).fileTitle), "Ingestion failed", String((item as { howToFix: string }).howToFix));
  for (const item of registry.missingManualInputs || []) push(String((item as { label: string }).label), "Required for weekly dashboard", String((item as { howToFix: string }).howToFix));
  for (const item of registry.unapprovedFolders || []) push(String((item as { folderPath: string }).folderPath), String((item as { reason: string }).reason), String((item as { howToFix: string }).howToFix));
  const er = health.executiveReadiness as { confidenceReductionReasons?: string[] };
  for (const reason of er?.confidenceReductionReasons || []) {
    if (!recs.some((r) => r.what === reason)) push(reason, "Reduces executive confidence", `Upload ${reason.replace(/ missing.*/i, "")}.`);
  }
  return recs.slice(0, 12);
}

function computeHealth(snapshot: Record<string, unknown>) {
  const coverage = (snapshot.coverage as Record<string, unknown>[]) || [];
  const fileInventory = (snapshot.fileInventory as Record<string, number>) || {};
  const coverageScore = scoreCoverageCompleteness(coverage, fileInventory);
  const ingestionScore = scoreIngestionSuccess((snapshot.ingestionJobs as Record<string, unknown>[]) || []);
  const parserScore = scoreParserSuccess(coverage);
  const dashboardReadiness = assessDashboardReadiness(snapshot);
  const executiveReadiness = assessExecutiveReadiness(
    coverage,
    (snapshot.guestFeedbackCoverage as Record<string, unknown>[]) || [],
    fileInventory,
  );

  const components = {
    coverageCompleteness: coverageScore.score,
    ingestionSuccess: ingestionScore.score,
    parserSuccess: parserScore.score,
    dashboardReadiness: dashboardReadiness.score,
    executiveIntelligenceReadiness: executiveReadiness.score,
  };

  let overallScore: number;
  const disclosures: string[] = [];
  if (ingestionScore.noJobs) {
    disclosures.push("No ask_nac_ingestion_jobs in the assessed window — ingestion success omitted from score.");
    overallScore = clampScore(
      components.coverageCompleteness * 0.375
      + components.parserSuccess * 0.25
      + components.dashboardReadiness * 0.15
      + components.executiveIntelligenceReadiness * 0.15
      + components.coverageCompleteness * 0.05,
    );
  } else {
    overallScore = clampScore(
      components.coverageCompleteness * 0.3
      + (components.ingestionSuccess ?? 0) * 0.2
      + components.parserSuccess * 0.2
      + components.dashboardReadiness * 0.15
      + components.executiveIntelligenceReadiness * 0.15,
    );
  }

  const missingRegistry = buildRegistry(snapshot, coverageScore.periodGapTypes as Array<Record<string, unknown>>);
  const health = {
    branch: snapshot.branch,
    branchLabel: snapshot.branchLabel,
    periodLabel: snapshot.periodLabel,
    overallScore,
    components,
    componentDetail: { coverageScore, ingestionScore, parserScore, dashboardReadiness, executiveReadiness },
    missingRegistry,
    executiveReadiness,
    disclosures,
    sources: snapshot.sources,
  };
  return { ...health, recommendations: buildRecommendations(health) };
}

async function fetchManualInputs(supabase: SupabaseClient, branch: string, startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from("ask_nac_manual_inputs")
    .select("metric_key, metric_label, metric_value, period_start, period_end")
    .eq("branch_id", branch)
    .eq("period_start", startDate)
    .eq("period_end", endDate);
  if (error) return [];
  return data || [];
}

async function fetchBranchFileInventory(supabase: SupabaseClient, branch: string) {
  const { data, error } = await supabase.from("ask_nac_files").select("report_type").eq("primary_branch_id", branch).eq("status", "active");
  if (error) return {};
  const counts: Record<string, number> = {};
  for (const row of data || []) counts[row.report_type] = (counts[row.report_type] || 0) + 1;
  return counts;
}

export async function runKnowledgeHealthQuery(supabase: SupabaseClient, context: Record<string, unknown> = {}) {
  const branch = (context.branch || context.branchMention || (context.filters as { branch?: string })?.branch) as string | null;
  const branchLabel = branch ? branchDisplayName(branch) : "Network";
  const vp = context.vaultPeriod as { startDate?: string; endDate?: string; label?: string } | undefined;
  const period = vp?.startDate && vp?.endDate
    ? { startDate: vp.startDate, endDate: vp.endDate, label: vp.label || `${vp.startDate} – ${vp.endDate}` }
    : defaultPeriod();
  const ingestionSince = addDays(period.endDate, -30);

  const [
    coverageResult,
    guestFeedbackCoverage,
    weekAggregation,
    logbookFactsResult,
    googleFactsResult,
    manualInputs,
    ingestionJobs,
    pendingSessions,
    discoveryCandidates,
    historicalDashboardCoverage,
    fileInventory,
  ] = await Promise.all([
    getVaultCoverage(supabase, { branch, startDate: period.startDate, endDate: period.endDate }).catch(() => ({ coverage: [] })),
    getVaultCoverage(supabase, { branch, startDate: period.startDate, endDate: period.endDate, reportType: "guest_feedback" }).catch(() => ({ coverage: [] })),
    fetchCashUpRangeAggregationViaRpc(supabase, { branch, startDate: period.startDate, endDate: period.endDate }).catch(() => ({ dayCount: 0 })),
    getVaultFacts(supabase, { branch, startDate: period.startDate, endDate: period.endDate, reportType: "daily_logbook" }).catch(() => ({ facts: [] })),
    getVaultFacts(supabase, { branch, startDate: period.startDate, endDate: period.endDate, metricKeys: ["google_review_1", "google_review_2", "google_review_3", "google_review_4", "google_review_5"] }).catch(() => ({ facts: [] })),
    branch ? fetchManualInputs(supabase, branch, period.startDate, period.endDate) : Promise.resolve([]),
    supabase.from("ask_nac_ingestion_jobs").select("id, status, error, finished_at, file_id, ask_nac_files!inner(title, primary_branch_id, report_type)").gte("created_at", `${ingestionSince}T00:00:00Z`).limit(200).then((r) => {
      let rows = (r.data || []) as Record<string, unknown>[];
      if (branch) rows = rows.filter((row) => (row.ask_nac_files as { primary_branch_id?: string })?.primary_branch_id === branch);
      return rows.map((row) => ({
        status: row.status,
        error: row.error,
        fileTitle: (row.ask_nac_files as { title?: string })?.title,
      }));
    }).catch(() => []),
    supabase.from("ask_nac_pending_sessions").select("id, session_type, missing_fields").eq("status", "pending").then((r) => {
      let rows = r.data || [];
      if (branch) rows = rows.filter((row) => row.branch_id === branch);
      return rows;
    }).catch(() => []),
    supabase.from("ask_nac_drive_discovery_candidates").select("folder_path, detected_report_type, recommended_action, reason, status").eq("status", "pending").in("recommended_action", ["ask", "unknown_needs_review"]).then((r) => {
      let rows = r.data || [];
      if (branch) rows = rows.filter((row) => row.branch_id === branch);
      return rows;
    }).catch(() => []),
    getVaultCoverage(supabase, { branch, startDate: period.startDate, endDate: period.endDate, reportType: "weekly_dashboard" }).catch(() => ({ coverage: [] })),
    branch ? fetchBranchFileInventory(supabase, branch) : Promise.resolve({}),
  ]);

  const snapshot = {
    branch,
    branchLabel,
    periodLabel: period.label,
    coverage: (coverageResult as { coverage?: unknown[] }).coverage || [],
    guestFeedbackCoverage: (guestFeedbackCoverage as { coverage?: unknown[] }).coverage || [],
    weekAggregation,
    logbookFacts: (logbookFactsResult as { facts?: unknown[] }).facts || [],
    googleReviewFacts: (googleFactsResult as { facts?: unknown[] }).facts || [],
    manualInputs,
    ingestionJobs,
    pendingSessions,
    discoveryCandidates,
    historicalDashboardCoverage: (historicalDashboardCoverage as { coverage?: unknown[] }).coverage || [],
    fileInventory,
    sources: [
      { name: "ask_nac_data_coverage", detail: "coverage registry" },
      { name: "ask_nac_ingestion_jobs", detail: "ingestion status" },
      { name: "ask_nac_manual_inputs", detail: "manual inputs" },
      { name: "ask_nac_pending_sessions", detail: "pending sessions" },
      { name: "ask_nac_drive_discovery_candidates", detail: "discovery candidates" },
      { name: "ask_nac_files", detail: "branch file inventory" },
    ],
  };

  const knowledgeHealth = computeHealth(snapshot);
  return {
    knowledgeHealth,
    focus: detectKnowledgeHealthFocus(String(context.question || "")),
    sources: knowledgeHealth.sources,
  };
}

function formatRegistry(registry: Record<string, unknown[]>) {
  const lines: string[] = [];
  const section = (title: string, items: unknown[], fmt: (i: Record<string, unknown>) => string) => {
    if (!items?.length) return;
    lines.push(`${title}:`);
    for (const item of items.slice(0, 6)) lines.push(`• ${fmt(item as Record<string, unknown>)}`);
  };
  section("Missing reports", registry.missingReports || [], (i) => `${i.label} — ${i.reason}`);
  section("Failed extractions", registry.failedExtractions || [], (i) => `${i.fileTitle}: ${i.error}`);
  section("Missing manual inputs", registry.missingManualInputs || [], (i) => String(i.label));
  section("Pending sessions", registry.pendingSessions || [], (i) => `${i.sessionType}: ${((i.missingFields as string[]) || []).join(", ")}`);
  section("Unapproved folders", registry.unapprovedFolders || [], (i) => `${i.folderPath} (${i.detectedReportType})`);
  section("Informational gaps (optional)", registry.informationalGaps || [], (i) => `${i.label} — ${i.reason}`);
  return lines.length ? lines.join("\n") : "No gaps flagged in the missing-information registry.";
}

export function buildKnowledgeHealthAnswer(
  route: Record<string, unknown>,
  tool: Record<string, unknown>,
  readiness: Record<string, unknown> | null,
) {
  const health = (tool.knowledgeHealth || tool) as Record<string, unknown>;
  const focus = String(tool.focus || detectKnowledgeHealthFocus(String(route.question || "")));
  const branchLabel = String(health.branchLabel || "Network");
  const periodLabel = String(health.periodLabel || "current period");
  const score = Number(health.overallScore ?? 0);
  const components = health.components as Record<string, number> || {};
  const componentDetail = health.componentDetail as Record<string, unknown> || {};
  const missingRegistry = health.missingRegistry as Record<string, unknown[]> || {};
  const recommendations = (health.recommendations as { what: string; how: string }[]) || [];

  let directAnswer = "";
  let title = `Knowledge Health · ${branchLabel}`;

  if (focus === "dashboard") {
    const dr = componentDetail.dashboardReadiness as {
      score?: number;
      missing?: string[];
      checks?: { label: string; satisfied: boolean; detail: string }[];
      dashboardHistoryDepth?: { depthLabel?: string };
    };
    title = `Dashboard Readiness · ${branchLabel}`;
    directAnswer = `Weekly Dashboard Readiness: ${dr?.score ?? components.dashboardReadiness ?? 0}%`;
    if (dr?.missing?.length) directAnswer += `\n\nMissing:\n${dr.missing.map((m) => `• ${m}`).join("\n")}`;
    if (dr?.dashboardHistoryDepth?.depthLabel) directAnswer += `\n\nDashboard history depth: ${dr.dashboardHistoryDepth.depthLabel}`;
    if (dr?.checks?.length) directAnswer += `\n\nChecklist:\n${dr.checks.map((c) => `• ${c.label}: ${c.satisfied ? "✓" : "✗"} (${c.detail})`).join("\n")}`;
  } else if (focus === "confidence") {
    const er = componentDetail.executiveReadiness as {
      score?: number;
      confidenceReductionReasons?: string[];
      present?: string[];
      optionalAvailable?: string[];
      optionalInactive?: string[];
    };
    title = `Executive Intelligence Readiness · ${branchLabel}`;
    directAnswer = `Executive intelligence readiness: ${er?.score ?? components.executiveIntelligenceReadiness ?? 0}%`;
    if (er?.confidenceReductionReasons?.length) {
      directAnswer += `\n\nWhy-analysis confidence is reduced because:\n${er.confidenceReductionReasons.map((r) => `• ${r}`).join("\n")}`;
    } else directAnswer += "\n\nCore executive sources (cash-up + logbook) are indexed for this period.";
    if (er?.present?.length) directAnswer += `\n\nIndexed (core): ${er.present.join("; ")}`;
    if (er?.optionalAvailable?.length) directAnswer += `\n\nOptional sources available: ${er.optionalAvailable.join("; ")}`;
    if (er?.optionalInactive?.length) directAnswer += `\n\nOptional / inactive: ${er.optionalInactive.join("; ")}`;
  } else if (focus === "missing") {
    title = `Missing Information · ${branchLabel}`;
    directAnswer = `Missing information registry for ${periodLabel}:\n\n${formatRegistry(missingRegistry)}\n\nRecommendations:\n${recommendations.map((r, i) => `${i + 1}. ${r.what} — ${r.how}`).join("\n")}`;
  } else {
    directAnswer = [
      `Knowledge Health Score for ${branchLabel} (${periodLabel}): ${score}/100`,
      "",
      `• Coverage completeness: ${components.coverageCompleteness ?? 0}%`,
      `• Ingestion success: ${components.ingestionSuccess == null ? "n/a" : `${components.ingestionSuccess}%`}`,
      `• Parser success: ${components.parserSuccess ?? 0}%`,
      `• Dashboard readiness: ${components.dashboardReadiness ?? 0}%`,
      `• Executive intelligence readiness: ${components.executiveIntelligenceReadiness ?? 0}%`,
      "",
      "Missing information registry:",
      formatRegistry(missingRegistry),
      "",
      "Recommendations:",
      recommendations.map((r, i) => `${i + 1}. ${r.what} — ${r.how}`).join("\n"),
    ].join("\n");
  }

  const disclosures = health.disclosures as string[] || [];
  if (disclosures.length) directAnswer += `\n\nDisclosure:\n${disclosures.map((d) => `• ${d}`).join("\n")}`;

  const confidence = score >= 80 ? "high" : score >= 55 ? "medium" : "low";

  return {
    answerType: "executive",
    title,
    directAnswer,
    confidence,
    recommendations: recommendations.map((r) => `${r.what}: ${r.how}`),
    keyMetrics: [],
    insights: [],
    missingData: [],
    exportOptions: [],
    warnings: [],
    diagnostics: { knowledgeHealth: true, overallScore: score, components, missingRegistry, focus },
    intent: route.intent,
    isAiGenerated: false,
    readiness,
  };
}
