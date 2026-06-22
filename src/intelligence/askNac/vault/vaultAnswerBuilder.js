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
import {
  buildCrossDocumentOperationalSummary,
  buildOperationalManagerAnswer,
  formatManagerStyleAnswer,
} from "./vaultOperationalIntelligence";
import {
  buildSalesPerformanceExecutiveSummary,
  buildCashUpPeriodAggregateAnswer,
  buildCashUpDeliveryPlatformMetrics,
  buildCashUpPeriodCompareMetrics,
  isDeliveryPlatformPeriodQuery,
  extendedSalesPerformanceMetrics,
  appendCoverageToAggregateAnswer,
} from "./vaultSalesPerformanceIntelligence";
import { assessPeriodCoverage, buildCoverageAnswerLines } from "../coverage/coverageAwareness";
import { resolveAnalyticalConfidence } from "../confidence/analyticalConfidence";
import { buildDocumentSummaryAnswerContent } from "./vaultDocumentSummary";
import { buildCashUpExecutiveBrief } from "./vaultCashUpExecutiveBrief";
import { buildVaultBusinessReasoningAnswer } from "./vaultBusinessReasoningAnswer";

const REPORT_LABELS = Object.freeze({
  cash_up: "Cash Up",
  reception_daily_report: "Reception Daily Report",
  daily_logbook: "Daily Logbook",
  ccm_reconciliation: "CCM Reconciliation",
});

function resolveRouteQuestion(route) {
  return route?.question
    || route?.debug?.nlu?.normalizedQuestion
    || "";
}

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
    sourceEntry(f.title, [
      REPORT_LABELS[f.reportType] || f.reportType || "vault",
      f.periodStart || f.periodEnd || null,
      "uploaded file",
    ].filter(Boolean).join(" · ")),
  );
}

function vaultFileChips(tool) {
  return (tool?.vaultSources || collectVaultSources(tool?.facts || [], tool?.coverage || [])).map((f) => ({
    fileId: f.fileId,
    title: f.title,
    reportType: f.reportType,
    periodStart: f.periodStart,
    periodEnd: f.periodEnd,
    confidence: f.confidence,
    parserVersion: f.parserVersion,
  }));
}

function formatKnowledgeSource(item = {}) {
  const title = item.title || item.fileTitle || "Uploaded file";
  const reportType = item.reportType ? (REPORT_LABELS[item.reportType] || item.reportType) : null;
  const date = item.periodStart || item.periodEnd || item.date || null;
  return [title, date, reportType].filter(Boolean).join(" — ");
}

function buildKnowledgeSourceLines(items = []) {
  const seen = new Set();
  const lines = [];
  for (const item of items) {
    const line = formatKnowledgeSource(item);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    lines.push(`• ${line}`);
    if (lines.length >= 8) break;
  }
  return lines;
}

