/**
 * Knowledge Health Engine (Edge) — registry-derived completeness scoring.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { branchDisplayName } from "./askNacEdgeAnswerBuilder.ts";
import { getVaultCoverage, getVaultFacts } from "./askNacVaultTools.ts";
import { fetchCashUpRangeAggregationViaRpc } from "./askNacCashUpRangeRpc.ts";

const OPERATIONAL_COVERAGE_REPORT_TYPES = ["cash_up", "daily_briefing", "daily_logbook", "reception_daily_report"];
const EXECUTIVE_INTELLIGENCE_REPORT_TYPES = ["cash_up", "daily_briefing", "daily_logbook", "guest_feedback", "weekly_dashboard"];
const REPORT_TYPE_LABELS: Record<string, string> = {
  cash_up: "Cash Up",
  daily_briefing: "Daily Briefing",
  daily_logbook: "Daily Logbook",
  reception_daily_report: "Reception Daily Report",
  guest_feedback: "Guest Feedback",
  weekly_dashboard: "Weekly Dashboard",
};

const DASHBOARD_READINESS_CHECKS = [
  { key: "cash_up_week", label: "Cash-up sales for the week", weight: 0.35 },
  { key: "seven_rooms_covers", label: "7Rooms covers", weight: 0.25 },
  { key: "logbook_google_reviews", label: "Google review counts (logbook)", weight: 0.2 },
  { key: "logbook_commentary", label: "Daily logbook commentary", weight: 0.1 },
  { key: "historical_weekly_dashboard", label: "Historical weekly dashboard", weight: 0.1 },
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

function scoreCoverageCompleteness(coverage: Record<string, unknown>[]) {
  const byType = new Map<string, number>();
  for (const row of coverage) {
    const type = String(row.reportType || row.report_type || "");
    const credit = readinessCredit(String(row.readinessStatus || row.readiness_status || ""), Number(row.factCount ?? row.fact_count ?? 0));
    byType.set(type, Math.max(byType.get(type) || 0, credit));
  }
  let creditSum = 0;
  const missingTypes: string[] = [];
  for (const type of OPERATIONAL_COVERAGE_REPORT_TYPES) {
    const credit = byType.get(type);
    if (credit != null) creditSum += credit;
    else missingTypes.push(type);
  }
  return { score: clampScore((creditSum / OPERATIONAL_COVERAGE_REPORT_TYPES.length) * 100), missingTypes };
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
      case "historical_weekly_dashboard":
        satisfied = historicalDashboardCoverage.length > 0;
        detail = satisfied ? `${historicalDashboardCoverage.length} file(s)` : "No historical dashboard";
        break;
      default:
        detail = "";
    }
    return { ...check, satisfied, detail };
  });

  const weighted = checks.reduce((sum, c) => sum + (c.satisfied ? c.weight : 0), 0);
  return { score: clampScore(weighted * 100), checks, missing: checks.filter((c) => !c.satisfied).map((c) => c.label) };
}

function assessExecutiveReadiness(coverage: Record<string, unknown>[], guestFeedbackCoverage: Record<string, unknown>[]) {
  const byType = new Map<string, Record<string, unknown>>();
  for (const row of [...coverage, ...guestFeedbackCoverage]) {
    byType.set(String(row.reportType || row.report_type), row);
  }
  const weights: Record<string, number> = { cash_up: 0.25, daily_briefing: 0.25, daily_logbook: 0.2, guest_feedback: 0.15, weekly_dashboard: 0.15 };
  let creditSum = 0;
  const missing: string[] = [];
  const present: string[] = [];
  for (const type of EXECUTIVE_INTELLIGENCE_REPORT_TYPES) {
    const row = byType.get(type);
    const credit = row ? readinessCredit(String(row.readinessStatus || row.readiness_status || ""), Number(row.factCount ?? row.fact_count ?? 0)) : 0;
    creditSum += credit * (weights[type] || 0);
    if (credit >= 0.5) present.push(reportLabel(type));
    else missing.push(reportLabel(type));
  }
  return {
    score: clampScore((creditSum / Object.values(weights).reduce((a, b) => a + b, 0)) * 100),
    missing,
    present,
    confidenceReductionReasons: missing.map((label) => `${label} missing or not indexed`),
  };
}

function buildRegistry(snapshot: Record<string, unknown>) {
  const coverage = (snapshot.coverage as Record<string, unknown>[]) || [];
  const coveredTypes = new Set(coverage.map((r) => String(r.reportType || r.report_type)));
  const periodLabel = String(snapshot.periodLabel || "");
  const missingReports = OPERATIONAL_COVERAGE_REPORT_TYPES.filter((t) => !coveredTypes.has(t)).map((reportType) => ({
    label: reportLabel(reportType),
    reason: `No coverage row for ${periodLabel || "assessed period"}.`,
    howToFix: `Upload or sync ${reportLabel(reportType)} via Company Knowledge.`,
  }));
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
  return { missingReports, failedExtractions, missingManualInputs, pendingSessions, unapprovedFolders, missingDates: [] };
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
  const coverageScore = scoreCoverageCompleteness(coverage);
  const ingestionScore = scoreIngestionSuccess((snapshot.ingestionJobs as Record<string, unknown>[]) || []);
  const parserScore = scoreParserSuccess(coverage);
  const dashboardReadiness = assessDashboardReadiness(snapshot);
  const executiveReadiness = assessExecutiveReadiness(coverage, (snapshot.guestFeedbackCoverage as Record<string, unknown>[]) || []);

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

  const missingRegistry = buildRegistry(snapshot);
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
    sources: [
      { name: "ask_nac_data_coverage", detail: "coverage registry" },
      { name: "ask_nac_ingestion_jobs", detail: "ingestion status" },
      { name: "ask_nac_manual_inputs", detail: "manual inputs" },
      { name: "ask_nac_pending_sessions", detail: "pending sessions" },
      { name: "ask_nac_drive_discovery_candidates", detail: "discovery candidates" },
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
    const dr = componentDetail.dashboardReadiness as { score?: number; missing?: string[]; checks?: { label: string; satisfied: boolean; detail: string }[] };
    title = `Dashboard Readiness · ${branchLabel}`;
    directAnswer = `Weekly Dashboard Readiness: ${dr?.score ?? components.dashboardReadiness ?? 0}%`;
    if (dr?.missing?.length) directAnswer += `\n\nMissing:\n${dr.missing.map((m) => `• ${m}`).join("\n")}`;
    if (dr?.checks?.length) directAnswer += `\n\nChecklist:\n${dr.checks.map((c) => `• ${c.label}: ${c.satisfied ? "✓" : "✗"} (${c.detail})`).join("\n")}`;
  } else if (focus === "confidence") {
    const er = componentDetail.executiveReadiness as { score?: number; confidenceReductionReasons?: string[]; present?: string[] };
    title = `Executive Intelligence Readiness · ${branchLabel}`;
    directAnswer = `Executive intelligence readiness: ${er?.score ?? components.executiveIntelligenceReadiness ?? 0}%`;
    if (er?.confidenceReductionReasons?.length) {
      directAnswer += `\n\nWhy-analysis confidence is reduced because:\n${er.confidenceReductionReasons.map((r) => `• ${r}`).join("\n")}`;
    }
    if (er?.present?.length) directAnswer += `\n\nIndexed: ${er.present.join("; ")}`;
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
