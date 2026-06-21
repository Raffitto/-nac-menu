/**
 * Deterministic Ask NAC answer for NIL business reasoning (internal cash-up only).
 */

import {
  ANSWER_TYPES,
  CONFIDENCE_LEVELS,
  createAskNacResponse,
  sourceEntry,
} from "../askNacContract";
import { READINESS } from "../readinessEngine";
import { businessReasoningEngine } from "../../nil/businessReasoningEngine";
import { formatNilReasoningText, nilReasoningToAskNacFields } from "../../nil/formatNilReasoning";
import { CONFIDENCE_LABELS } from "../../../platform/contracts/dataConfidence";
import { buildCashUpPeriodCompareMetrics } from "./vaultSalesPerformanceIntelligence";
import {
  buildInternalSignalsFromAggregations,
  buildPlatformDeliveryChangeSignals,
} from "./vaultNilSignalCollector";

const EXTERNAL_CONTEXT_NOTE = "No external context sources are connected yet.";

function mapNilConfidenceToAskNac(confidence) {
  if (confidence === "high") return CONFIDENCE_LEVELS.HIGH;
  if (confidence === "medium") return CONFIDENCE_LEVELS.MEDIUM;
  return CONFIDENCE_LEVELS.LOW;
}

function buildCoverageWarnings(current = {}, previous = {}) {
  const warnings = [];
  if (current.dayCount === 0) warnings.push("No cash-up facts found for the current period.");
  if (previous.dayCount === 0) warnings.push("No cash-up facts found for the comparison period.");
  if (current.dayCount > 0 && previous.dayCount > 0 && current.dayCount !== previous.dayCount) {
    warnings.push(
      `Coverage note: current period includes ${current.dayCount} cash-up day(s) vs ${previous.dayCount} in the comparison period.`,
    );
  }
  return warnings;
}

function appendExternalContextSection(text) {
  return `${text}\n\nExternal Context\n\n* ${EXTERNAL_CONTEXT_NOTE}`;
}

export function buildVaultBusinessReasoningAnswer(route, tool, readiness) {
  const question = route?.question || route?.debug?.nlu?.normalizedQuestion || "";
  const current = tool?.aggregation || {};
  const previous = tool?.previousAggregation || null;
  const branchLabel = tool?.branchLabel || route?.branchMention || "Branch";
  const periodLabel = tool?.periodLabel
    || tool?.vaultCompare?.current?.label
    || route?.vaultPeriod?.label
    || "selected period";

  if (!previous) {
    return createAskNacResponse({
      answerType: ANSWER_TYPES.MISSING_DATA,
      title: `Business reasoning · ${periodLabel}`,
      directAnswer: "I need a comparison period to explain why performance changed. Try asking with a rolling period (last 7 days) or an explicit comparison (June 1–15 vs May 1–15).",
      warnings: ["Why questions require a current period and a comparison period."],
      confidence: CONFIDENCE_LEVELS.NONE,
      isAiGenerated: false,
      intent: route.intent,
      branchLabel,
      periodLabel,
      readiness,
    });
  }

  if (current.dayCount === 0 && previous.dayCount === 0) {
    return createAskNacResponse({
      answerType: ANSWER_TYPES.MISSING_DATA,
      title: `Business reasoning · ${periodLabel}`,
      directAnswer: `No uploaded cash-up facts were found for ${periodLabel} under your access scope.`,
      missingData: readiness?.missingData || [],
      confidence: CONFIDENCE_LEVELS.NONE,
      isAiGenerated: false,
      intent: route.intent,
      branchLabel,
      periodLabel,
      readiness,
    });
  }

  const internalSignals = [
    ...buildInternalSignalsFromAggregations(current, previous, {
      periodLabel,
      branchLabel,
      sourceDetail: `${periodLabel} cash-up aggregation`,
    }),
    ...buildPlatformDeliveryChangeSignals(current, previous, { periodLabel, branchLabel }),
  ];

  const nilResult = businessReasoningEngine({
    question,
    branchLabel,
    periodLabel,
    internalSignals,
    competitorSignals: [],
    weatherSignals: [],
    calendarSignals: [],
    locationSignals: [],
    macroSignals: [],
    brandSignals: [],
    productSignals: [],
    laborSignals: [],
  });

  const nilFields = nilReasoningToAskNacFields(nilResult);
  const directAnswer = appendExternalContextSection(formatNilReasoningText(nilResult));
  const keyMetrics = buildCashUpPeriodCompareMetrics(current, previous);
  const coverageWarnings = buildCoverageWarnings(current, previous);

  return createAskNacResponse({
    answerType: ANSWER_TYPES.EXECUTIVE,
    title: `Business reasoning · ${periodLabel}`,
    directAnswer,
    keyMetrics,
    insights: nilFields.insights,
    recommendations: [
      ...nilFields.recommendations,
      "Review competitor/mall activity manually until competitive intelligence sources are connected.",
      "Review weather/local context manually until weather intelligence sources are connected.",
    ],
    sources: [
      ...nilFields.sources.map((s) => sourceEntry(s.name, s.detail)),
      ...(tool?.sources || []).map((s) => sourceEntry(s.name, s.detail)),
    ],
    warnings: [
      ...coverageWarnings,
      ...(tool?.warnings || []),
      ...nilFields.warnings,
      EXTERNAL_CONTEXT_NOTE,
    ],
    confidence: mapNilConfidenceToAskNac(nilResult.confidence),
    exportOptions: [],
    isAiGenerated: false,
    intent: route.intent,
    periodLabel,
    branchLabel,
    readiness: readiness?.status === READINESS.READY ? readiness : { ...readiness, status: READINESS.PARTIAL },
    diagnostics: {
      nilConfidence: nilResult.confidence,
      nilConfidenceLabel: CONFIDENCE_LABELS[nilResult.confidence],
      whyMetricFocus: route.whyMetricFocus || null,
      domainsPresent: nilResult.meta?.domainsPresent || ["internal_operational"],
      externalContextConnected: false,
    },
  });
}
