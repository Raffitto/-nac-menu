/**
 * Deterministic Ask NAC answers from Data Vault structured facts.
 */

import { READINESS } from "../readinessEngine";
import {
  ANSWER_TYPES,
  CONFIDENCE_LEVELS,
  createAskNacResponse,
  metricEntry,
  sourceEntry,
} from "../askNacContract";
import { ASK_NAC_INTENTS } from "../intentRouter";
import {
  collectVaultSources,
  extractDocumentSearchTerms,
  groupFactsByReportType,
  pickMetricValue,
  pickTextFact,
} from "./vaultQueryTools";
import { DOCUMENT_SEARCH_MESSAGES, DOCUMENT_SEARCH_STATUS } from "./vaultDocumentSearchRetrieval";
import {
  assessSearchMatchConfidence,
  buildOperationalSearchDirectAnswer,
} from "./vaultDocumentSearchRanking";
import { buildDocumentSummaryAnswerContent } from "./vaultDocumentSummary";

const REPORT_LABELS = Object.freeze({
  cash_up: "Cash Up",
  reception_daily_report: "Reception Daily Report",
  daily_logbook: "Daily Logbook",
  ccm_reconciliation: "CCM Reconciliation",
});

function formatNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (Number.isFinite(n)) return n.toLocaleString();
  return String(value);
}

function vaultConfidence(tool) {
  const sources = tool?.vaultSources || collectVaultSources(tool?.facts || [], tool?.coverage || []);
  const low = sources.some((s) => s.confidence != null && s.confidence < 0.55);
  const partial = (tool?.coverage || []).some((c) => c.readinessStatus === "partial");
  if (low || partial) return CONFIDENCE_LEVELS.MEDIUM;
  if (!tool?.facts?.length) return CONFIDENCE_LEVELS.LOW;
  return CONFIDENCE_LEVELS.HIGH;
}

function vaultSourceEntries(tool) {
  const files = tool?.vaultSources || collectVaultSources(tool?.facts || [], tool?.coverage || []);
  return files.map((f) =>
    sourceEntry(f.title, `${REPORT_LABELS[f.reportType] || f.reportType || "vault"} · uploaded file`),
  );
}

function vaultFileChips(tool) {
  return (tool?.vaultSources || collectVaultSources(tool?.facts || [], tool?.coverage || [])).map((f) => ({
    fileId: f.fileId,
    title: f.title,
    reportType: f.reportType,
    confidence: f.confidence,
    parserVersion: f.parserVersion,
  }));
}

function baseVaultFields(route, tool, readiness) {
  return {
    branchLabel: tool?.branchLabel || route.debug?.branchLabel || null,
    periodLabel: tool?.periodLabel || route.vaultPeriod?.label || route.vaultPeriod?.startDate,
    confidence: vaultConfidence(tool),
    vaultSources: vaultFileChips(tool),
    sources: [
      ...vaultSourceEntries(tool),
      ...(tool?.sources || []).map((s) => sourceEntry(s.name, s.detail)),
    ],
    warnings: [
      ...(tool?.warnings || []),
      ...(readiness?.warnings || []),
      ...(readiness?.status === READINESS.PARTIAL ? readiness?.reasons || [] : []),
    ],
    isAiGenerated: false,
    intent: route.intent,
  };
}

