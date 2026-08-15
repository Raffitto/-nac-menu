/**
 * Deterministic templated synthesis for simple answers + offline degradation.
 * Composes structured management reasoning; does not rediscover metric math in prose.
 */

import type { ClaimRecord, EvidenceRecord } from "./evidenceLedger.ts";
import type { ComparabilityResult } from "./comparabilityEngine.ts";
import type { CoverageReport } from "./coverageModel.ts";
import type { DateRange } from "./types.ts";
import { allowedInferenceWording } from "./causalPolicy.ts";
import type { CommercialMetric } from "./turnSemantics.ts";
import type { NormalizedDailyFact, NormalizedRanking } from "./normalizedCapabilityResult.ts";
import type { CanonicalMatchedPair } from "../cashUpMatchedCoverageComparison.ts";
import { answerPublishedCommerce, missingSessionEvidenceAnswer, type PublishedCommerce } from "./commerce/synthesis.ts";
import {
  composeReasonedAnswer,
  isSubjectiveJudgementQuestion,
  reasonAboutCommercialEvidence,
} from "./managementReasoning.ts";

export function synthesizeDeterministicAnswer(input: {
  question: string;
  branchId: string | null;
  period: DateRange | null;
  comparisonPeriod?: DateRange | null;
  forecastPeriod?: DateRange | null;
  nextHolidayDate?: string | null;
  eventWindow?: {
    conventionLabel?: string;
    anchorDate?: string;
    year?: number;
  } | null;
  evidence: EvidenceRecord[];
  claims: ClaimRecord[];
  coverage: CoverageReport[];
  comparability?: ComparabilityResult | null;
  comparisonMode?: string | null;
  offlineAnalysis?: boolean;
  infeasibleText?: string | null;
  primaryMetric?: CommercialMetric | "commercial" | null;
  ranking?: "top" | "bottom" | null;
  rankingCount?: number | null;
  comparisonIntent?: boolean;
  rankings?: NormalizedRanking[];
  dailyFacts?: NormalizedDailyFact[];
  historyDailyFacts?: NormalizedDailyFact[];
  previousDailyFacts?: NormalizedDailyFact[];
  canonicalMatchedPairs?: CanonicalMatchedPair[];
  analysisIntent?: import("./turnSemantics.ts").AnalysisIntent;
  responseMode?: import("./turnSemantics.ts").ResponseMode | null;
  commerceFocus?: import("./commerce/types.ts").CommerceFocus;
  publishedCommerce?: PublishedCommerce | null;
  openingDate?: string | null;
}): string {
  if (input.infeasibleText) return input.infeasibleText;
  if (input.commerceFocus) {
    if (input.publishedCommerce?.mix?.totalSessions) {
      return answerPublishedCommerce(input.commerceFocus, input.publishedCommerce);
    }
    if (input.commerceFocus === "health" || input.commerceFocus === "freshness" || input.commerceFocus === "data_used" || input.commerceFocus === "trust" || input.commerceFocus === "reconciliation") {
      if (input.publishedCommerce?.health || input.publishedCommerce?.evidence) {
        return answerPublishedCommerce(input.commerceFocus, input.publishedCommerce);
      }
    }
    return missingSessionEvidenceAnswer();
  }

  const forecastSales = input.evidence.find((e) =>
    e.metricOrEvent === "forecast_net_sales" && typeof e.value === "number"
  );
  const forecastConfidence = input.evidence.find((e) => e.metricOrEvent === "forecast_confidence");
  const forecastMethod = input.evidence.find((e) => e.metricOrEvent === "forecast_method");
  const histObs = input.evidence.find((e) => e.metricOrEvent === "historical_event_observations");
  const costMissing = input.claims.some((c) => c.type === "UNSUPPORTED" && /margin|cost/i.test(c.statement));
  const ops = input.evidence.filter((e) => e.source === "logbook").map((e) => e.textSummary).filter(Boolean);

  function periodLabel(period: DateRange | null | undefined) {
    if (!period) return "the requested period";
    return period.label || `${period.startDate}–${period.endDate}`;
  }

  let forecastText: string | null = null;
  if (forecastSales || forecastMethod || /\b(expect|forecast|next founding|next foundation)\b/i.test(input.question)) {
    if (forecastSales) {
      forecastText =
        `FORECAST (estimate, not observed fact): for the next Founding Day window`
        + (input.forecastPeriod ? ` (${periodLabel(input.forecastPeriod)})` : "")
        + `, central estimate is ${forecastSales.value} SAR`
        + (forecastConfidence ? ` with ${forecastConfidence.value} confidence` : "")
        + (forecastMethod ? ` using method ${forecastMethod.value}` : "")
        + ".";
    } else {
      forecastText = "FORECAST: insufficient observed same-event history to defend a central sales estimate.";
    }
    if (histObs && Number(histObs.value) <= 1) {
      forecastText += ` Only ${histObs.value} historical Founding Day observation(s) are available for this branch, so confidence is limited.`;
    }
    forecastText += " This forecast does not include weather, local events, economic, or political factors.";
  }

  const reasoning = reasonAboutCommercialEvidence({
    question: input.question,
    branchId: input.branchId,
    period: input.period,
    comparisonPeriod: input.comparisonPeriod,
    evidence: input.evidence,
    coverage: input.coverage,
    comparability: input.comparability,
    comparisonMode: input.comparisonMode || input.comparability?.recommendedMethod || null,
    primaryMetric: input.primaryMetric || null,
    ranking: input.ranking || null,
    rankingCount: input.rankingCount || null,
    comparisonIntent: input.comparisonIntent,
    rankings: input.rankings || [],
    dailyFacts: input.dailyFacts || [],
    historyDailyFacts: input.historyDailyFacts || [],
    previousDailyFacts: input.previousDailyFacts || [],
    judgementQuestion: isSubjectiveJudgementQuestion(input.question),
    analysisIntent: input.analysisIntent || null,
    responseMode: input.responseMode || null,
    openingDate: input.openingDate || null,
    canonicalMatchedPairs: input.canonicalMatchedPairs || [],
  });

  return composeReasonedAnswer(reasoning, {
    eventPreface: input.eventWindow?.conventionLabel && input.eventWindow?.anchorDate
      ? `Using the explicit three-day event window (${input.eventWindow.conventionLabel}) around ${input.eventWindow.anchorDate}.`
      : null,
    costMissing: costMissing && /\b(margin|losing money|food cost)\b/i.test(input.question)
      ? `Canonical cost/margin data is unavailable for ${input.branchId || "the branch"}, so I cannot determine where margin is being lost from sales alone.`
      : null,
    forecast: forecastText,
    holiday: input.nextHolidayDate ? `The next Saudi Founding Day is ${input.nextHolidayDate}.` : null,
    ops: ops.length ? `In-period logbooks mention: ${ops[0]}` : null,
    causalNote: ops.length && /\bwhy|cause|shit|wrong\b/i.test(input.question)
      ? allowedInferenceWording()
      : null,
    offline: Boolean(input.offlineAnalysis),
  });
}
