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
import { mergeNilSignalBundles } from "../../externalContext/adapters/externalContextSignalAdapter";
import { EXTERNAL_CONTEXT_UNAVAILABLE_NOTE } from "../../externalContext/externalContextContract";
import {
  appendExternalContextSection,
  buildExternalContextNilPayload,
  resolveNilCombinedPeriodBounds,
} from "./vaultExternalContextRetrieval";
import {
  applyRestaurantHeuristics,
  buildEvidenceMap,
  buildRankedHypotheses,
} from "../executive/executiveIntelligence";
import { formatBranchMemoryLines } from "../executive/branchMemory";
import {
  matchMemoryToGuestQuestion,
  buildMemoryHypotheses,
} from "../executive/executiveMemory";

const EXTERNAL_CONTEXT_NOTE = EXTERNAL_CONTEXT_UNAVAILABLE_NOTE;

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

  const periodBounds = resolveNilCombinedPeriodBounds({
    vaultCompare: tool?.vaultCompare,
    startDate: tool?.startDate,
    endDate: tool?.endDate,
    vaultPeriod: route?.vaultPeriod,
  });
  const externalRows = tool?.externalContext || {};
  const externalPayload = buildExternalContextNilPayload({
    externalSignals: externalRows.externalSignals || [],
    competitorObservations: externalRows.competitorObservations || [],
    competitors: externalRows.competitors || [],
    branchLabel,
    periodLabel,
    period: periodBounds,
  });
  const externalConnected = externalPayload.connected;

  const nilInput = mergeNilSignalBundles({ internalSignals }, externalPayload.nilBundle);
  const nilResult = businessReasoningEngine({
    question,
    branchLabel,
    periodLabel,
    ...nilInput,
    brandSignals: nilInput.brandSignals || [],
    productSignals: nilInput.productSignals || [],
    laborSignals: nilInput.laborSignals || [],
  });

  const nilFields = nilReasoningToAskNacFields(nilResult);
  const executiveMemory = tool?.executiveMemory || tool?.branchMemory || [];
  const operatorMemory = tool?.operatorMemory || executiveMemory.filter((m) => m.source === "operator_memory");
  const branchMemory = tool?.branchMemory || executiveMemory.filter((m) => m.source === "branch_memory");
  const heuristicResult = applyRestaurantHeuristics(current, previous, executiveMemory);
  const memoryMatches = matchMemoryToGuestQuestion(question, executiveMemory);
  const memoryHypotheses = buildMemoryHypotheses(memoryMatches);
  const rankedHypotheses = buildRankedHypotheses({
    heuristics: [...heuristicResult.heuristics, ...memoryHypotheses],
    nilHypotheses: nilResult.hypotheses || [],
    metrics: buildCashUpPeriodCompareMetrics(current, previous),
  });
  const evidenceMap = buildEvidenceMap({
    conclusion: heuristicResult.interpretation || rankedHypotheses[0]?.hypothesis || "",
    metrics: buildCashUpPeriodCompareMetrics(current, previous),
    facts: nilResult.facts?.map((f) => f.text) || [],
    branchMemory,
    assumptions: rankedHypotheses.filter((h) => h.confidence === "low").map((h) => h.hypothesis),
  });
  const memoryLines = [
    ...formatBranchMemoryLines(branchMemory, { max: 2 }),
    ...operatorMemory.slice(0, 2).map((m) => `[operator · ${m.category}] ${m.fact}`),
  ];
  const memoryAttribution = memoryHypotheses[0]?.attribution;
  const directAnswer = appendExternalContextSection(formatNilReasoningText(nilResult), {
    connected: externalConnected,
    sourceLabels: externalPayload.sourceLabels,
  });
  const keyMetrics = buildCashUpPeriodCompareMetrics(current, previous);
  const coverageWarnings = buildCoverageWarnings(current, previous);
  const insights = [
    ...(heuristicResult.interpretation ? [heuristicResult.interpretation] : []),
    ...(memoryAttribution ? [memoryAttribution] : []),
    ...memoryHypotheses.map((h) => h.hypothesis),
    ...nilFields.insights,
    ...memoryLines.map((line) => `Branch context: ${line}`),
  ];
  const recommendations = [
    ...(heuristicResult.recommendedAction ? [heuristicResult.recommendedAction] : []),
    ...nilFields.recommendations,
    ...(externalConnected
      ? []
      : [
        "Review competitor/mall activity manually until competitive intelligence sources are connected.",
        "Review weather/local context manually until weather intelligence sources are connected.",
      ]),
  ];

  return createAskNacResponse({
    answerType: ANSWER_TYPES.EXECUTIVE,
    title: `Business reasoning · ${periodLabel}`,
    directAnswer,
    keyMetrics,
    insights,
    recommendations,
    sources: [
      ...nilFields.sources.map((s) => sourceEntry(s.name, s.detail)),
      ...(tool?.sources || []).map((s) => sourceEntry(s.name, s.detail)),
    ],
    warnings: [
      ...coverageWarnings,
      ...(tool?.warnings || []),
      ...nilFields.warnings,
      ...(externalConnected ? [] : [EXTERNAL_CONTEXT_NOTE]),
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
      externalContextConnected: externalConnected,
      externalContextSourceLabels: externalPayload.sourceLabels,
      rankedHypotheses,
      evidenceMap,
      branchMemoryCount: branchMemory.length,
      operatorMemoryCount: operatorMemory.length,
      memoryHypotheses,
    },
  });
}