function buildSourcesRecommendation(items = []) {
  const lines = buildKnowledgeSourceLines(items);
  return lines.length ? `Sources:\n${lines.join("\n")}` : null;
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
  const facts = tool?.facts || [];
  const aggregation = tool?.aggregation || null;

  if (aggregation) {
    if (aggregation.dayCount === 0) {
      return createAskNacResponse({
        ...baseVaultFields(route, tool, readiness),
        answerType: ANSWER_TYPES.MISSING_DATA,
        title: `Cash-up · ${tool?.periodLabel || "query"}`,
        directAnswer: `No cash-up structured facts matched ${tool?.periodLabel || route?.vaultPeriod?.label || "the requested period"}.`,
        warnings: tool?.warnings || [],
      });
    }

    const question = resolveRouteQuestion(route);
    const previousAggregation = tool.previousAggregation || null;
    const previousPeriodLabel = tool.vaultCompare?.previous?.label || null;

    const coverageAssessment = assessPeriodCoverage({
      requestedPeriod: route?.vaultPeriod || {
        startDate: tool?.startDate,
        endDate: tool?.endDate,
        label: tool?.periodLabel,
        periodType: route?.vaultPeriod?.periodType,
      },
      aggregation,
    });
    const confidenceResult = resolveAnalyticalConfidence({ route, tool, coverageAssessment });

    let resolvedAnswer = buildCashUpPeriodAggregateAnswer(question, aggregation, {
      branchLabel: tool.branchLabel,
      periodLabel: tool.periodLabel,
      previousAggregation,
      previousPeriodLabel,
    });
    resolvedAnswer = appendCoverageToAggregateAnswer(
      resolvedAnswer,
      question,
      aggregation,
      route?.vaultPeriod || { label: tool.periodLabel, periodType: route?.vaultPeriod?.periodType },
    );

    const isPlatformQuery = isDeliveryPlatformPeriodQuery(question) && !previousAggregation;
    const metrics = previousAggregation
      ? buildCashUpPeriodCompareMetrics(aggregation, previousAggregation)
      : isPlatformQuery
        ? buildCashUpDeliveryPlatformMetrics(aggregation, question)
        : [];
    if (!isPlatformQuery && !previousAggregation) {
    if (aggregation.totalSales != null) {
      metrics.push(metricEntry("Total sales", formatNumber(aggregation.totalSales), { unit: "SAR", source: "cash_up" }));
      if (aggregation.dayCount > 0) {
        metrics.push(metricEntry(
          "Average sales per day",
          formatNumber(aggregation.totalSales / aggregation.dayCount),
          { unit: "SAR", source: "cash_up" },
        ));
      }
    }
    if (aggregation.totalGuests != null) {
      metrics.push(metricEntry("Total guests", formatNumber(aggregation.totalGuests), { source: "cash_up" }));
    }
    if (aggregation.totalDeliverySales != null) {
      metrics.push(metricEntry("Total delivery sales", formatNumber(aggregation.totalDeliverySales), { unit: "SAR", source: "cash_up" }));
      if (aggregation.dayCount > 0) {
        metrics.push(metricEntry(
          "Average delivery sales per day",
          formatNumber(aggregation.totalDeliverySales / aggregation.dayCount),
          { unit: "SAR", source: "cash_up" },
        ));
      }
    }
    if (aggregation.totalDeliveryOrders != null) {
      metrics.push(metricEntry("Total delivery orders", formatNumber(aggregation.totalDeliveryOrders), { source: "cash_up" }));
    }
    if (aggregation.averageSpend != null) {
      metrics.push(metricEntry("Average spend", formatNumber(aggregation.averageSpend), { unit: "SAR", source: "cash_up" }));
    }
    metrics.push(metricEntry("Days included", formatNumber(aggregation.dayCount), { source: "cash_up" }));
    }

    const platformInsights = isPlatformQuery && aggregation.deliveryPlatformBreakdown
      ? Object.keys(aggregation.deliveryPlatformBreakdown)
        .sort((a, b) => (aggregation.deliveryPlatformBreakdown[b]?.sales || 0) - (aggregation.deliveryPlatformBreakdown[a]?.sales || 0))
        .map((key) => {
          const row = aggregation.deliveryPlatformBreakdown[key];
          return `${key}: ${formatNumber(row.sales)} SAR sales, ${formatNumber(row.orders)} orders`;
        })
      : [];

    const coverageWarnings = [
      ...(tool?.warnings || []),
      ...coverageAssessment.coverageNotes.filter(
        (note) => !(tool?.warnings || []).some((w) => String(w).includes(note.slice(0, 24))),
      ),
    ];

    return createAskNacResponse({
      ...baseVaultFields(route, tool, readiness),
      answerType: metrics.length ? ANSWER_TYPES.METRIC : ANSWER_TYPES.EXECUTIVE,
      title: isPlatformQuery
        ? `Delivery platform breakdown · ${tool.periodLabel}`
        : previousAggregation
          ? `Period comparison · ${tool.periodLabel}`
          : `Sales performance · ${tool.periodLabel}`,
      directAnswer: resolvedAnswer || `Cash-up aggregation for ${tool.periodLabel}.`,
      keyMetrics: metrics,
      insights: [
        ...(isPlatformQuery
          ? platformInsights
          : (aggregation.dailyBreakdown || []).slice(0, 7).map(
            (row) => `${row.date}: ${row.totalSales != null ? `${formatNumber(row.totalSales)} SAR` : "sales n/a"}`,
          )),
        ...buildCoverageAnswerLines(coverageAssessment).filter(
          (line) => !String(resolvedAnswer || "").includes(line.slice(0, 20)),
        ),
      ],
      warnings: coverageWarnings,
      confidence: confidenceResult.level,
      dataConfidence: confidenceResult.dataConfidence,
    });
  }

  if (tool?.queryStatus === "connection_error") {
    return createAskNacResponse({
      ...baseVaultFields(route, tool, readiness),
      answerType: ANSWER_TYPES.MISSING_DATA,
      title: `Cash-up · ${tool?.periodLabel || "query"}`,
      directAnswer: `I could not query cash-up facts because the vault database returned an error: ${tool.searchError || "connection failed"}.`,
      warnings: ["This is a real database/query failure, not a missing cash-up report."],
    });
  }
  if (!facts.length) {
    const hasReport = (tool?.vaultSources || []).length || (tool?.coverage || []).length;
    const askedForDate = Boolean(route?.vaultPeriod?.startDate || tool?.startDate);
    const directAnswer = hasReport
      ? "Cash-up report exists, but it contains no extracted sales fields for this request."
      : askedForDate
        ? `No cash-up report matched ${tool?.periodLabel || route?.vaultPeriod?.label || "that date"}.`
        : "No cash-up reports are available in Company Knowledge yet.";
    return createAskNacResponse({
      ...baseVaultFields(route, tool, readiness),
      answerType: ANSWER_TYPES.MISSING_DATA,
      title: `Cash-up · ${tool?.periodLabel || "query"}`,
      directAnswer,
      warnings: hasReport
        ? ["The file is reachable, but structured cash-up fields were not extracted."]
        : ["No cash_up coverage row was found under the current branch/access scope."],
    });
  }
  const fileTitle = tool?.vaultSources?.[0]?.title || null;
  const executive = buildSalesPerformanceExecutiveSummary(facts, {
    branchLabel: tool.branchLabel,
    periodLabel: tool.periodLabel,
    fileTitle,
    question: route.question || "",
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

  const directAnswer = formatManagerStyleAnswer({
    answer: executive.answer,
    managementNote: executive.managementNote,
    source: executive.source,
    relatedFindings,
    confidence: metrics.length ? "high" : executive.missingFields.length ? "medium" : "low",
  });

  const executiveBrief = buildCashUpExecutiveBrief({
    facts,
    branchLabel: tool.branchLabel,
    periodLabel: tool.periodLabel,
    businessDate: tool.startDate || tool.periodEnd || facts[0]?.period_end || facts[0]?.periodEnd,
    fileTitle,
    vaultSources: tool.vaultSources,
    coverage: tool.coverage,
    question: route.question || "",
  });

  return createAskNacResponse({
    ...baseVaultFields(route, tool, readiness),
    answerType: metrics.length ? ANSWER_TYPES.EXECUTIVE : ANSWER_TYPES.MISSING_DATA,
    title: `Sales performance · ${tool.periodLabel}`,
    directAnswer,
    executiveBrief,
    keyMetrics: metrics,
    insights: [
      ...(executive.risks || []),
      ...(executive.actions || []).map((a) => `Action: ${a}`),
      ...(executive.missingFields.length
        ? [`Missing fields: ${executive.missingFields.join(", ")}`]
        : []),
    ],
    warnings: [
      ...(tool?.warnings || []),
      ...(executive.missingFields.length
        ? [`Sales report missing: ${executive.missingFields.join(", ")}`]
        : []),
    ],
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
  if (cashFacts.length) sections.push("sales performance and guest counts");
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
  const sourcesBlock = buildSourcesRecommendation(matches);
  const manager = buildOperationalManagerAnswer(searchTerms, matches);
  const operationalAnswer = manager
    ? formatManagerStyleAnswer({
        answer: manager.answer,
        managementNote: manager.managementNote,
        source: manager.source,
        relatedFindings: manager.relatedFindings,
        confidence: assessSearchMatchConfidence(matches, searchTerms),
      })
    : buildOperationalSearchDirectAnswer(searchTerms, matches);
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

  const insights = [
    ...matches.slice(0, 5).map(
      (m) => `${m.fileTitle}${m.pageNo != null ? ` (p. ${m.pageNo})` : ""}${m.sectionLabel ? ` · ${m.sectionLabel}` : ""}: “${m.excerpt}” [${m.citation}]`,
    ),
    ...(manager?.relatedFindings || []).map(
      (item) => `Related: ${item.fileTitle}${item.sectionLabel ? ` · ${item.sectionLabel}` : ""} — ${item.excerpt}`,
    ),
  ];

  return createAskNacResponse({
    ...baseVaultFields(route, tool, readiness),
    answerType: ANSWER_TYPES.COMPARISON,
    title: `Document search · “${searchTerms}”`,
    directAnswer: summary,
    searchTerms,
    keyMetrics,
    insights,
    recommendations: [
      sourcesBlock,
      `Citations: ${matches.slice(0, 5).map((m) => m.citation).join("; ")}`,
    ].filter(Boolean),
    confidence,
    isAiGenerated: false,
    intent: route.intent,
    branchLabel: tool?.branchLabel,
    searchMethod: tool?.searchMethod || "fts",
    vaultSources: (tool?.vaultSources || []).map((f) => ({
      fileId: f.fileId,
      title: f.title,
      reportType: f.reportType,
      periodStart: f.periodStart,
      periodEnd: f.periodEnd,
    })),
  });
}

export function buildVaultOperationalReviewAnswer(route, tool, readiness) {
  const grouped = tool?.groupedFindings || [];
  const theme = tool?.reviewTheme || "general";
  const synthesis = buildCrossDocumentOperationalSummary(grouped, theme);
  const sourcesBlock = buildSourcesRecommendation(grouped);

  const directAnswer = formatManagerStyleAnswer({
    answer: synthesis.answer,
    managementNote: synthesis.managementNote,
    source: synthesis.source || "Uploaded logbooks",
    relatedFindings: synthesis.relatedFindings,
    confidence: grouped.length >= 3 ? "high" : grouped.length ? "medium" : "low",
  });

  return createAskNacResponse({
    ...baseVaultFields(route, tool, readiness),
    answerType: grouped.length ? ANSWER_TYPES.EXECUTIVE : ANSWER_TYPES.DOCUMENT_NO_MATCH,
    title: `Operational review · ${tool.periodLabel || theme}`,
    directAnswer,
    keyMetrics: grouped.slice(0, 8).map((item) =>
      metricEntry(item.date || item.fileTitle, item.excerpt.slice(0, 100), {
        note: `${item.issueType} · ${item.severity}`,
        source: item.source,
      }),
    ),
    insights: grouped.slice(0, 8).map(
      (item) => `${item.date || item.fileTitle} · ${item.issueType}: ${item.excerpt} [${item.source}]`,
    ),
    recommendations: [
      grouped.length ? `Review ${grouped.length} finding(s) across uploaded logbooks.` : null,
      sourcesBlock,
    ].filter(Boolean),
    searchTerms: tool?.searchTerms,
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
      directAnswer:
        queryStatus === "no_document"
          ? "No uploaded document was found to summarize under your access scope."
          : queryStatus === "no_chunks"
            ? `The document was found (${tool?.fileTitles?.join(" · ") || "uploaded file"}), but no searchable text chunks are available for Ask NAC to summarize.`
            : DOCUMENT_SEARCH_MESSAGES.NO_MATCH,
      keyMetrics: [],
      insights: [],
      confidence: CONFIDENCE_LEVELS.LOW,
      isAiGenerated: false,
      intent: route.intent,
      branchLabel: tool?.branchLabel,
      vaultSources: (tool?.vaultSources || []).map((f) => ({
        fileId: f.fileId,
        title: f.title,
        reportType: f.reportType,
        periodStart: f.periodStart,
        periodEnd: f.periodEnd,
      })),
      readiness,
      warnings: queryStatus === "no_chunks"
        ? ["Document metadata was found, but searchable chunk text is missing or empty."]
        : [],
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
  if (tool?.documentFallback?.matches?.length) {
    return buildVaultDocumentSearchAnswer(
      { ...route, intent: ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH },
      tool.documentFallback,
      readiness,
    );
  }

  if (route.intent === ASK_NAC_INTENTS.VAULT_DOCUMENT_SUMMARY) {
    return buildVaultDocumentSummaryAnswer(route, tool, readiness);
  }

  if (route.intent === ASK_NAC_INTENTS.VAULT_OPERATIONAL_REVIEW) {
    return buildVaultOperationalReviewAnswer(route, tool, readiness);
  }

  if (route.intent === ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH) {
    if (!tool?.matches?.length && readiness?.status === READINESS.MISSING) {
      return buildVaultMissingToolResponse(route, tool, readiness);
    }
    return buildVaultDocumentSearchAnswer(route, tool, readiness);
  }

  if (route.intent === ASK_NAC_INTENTS.VAULT_BUSINESS_REASONING) {
    return buildVaultBusinessReasoningAnswer(route, tool, readiness);
  }

  if (!tool?.facts?.length && !(tool?.coverage?.length) && !(tool?.aggregation?.dayCount) && readiness?.status === READINESS.MISSING) {
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
    case ASK_NAC_INTENTS.VAULT_OPERATIONAL_REVIEW:
      return buildVaultOperationalReviewAnswer(route, tool, readiness);
    default:
      return buildVaultMissingToolResponse(route, tool, readiness);
  }
}
