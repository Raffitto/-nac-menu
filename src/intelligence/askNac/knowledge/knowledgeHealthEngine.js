/**
 * Knowledge Health Engine — scoring, registry, and recommendations from real vault signals.
 */

import {
  DASHBOARD_READINESS_CHECKS,
  EXECUTIVE_INTELLIGENCE_REPORT_TYPES,
  HEALTH_SCORE_WEIGHTS,
  MANUAL_INPUT_REQUIREMENTS,
  OPERATIONAL_COVERAGE_REPORT_TYPES,
  REPORT_TYPE_LABELS,
} from "./knowledgeHealthConstants";

function clampScore(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function reportLabel(reportType) {
  return REPORT_TYPE_LABELS[reportType] || reportType;
}

function readinessCredit(status, factCount = 0) {
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
  if (/\bhealth check\b|\bknowledge health\b/.test(q)) return "general";
  return "general";
}

export function scoreCoverageCompleteness(coverage = [], expectedTypes = OPERATIONAL_COVERAGE_REPORT_TYPES) {
  if (!expectedTypes.length) return { score: 0, present: 0, total: 0, missingTypes: [] };
  const byType = new Map();
  for (const row of coverage) {
    const type = row.reportType || row.report_type;
    if (!type) continue;
    const existing = byType.get(type);
    const credit = readinessCredit(row.readinessStatus || row.readiness_status, row.factCount ?? row.fact_count);
    if (!existing || credit > existing.credit) {
      byType.set(type, { row, credit });
    }
  }
  let creditSum = 0;
  const missingTypes = [];
  for (const type of expectedTypes) {
    const hit = byType.get(type);
    if (hit) creditSum += hit.credit;
    else missingTypes.push(type);
  }
  return {
    score: clampScore((creditSum / expectedTypes.length) * 100),
    present: expectedTypes.length - missingTypes.length,
    total: expectedTypes.length,
    missingTypes,
  };
}

export function scoreIngestionSuccess(jobs = []) {
  const terminal = jobs.filter((j) => ["completed", "failed", "skipped"].includes(j.status));
  if (!terminal.length) {
    return { score: null, completed: 0, failed: 0, total: 0, noJobs: true };
  }
  const completed = terminal.filter((j) => j.status === "completed").length;
  const failed = terminal.filter((j) => j.status === "failed").length;
  const total = terminal.length;
  const stuck = jobs.filter((j) => ["registered", "queued", "processing"].includes(j.status)).length;
  let score = (completed / total) * 100;
  if (stuck > 0) score -= Math.min(15, stuck * 3);
  return { score: clampScore(score), completed, failed, total, stuck, noJobs: false };
}

export function scoreParserSuccess(coverage = []) {
  if (!coverage.length) return { score: 0, ready: 0, partial: 0, failed: 0, total: 0 };
  let creditSum = 0;
  let ready = 0;
  let partial = 0;
  let failed = 0;
  for (const row of coverage) {
    const status = row.readinessStatus || row.readiness_status;
    const facts = row.factCount ?? row.fact_count ?? 0;
    const credit = readinessCredit(status, facts);
    creditSum += credit;
    if (status === "ready") ready += 1;
    else if (status === "partial") partial += 1;
    else if (facts === 0) failed += 1;
  }
  return {
    score: clampScore((creditSum / coverage.length) * 100),
    ready,
    partial,
    failed,
    total: coverage.length,
  };
}

export function assessDashboardReadiness({
  weekAggregation = null,
  manualInputs = [],
  logbookFacts = [],
  googleReviewFacts = [],
  historicalDashboardCoverage = [],
} = {}) {
  const manualKeys = new Set((manualInputs || []).map((i) => i.metricKey || i.metric_key));
  const checks = DASHBOARD_READINESS_CHECKS.map((check) => {
    let satisfied = false;
    let detail = "";

    switch (check.key) {
      case "cash_up_week":
        satisfied = Boolean(weekAggregation?.dayCount > 0 && weekAggregation?.totalSales != null);
        detail = satisfied
          ? `${weekAggregation.dayCount} cash-up day(s) indexed`
          : "No cash-up aggregation for the week";
        break;
      case "seven_rooms_covers":
        satisfied = manualKeys.has("seven_rooms_covers");
        detail = satisfied ? "7Rooms covers provided via manual input" : "7Rooms covers not provided";
        break;
      case "logbook_google_reviews": {
        const facts = googleReviewFacts?.length ? googleReviewFacts : (logbookFacts || []).filter((f) =>
          /^google_review_\d$/.test(String(f.metricKey || f.metric_key || "")),
        );
        const total = facts.reduce((sum, f) => sum + (Number(f.metricValue ?? f.metric_value) || 0), 0);
        satisfied = total > 0;
        detail = satisfied ? `${total} Google review count(s) in logbook facts` : "No Google review star counts in logbook";
        break;
      }
      case "logbook_commentary":
        satisfied = (logbookFacts || []).some((f) => String(f.dimensions?.text_value || "").trim().length > 8);
        detail = satisfied ? "Logbook commentary indexed" : "No logbook commentary text extracted";
        break;
      case "historical_weekly_dashboard":
        satisfied = (historicalDashboardCoverage || []).length > 0;
        detail = satisfied
          ? `${historicalDashboardCoverage.length} weekly dashboard file(s) in coverage`
          : "No historical weekly dashboard in coverage registry";
        break;
      default:
        detail = "Unknown check";
    }

    return { ...check, satisfied, detail };
  });

  const weighted = checks.reduce((sum, c) => sum + (c.satisfied ? c.weight : 0), 0);
  const missing = checks.filter((c) => !c.satisfied).map((c) => c.label);
  return { score: clampScore(weighted * 100), checks, missing };
}

export function assessExecutiveIntelligenceReadiness({
  coverage = [],
  guestFeedbackCoverage = [],
} = {}) {
  const byType = new Map();
  for (const row of [...coverage, ...guestFeedbackCoverage]) {
    const type = row.reportType || row.report_type;
    if (type) byType.set(type, row);
  }

  const weights = {
    cash_up: 0.25,
    daily_briefing: 0.25,
    daily_logbook: 0.2,
    guest_feedback: 0.15,
    weekly_dashboard: 0.15,
  };

  let creditSum = 0;
  const missing = [];
  const present = [];

  for (const type of EXECUTIVE_INTELLIGENCE_REPORT_TYPES) {
    const row = byType.get(type);
    const credit = row ? readinessCredit(row.readinessStatus || row.readiness_status, row.factCount ?? row.fact_count) : 0;
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

export function buildMissingInformationRegistry(snapshot = {}) {
  const {
    coverage = [],
    expectedTypes = OPERATIONAL_COVERAGE_REPORT_TYPES,
    ingestionJobs = [],
    manualInputs = [],
    pendingSessions = [],
    discoveryCandidates = [],
    periodLabel = null,
    startDate = null,
    endDate = null,
  } = snapshot;

  const coveredTypes = new Set((coverage || []).map((r) => r.reportType || r.report_type));
  const missingReports = expectedTypes
    .filter((t) => !coveredTypes.has(t))
    .map((reportType) => ({
      reportType,
      label: reportLabel(reportType),
      periodLabel,
      reason: `No coverage row in ask_nac_data_coverage for ${periodLabel || "the assessed period"}.`,
      howToFix: `Upload or sync ${reportLabel(reportType)} for ${periodLabel || "this period"} via Company Knowledge or approved Drive folders.`,
      source: "ask_nac_data_coverage",
    }));

  const missingDates = (coverage || [])
    .filter((row) => (row.readinessStatus || row.readiness_status) === "stale" || (row.factCount ?? row.fact_count) === 0)
    .map((row) => ({
      reportType: row.reportType || row.report_type,
      label: row.fileTitle || reportLabel(row.reportType || row.report_type),
      date: row.periodEnd || row.period_end || row.periodStart || row.period_start,
      reason: row.readinessStatus === "stale" ? "Coverage marked stale." : "Registered but zero structured facts extracted.",
      howToFix: "Re-upload the file or re-run ingestion after parser fixes.",
      source: "ask_nac_data_coverage",
    }));

  const failedExtractions = (ingestionJobs || [])
    .filter((j) => j.status === "failed")
    .slice(0, 12)
    .map((j) => ({
      fileTitle: j.fileTitle || j.file_id,
      error: j.error || "Ingestion failed",
      finishedAt: j.finishedAt || j.finished_at,
      howToFix: "Open the file in Company Knowledge, verify format, and re-ingest or upload a corrected export.",
      source: "ask_nac_ingestion_jobs",
    }));

  const manualKeys = new Set((manualInputs || []).map((i) => i.metricKey || i.metric_key));
  const missingManualInputs = MANUAL_INPUT_REQUIREMENTS
    .filter((f) => !manualKeys.has(f.key))
    .map((f) => ({
      key: f.key,
      label: f.label,
      periodLabel,
      reason: `No row in ask_nac_manual_inputs for ${f.label}.`,
      howToFix: f.prompt || `Provide ${f.label} when Ask NAC prompts, or answer a weekly dashboard follow-up.`,
      source: "ask_nac_manual_inputs",
    }));

  const pendingSessionEntries = (pendingSessions || []).map((s) => ({
    id: s.id,
    sessionType: s.sessionType || s.session_type,
    missingFields: (s.missingFields || s.missing_fields || []).map((f) => f.label || f.key),
    howToFix: "Reply to the pending Ask NAC follow-up with the requested values.",
    source: "ask_nac_pending_sessions",
  }));

  const unapprovedFolders = (discoveryCandidates || [])
    .filter((c) => c.status === "pending" && ["ask", "unknown_needs_review"].includes(c.recommendedAction || c.recommended_action))
    .map((c) => ({
      folderPath: c.folderPath || c.folder_path,
      detectedReportType: c.detectedReportType || c.detected_report_type,
      reason: c.reason || "Awaiting operator approval before ingest.",
      howToFix: "Run Drive discovery approval: e.g. “approve Guest Feedback as ask”.",
      source: "ask_nac_drive_discovery_candidates",
    }));

  return {
    missingReports,
    missingDates,
    failedExtractions,
    missingManualInputs,
    pendingSessions: pendingSessionEntries,
    unapprovedFolders,
    period: { startDate, endDate, label: periodLabel },
  };
}

export function buildRecommendations(health = {}) {
  const recs = [];
  const registry = health.missingRegistry || {};
  const push = (what, why, how) => recs.push({ what, why, how });

  for (const item of registry.missingReports || []) {
    push(item.label, item.reason, item.howToFix);
  }
  for (const item of registry.failedExtractions || []) {
    push(item.fileTitle, `Parser/ingestion failed: ${item.error}`, item.howToFix);
  }
  for (const item of registry.missingManualInputs || []) {
    push(item.label, "Required for weekly dashboard completeness.", item.howToFix);
  }
  for (const item of registry.unapprovedFolders || []) {
    push(item.folderPath, item.reason, item.howToFix);
  }
  for (const item of registry.pendingSessions || []) {
    push(
      `Pending ${item.sessionType} session`,
      `Awaiting: ${(item.missingFields || []).join(", ") || "manual input"}`,
      item.howToFix,
    );
  }
  for (const reason of health.executiveReadiness?.confidenceReductionReasons || []) {
    if (!recs.some((r) => r.what === reason)) {
      push(reason, "Reduces executive / why-analysis confidence.", `Upload or sync ${reason.replace(/ missing.*/i, "")} for the period.`);
    }
  }

  return recs.slice(0, 12);
}

export function computeKnowledgeHealth(snapshot = {}) {
  const coverage = snapshot.coverage || [];
  const coverageScore = scoreCoverageCompleteness(coverage);
  const ingestionScore = scoreIngestionSuccess(snapshot.ingestionJobs || []);
  const parserScore = scoreParserSuccess(coverage);
  const dashboardReadiness = assessDashboardReadiness(snapshot);
  const executiveReadiness = assessExecutiveIntelligenceReadiness({
    coverage,
    guestFeedbackCoverage: snapshot.guestFeedbackCoverage || [],
  });

  const components = {
    coverageCompleteness: coverageScore.score,
    ingestionSuccess: ingestionScore.score,
    parserSuccess: parserScore.score,
    dashboardReadiness: dashboardReadiness.score,
    executiveIntelligenceReadiness: executiveReadiness.score,
  };

  const weights = HEALTH_SCORE_WEIGHTS;
  let weightSum = 0;
  let weightedSum = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const value = components[key];
    if (value == null) continue;
    weightSum += weight;
    weightedSum += value * weight;
  }
  if (ingestionScore.noJobs) {
    const redistributed = {
      coverageCompleteness: weights.coverageCompleteness,
      parserSuccess: weights.parserSuccess,
      dashboardReadiness: weights.dashboardReadiness,
      executiveIntelligenceReadiness: weights.executiveIntelligenceReadiness,
    };
    weightSum = Object.values(redistributed).reduce((a, b) => a + b, 0);
    weightedSum = (
      components.coverageCompleteness * redistributed.coverageCompleteness
      + components.parserSuccess * redistributed.parserSuccess
      + components.dashboardReadiness * redistributed.dashboardReadiness
      + components.executiveIntelligenceReadiness * redistributed.executiveIntelligenceReadiness
    );
  }

  const overallScore = weightSum > 0 ? clampScore(weightedSum / weightSum) : 0;
  const missingRegistry = buildMissingInformationRegistry(snapshot);

  const health = {
    branch: snapshot.branch,
    branchLabel: snapshot.branchLabel,
    periodLabel: snapshot.periodLabel,
    overallScore,
    components,
    componentDetail: { coverageScore, ingestionScore, parserScore, dashboardReadiness, executiveReadiness },
    executiveReadiness,
    missingRegistry,
    recommendations: [],
    sources: snapshot.sources || [],
    disclosures: ingestionScore.noJobs ? ["No ask_nac_ingestion_jobs in the assessed window — ingestion success omitted from score."] : [],
  };

  health.recommendations = buildRecommendations(health);
  return health;
}
