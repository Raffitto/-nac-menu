/**
 * Deterministic Ask NAC answer for NIL business reasoning (Edge, internal cash-up only).
 */

import { businessReasoningEngine } from "./nil/businessReasoningEngine.ts";
import { formatNilReasoningText, nilReasoningToAskNacFields } from "./nil/formatNilReasoning.ts";
import { CONFIDENCE_LABELS } from "./nil/nilConfidence.ts";
import { buildCashUpPeriodCompareMetrics } from "./vaultSalesPerformanceIntelligence.ts";
import {
  buildInternalSignalsFromAggregations,
  buildPlatformDeliveryChangeSignals,
} from "./vaultNilSignalCollector.ts";
import { mergeNilSignalBundles } from "./externalContextSignalAdapter.ts";
import { EXTERNAL_CONTEXT_UNAVAILABLE_NOTE } from "./externalContextContract.ts";
import {
  appendExternalContextSection,
  buildExternalContextNilPayload,
  resolveNilCombinedPeriodBounds,
} from "./vaultExternalContextRetrieval.ts";

const EXTERNAL_CONTEXT_NOTE = EXTERNAL_CONTEXT_UNAVAILABLE_NOTE;

type AskNacAnswer = Record<string, unknown>;

function mapNilConfidenceToAskNac(confidence: string) {
  if (confidence === "high") return "high";
  if (confidence === "medium") return "medium";
  return "low";
}

function buildCoverageWarnings(current: Record<string, unknown> = {}, previous: Record<string, unknown> = {}) {
  const warnings: string[] = [];
  const currentDays = Number(current.dayCount) || 0;
  const previousDays = Number(previous.dayCount) || 0;
  if (currentDays === 0) warnings.push("No cash-up facts found for the current period.");
  if (previousDays === 0) warnings.push("No cash-up facts found for the comparison period.");
  if (currentDays > 0 && previousDays > 0 && currentDays !== previousDays) {
    warnings.push(
      `Coverage note: current period includes ${currentDays} cash-up day(s) vs ${previousDays} in the comparison period.`,
    );
  }
  return warnings;
}

export function buildVaultBusinessReasoningAnswer(
  route: Record<string, unknown>,
  tool: Record<string, unknown> | null,
  readiness: Record<string, unknown> | null,
): AskNacAnswer {
  const debug = route?.debug as Record<string, unknown> | undefined;
  const nlu = debug?.nlu as Record<string, unknown> | undefined;
  const question = String(route?.question || nlu?.normalizedQuestion || "");
  const current = (tool?.aggregation as Record<string, unknown>) || {};
  const previous = (tool?.previousAggregation as Record<string, unknown> | null) || null;
  const branchLabel = String(tool?.branchLabel || route?.branchMention || "Branch");
  const vaultCompare = tool?.vaultCompare as Record<string, unknown> | undefined;
  const vaultPeriod = route?.vaultPeriod as Record<string, unknown> | undefined;
  const periodLabel = String(
    tool?.periodLabel || (vaultCompare?.current as Record<string, unknown> | undefined)?.label || vaultPeriod?.label || "selected period",
  );

  if (!previous) {
    return {
      answerType: "missing_data",
      title: `Business reasoning · ${periodLabel}`,
      directAnswer: "I need a comparison period to explain why performance changed. Try asking with a rolling period (last 7 days) or an explicit comparison (June 1–15 vs May 1–15).",
      warnings: ["Why questions require a current period and a comparison period."],
      confidence: "none",
      isAiGenerated: false,
      intent: route.intent,
      branchLabel,
      periodLabel,
      readiness,
    };
  }

  const currentDays = Number(current.dayCount) || 0;
  const previousDays = Number(previous.dayCount) || 0;
  if (currentDays === 0 && previousDays === 0) {
    return {
      answerType: "missing_data",
      title: `Business reasoning · ${periodLabel}`,
      directAnswer: `No uploaded cash-up facts were found for ${periodLabel} under your access scope.`,
      missingData: (readiness?.missingData as unknown[]) || [],
      confidence: "none",
      isAiGenerated: false,
      intent: route.intent,
      branchLabel,
      periodLabel,
      readiness,
    };
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
    vaultPeriod,
  });
  const externalRows = (tool?.externalContext as Record<string, unknown>) || {};
  const externalPayload = buildExternalContextNilPayload({
    externalSignals: (externalRows.externalSignals as unknown[]) || [],
    competitorObservations: (externalRows.competitorObservations as unknown[]) || [],
    competitors: (externalRows.competitors as unknown[]) || [],
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
    brandSignals: (nilInput.brandSignals as unknown[]) || [],
    productSignals: (nilInput.productSignals as unknown[]) || [],
    laborSignals: (nilInput.laborSignals as unknown[]) || [],
  });

  const nilFields = nilReasoningToAskNacFields(nilResult);
  const directAnswer = appendExternalContextSection(formatNilReasoningText(nilResult), {
    connected: externalConnected,
    sourceLabels: externalPayload.sourceLabels,
  });
  const keyMetrics = buildCashUpPeriodCompareMetrics(current, previous);
  const coverageWarnings = buildCoverageWarnings(current, previous);
  const toolSources = (tool?.sources as { name?: string; detail?: string }[]) || [];

  return {
    answerType: "executive",
    title: `Business reasoning · ${periodLabel}`,
    directAnswer,
    keyMetrics,
    insights: nilFields.insights,
    recommendations: [
      ...nilFields.recommendations,
      ...(externalConnected
        ? []
        : [
          "Review competitor/mall activity manually until competitive intelligence sources are connected.",
          "Review weather/local context manually until weather intelligence sources are connected.",
        ]),
    ],
    sources: [
      ...nilFields.sources.map((s) => ({ name: s.name, detail: s.detail })),
      ...toolSources.map((s) => ({ name: s.name || "", detail: s.detail || "" })),
    ],
    warnings: [
      ...coverageWarnings,
      ...((tool?.warnings as string[]) || []),
      ...nilFields.warnings,
      ...(externalConnected ? [] : [EXTERNAL_CONTEXT_NOTE]),
    ],
    confidence: mapNilConfidenceToAskNac(nilResult.confidence),
    exportOptions: [],
    isAiGenerated: false,
    intent: route.intent,
    periodLabel,
    branchLabel,
    readiness: readiness?.status === "ready" ? readiness : { ...readiness, status: "partial" },
    diagnostics: {
      nilConfidence: nilResult.confidence,
      nilConfidenceLabel: CONFIDENCE_LABELS[nilResult.confidence],
      whyMetricFocus: route.whyMetricFocus || null,
      domainsPresent: nilResult.meta?.domainsPresent || ["internal_operational"],
      externalContextConnected: externalConnected,
      externalContextSourceLabels: externalPayload.sourceLabels,
    },
  };
}