function cashUpMetrics(facts = []) {
  const keys = [
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
    .filter(Boolean);
}

function receptionMetrics(facts = []) {
  const keys = [
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
    .filter(Boolean);
}

function googleStarMetrics(facts = []) {
  return [1, 2, 3, 4, 5]
    .map((star) => {
      const value = pickMetricValue(facts, `google_review_${star}`);
      if (value == null) return null;
      return metricEntry(`${star}-star Google reviews`, formatNumber(value), { source: "logbook / reception" });
    })
    .filter(Boolean);
}

function logbookNotes(facts = []) {
  const notes = [];
  const textKeys = [
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

function ccmMetrics(facts = []) {
  const keys = [
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
    .filter(Boolean);
}

export function buildVaultCoverageListAnswer(route, tool, readiness) {
  const rows = tool?.coverage || [];
  const directAnswer = rows.length
    ? `${rows.length} uploaded vault file coverage record(s) for ${tool.periodLabel || "the requested period"}.`
    : `No uploaded vault files cover ${tool.periodLabel || "the requested period"} under your access scope.`;

  return createAskNacResponse({
    ...baseVaultFields(route, tool, readiness),
    answerType: rows.length ? ANSWER_TYPES.COMPARISON : ANSWER_TYPES.MISSING_DATA,
    title: `Vault file coverage · ${tool.periodLabel || "period"}`,
    directAnswer,
    keyMetrics: rows.map((row) =>
      metricEntry(row.fileTitle || "Uploaded file", row.factCount ?? "—", {
        unit: "facts",
        note: `${REPORT_LABELS[row.reportType] || row.reportType} · ${row.readinessStatus || "registered"}`,
        source: row.sourceFileId,
      }),
    ),
    insights: rows.map(
      (row) =>
        `${row.fileTitle}: ${REPORT_LABELS[row.reportType] || row.reportType} (${row.periodStart} – ${row.periodEnd})`,
    ),
  });
}

export function buildVaultCashUpAnswer(route, tool, readiness) {
  const metrics = cashUpMetrics(tool?.facts || []);
  const net = pickMetricValue(tool?.facts, "net_sales") ?? pickMetricValue(tool?.facts, "total_sales");
  const directAnswer = net != null
    ? `Cash-up vault data shows net/total sales of ${formatNumber(net)} SAR for ${tool.branchLabel} on ${tool.periodLabel}.`
    : `No cash-up structured facts found for ${tool.branchLabel} on ${tool.periodLabel}.`;

  return createAskNacResponse({
    ...baseVaultFields(route, tool, readiness),
    answerType: metrics.length ? ANSWER_TYPES.METRIC : ANSWER_TYPES.MISSING_DATA,
    title: `Cash-up · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: metrics,
  });
}

export function buildVaultReceptionAnswer(route, tool, readiness) {
  const metrics = receptionMetrics(tool?.facts || []);
  const reservations = pickMetricValue(tool?.facts, "reservations");
  const directAnswer = reservations != null
    ? `Reception/logbook vault data: ${formatNumber(reservations)} reservations for ${tool.branchLabel} on ${tool.periodLabel}.`
    : `No reception or logbook reservation metrics found for ${tool.branchLabel} on ${tool.periodLabel}.`;

  return createAskNacResponse({
    ...baseVaultFields(route, tool, readiness),
    answerType: metrics.length ? ANSWER_TYPES.METRIC : ANSWER_TYPES.MISSING_DATA,
    title: `Reception · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: metrics,
  });
}

export function buildVaultLogbookAnswer(route, tool, readiness) {
  const facts = tool?.facts || [];
  const metrics = receptionMetrics(facts);
  const notes = logbookNotes(facts);
  const directAnswer = notes.length
    ? `Logbook notes for ${tool.branchLabel} on ${tool.periodLabel}: ${notes[0]}`
    : metrics.length
      ? `Logbook operational metrics for ${tool.branchLabel} on ${tool.periodLabel} are listed below.`
      : `No logbook structured facts found for ${tool.branchLabel} on ${tool.periodLabel}.`;

  return createAskNacResponse({
    ...baseVaultFields(route, tool, readiness),
    answerType: metrics.length || notes.length ? ANSWER_TYPES.METRIC : ANSWER_TYPES.MISSING_DATA,
    title: `Logbook · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: metrics,
    insights: notes,
  });
}

export function buildVaultGoogleStarsAnswer(route, tool, readiness) {
  const metrics = googleStarMetrics(tool?.facts || []);
  const five = pickMetricValue(tool?.facts, "google_review_5");
  const directAnswer = five != null
    ? `${tool.branchLabel} recorded ${formatNumber(five)} five-star Google reviews on ${tool.periodLabel} (from uploaded logbook/reception files).`
    : `No Google review star counts found in vault files for ${tool.branchLabel} on ${tool.periodLabel}.`;

  return createAskNacResponse({
    ...baseVaultFields(route, tool, readiness),
    answerType: metrics.length ? ANSWER_TYPES.METRIC : ANSWER_TYPES.MISSING_DATA,
    title: `Google review stars · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: metrics,
  });
}

export function buildVaultCcmAnswer(route, tool, readiness) {
  const metrics = ccmMetrics(tool?.facts || []);
  const status = pickMetricValue(tool?.facts, "reconciliation_status");
  const directAnswer = status != null
    ? `CCM reconciliation status for ${tool.branchLabel} on ${tool.periodLabel}: ${status}.`
    : metrics.length
      ? `CCM reconciliation metrics for ${tool.branchLabel} on ${tool.periodLabel} are listed below.`
      : `No CCM reconciliation facts found for ${tool.branchLabel} on ${tool.periodLabel}.`;

  return createAskNacResponse({
    ...baseVaultFields(route, tool, readiness),
    answerType: metrics.length ? ANSWER_TYPES.METRIC : ANSWER_TYPES.MISSING_DATA,
    title: `CCM reconciliation · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: metrics,
  });
}

export function buildVaultOperationalDayAnswer(route, tool, readiness) {
  const byReport = tool?.byReport || groupFactsByReportType(tool?.facts || []);
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
  const sections = [];
  if (cashFacts.length) sections.push("cash-up sales and guest counts");
  if (receptionFacts.length) sections.push("reception reservations and covers");
  if (logbookFacts.some((f) => String(f.metricKey).startsWith("google_review_"))) {
    sections.push("Google review star counts");
  }
  if (notes.length) sections.push("operational logbook notes");
  if (ccmFacts.length) sections.push("CCM reconciliation");

  const directAnswer = keyMetrics.length || notes.length
    ? `Operational summary for ${tool.branchLabel} on ${tool.periodLabel}${sections.length ? `: ${sections.join("; ")}` : "."} All figures are from uploaded vault files only.`
    : `No vault structured facts cover ${tool.branchLabel} on ${tool.periodLabel} under your access scope.`;

  return createAskNacResponse({
    ...baseVaultFields(route, tool, readiness),
    answerType: keyMetrics.length || notes.length ? ANSWER_TYPES.COMPARISON : ANSWER_TYPES.MISSING_DATA,
    title: `Operational day · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics,
    insights: notes,
    recommendations: tool?.vaultSources?.length
      ? [`Source files: ${tool.vaultSources.map((s) => s.title).join(" · ")}`]
      : [],
  });
}

export function buildVaultManagementReportAnswer(route, tool, readiness) {
  const dayAnswer = buildVaultOperationalDayAnswer(route, tool, readiness);
  return createAskNacResponse({
    ...dayAnswer,
    title: `Management report · ${tool.periodLabel}`,
    directAnswer: `Management report for ${tool.branchLabel} on ${tool.periodLabel} (Data Vault only — no live POS estimates). ${dayAnswer.directAnswer}`,
    insights: [
      ...(dayAnswer.insights || []),
      "Figures are deterministic from ask_nac_structured_facts; missing sections were omitted rather than estimated.",
    ],
  });
}

export function buildVaultMissingToolResponse(route, tool, readiness) {
  return createAskNacResponse({
    answerType: ANSWER_TYPES.MISSING_DATA,
    title: "Vault data not available",
    directAnswer:
      readiness?.reasons?.[0] ||
      `No uploaded vault coverage matches ${route.vaultPeriod?.label || "this period"} for the required report types.`,
    keyMetrics: [],
    missingData: readiness?.missingData || [],
    warnings: readiness?.reasons || [],
    confidence: CONFIDENCE_LEVELS.NONE,
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: route.vaultPeriod?.label,
    readiness,
    vaultSources: [],
  });
}

export function buildVaultDocumentSearchAnswer(route, tool, readiness) {
  const matches = tool?.matches || [];
  const searchTerms = tool?.searchTerms || extractDocumentSearchTerms(route?.question || "");
  const queryStatus = tool?.queryStatus;

  if (queryStatus === DOCUMENT_SEARCH_STATUS.CONNECTION_ERROR) {
    return createAskNacResponse({
      answerType: ANSWER_TYPES.ERROR,
      title: "Document search",
      directAnswer: DOCUMENT_SEARCH_MESSAGES.CONNECTION_FAILED,
      keyMetrics: [],
      insights: [],
      recommendations: [],
      confidence: CONFIDENCE_LEVELS.NONE,
      isAiGenerated: false,
      intent: route.intent,
      branchLabel: tool?.branchLabel,
      vaultSources: [],
      warnings: tool?.searchError ? [tool.searchError] : [],
      readiness,
    });
  }

  if (queryStatus === DOCUMENT_SEARCH_STATUS.AUTH_ERROR) {
    return createAskNacResponse({
      answerType: ANSWER_TYPES.ERROR,
      title: "Document search",
      directAnswer: DOCUMENT_SEARCH_MESSAGES.AUTH_FAILED,
      keyMetrics: [],
      insights: [],
      recommendations: [],
      confidence: CONFIDENCE_LEVELS.NONE,
      isAiGenerated: false,
      intent: route.intent,
      branchLabel: tool?.branchLabel,
      vaultSources: [],
      warnings: tool?.searchError ? [tool.searchError] : [],
      readiness,
    });
  }

  if (!matches.length) {
    return createAskNacResponse({
      answerType: ANSWER_TYPES.DOCUMENT_NO_MATCH,
      title: "Document search",
      directAnswer: DOCUMENT_SEARCH_MESSAGES.NO_MATCH,
      keyMetrics: [],
      insights: [],
      recommendations: [],
      confidence: CONFIDENCE_LEVELS.LOW,
      isAiGenerated: false,
      intent: route.intent,
      branchLabel: tool?.branchLabel,
      vaultSources: [],
      warnings: [],
      readiness,
      searchMethod: tool?.searchMethod || null,
    });
  }

  const fileNames = [...new Set(matches.map((m) => m.fileTitle))];
  const operationalAnswer = buildOperationalSearchDirectAnswer(searchTerms, matches);
  const summary =
    operationalAnswer ||
    `Found ${matches.length} mention${matches.length === 1 ? "" : "s"} of “${searchTerms}” across ${fileNames.length} file${fileNames.length === 1 ? "" : "s"}.`;

  const confidenceLevel = assessSearchMatchConfidence(matches, searchTerms);
  const confidence =
    confidenceLevel === "high"
      ? CONFIDENCE_LEVELS.HIGH
      : confidenceLevel === "medium"
        ? CONFIDENCE_LEVELS.MEDIUM
        : CONFIDENCE_LEVELS.LOW;

  const keyMetrics = matches.slice(0, 8).map((m) =>
    metricEntry(m.fileTitle, m.excerpt, {
      unit: m.pageNo != null ? `p. ${m.pageNo}` : m.sectionLabel || "",
      source: m.citation,
      note: m.sectionLabel || undefined,
    }),
  );

  const insights = matches.slice(0, 5).map(
    (m) => `${m.fileTitle}${m.pageNo != null ? ` (p. ${m.pageNo})` : ""}${m.sectionLabel ? ` · ${m.sectionLabel}` : ""}: “${m.excerpt}” [${m.citation}]`,
  );

  return createAskNacResponse({
    ...baseVaultFields(route, tool, readiness),
    answerType: ANSWER_TYPES.COMPARISON,
    title: `Document search · “${searchTerms}”`,
    directAnswer: summary,
    searchTerms,
    keyMetrics,
    insights,
    recommendations: [`Citations: ${matches.slice(0, 5).map((m) => m.citation).join("; ")}`],
    confidence,
    isAiGenerated: false,
    intent: route.intent,
    branchLabel: tool?.branchLabel,
    searchMethod: tool?.searchMethod || "fts",
    vaultSources: (tool?.vaultSources || []).map((f) => ({
      fileId: f.fileId,
      title: f.title,
      reportType: f.reportType,
    })),
  });
}

export function buildVaultDocumentSummaryAnswer(route, tool, readiness) {
  const chunks = tool?.chunks || tool?.matches || [];
  const queryStatus = tool?.queryStatus;

  if (queryStatus === "connection_error") {
    return createAskNacResponse({
      answerType: ANSWER_TYPES.ERROR,
      title: "Document summary",
      directAnswer: DOCUMENT_SEARCH_MESSAGES.CONNECTION_FAILED,
      keyMetrics: [],
      insights: [],
      confidence: CONFIDENCE_LEVELS.NONE,
      isAiGenerated: false,
      intent: route.intent,
      branchLabel: tool?.branchLabel,
      vaultSources: [],
      warnings: tool?.searchError ? [tool.searchError] : [],
      readiness,
    });
  }

  if (!chunks.length) {
    return createAskNacResponse({
      answerType: ANSWER_TYPES.DOCUMENT_NO_MATCH,
      title: "Document summary",
      directAnswer: queryStatus === "no_document"
        ? "No uploaded document was found to summarize under your access scope."
        : DOCUMENT_SEARCH_MESSAGES.NO_MATCH,
      keyMetrics: [],
      insights: [],
      confidence: CONFIDENCE_LEVELS.LOW,
      isAiGenerated: false,
      intent: route.intent,
      branchLabel: tool?.branchLabel,
      vaultSources: [],
      readiness,
    });
  }

  const summary = buildDocumentSummaryAnswerContent({
    chunks,
    fileTitles: tool?.fileTitles || [],
    branchLabel: tool?.branchLabel || "Network",
  });

  return createAskNacResponse({
    ...baseVaultFields(route, tool, readiness),
    answerType: ANSWER_TYPES.EXECUTIVE,
    title: `Document summary · ${tool?.fileTitles?.[0] || chunks[0]?.fileTitle || "Uploaded document"}`,
    directAnswer: summary.directAnswer,
    keyMetrics: summary.keyMetrics.map((m) => metricEntry(m.label, m.value, {
      unit: m.unit,
      source: m.source,
      note: m.note,
    })),
    insights: summary.insights,
    recommendations: summary.recommendations,
    confidence: CONFIDENCE_LEVELS.HIGH,
    isAiGenerated: false,
    intent: route.intent,
    branchLabel: tool?.branchLabel,
    vaultSources: (tool?.vaultSources || []).map((f) => ({
      fileId: f.fileId,
      title: f.title,
      reportType: f.reportType,
    })),
  });
}

export function buildVaultAnswer(route, tool, readiness) {
  if (route.intent === ASK_NAC_INTENTS.VAULT_DOCUMENT_SUMMARY) {
    return buildVaultDocumentSummaryAnswer(route, tool, readiness);
  }

  if (route.intent === ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH) {
    if (!tool?.matches?.length && readiness?.status === READINESS.MISSING) {
      return buildVaultMissingToolResponse(route, tool, readiness);
    }
    return buildVaultDocumentSearchAnswer(route, tool, readiness);
  }

  if (!tool?.facts?.length && !(tool?.coverage?.length) && readiness?.status === READINESS.MISSING) {
    return buildVaultMissingToolResponse(route, tool, readiness);
  }

  switch (route.intent) {
    case ASK_NAC_INTENTS.VAULT_COVERAGE_LIST:
      return buildVaultCoverageListAnswer(route, tool, readiness);
    case ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY:
      return buildVaultCashUpAnswer(route, tool, readiness);
    case ASK_NAC_INTENTS.VAULT_RECEPTION_SUMMARY:
      return buildVaultReceptionAnswer(route, tool, readiness);
    case ASK_NAC_INTENTS.VAULT_LOGBOOK_SUMMARY:
      return buildVaultLogbookAnswer(route, tool, readiness);
    case ASK_NAC_INTENTS.VAULT_GOOGLE_REVIEW_STAR_SUMMARY:
      return buildVaultGoogleStarsAnswer(route, tool, readiness);
    case ASK_NAC_INTENTS.VAULT_CCM_RECONCILIATION_SUMMARY:
      return buildVaultCcmAnswer(route, tool, readiness);
    case ASK_NAC_INTENTS.VAULT_OPERATIONAL_DAY_SUMMARY:
      return buildVaultOperationalDayAnswer(route, tool, readiness);
    case ASK_NAC_INTENTS.VAULT_MANAGEMENT_REPORT:
      return buildVaultManagementReportAnswer(route, tool, readiness);
    default:
      return buildVaultMissingToolResponse(route, tool, readiness);
  }
}
