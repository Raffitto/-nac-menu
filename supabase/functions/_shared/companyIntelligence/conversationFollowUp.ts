/**
 * Core short-term conversation follow-up wiring for Fabric.
 * Supports: How was July? → And June? → Why the difference?
 */

import type { StructuredConversationState } from "./conversationState.ts";
import { createEmptyConversationState, updateConversationState } from "./conversationState.ts";
import { defaultTemporalService } from "./temporalService.ts";
import { normalizeBranchId } from "./scope.ts";
import type { DateRange } from "./types.ts";

export type FollowUpResolution = {
  usedFollowUp: boolean;
  resolvedQuestion: string;
  branchId: string | null;
  currentPeriod: DateRange | null;
  comparisonPeriod: DateRange | null;
  forecastPeriod?: DateRange | null;
  nextHolidayDate?: string | null;
  eventWindow?: {
    holidayId: string;
    convention: string;
    conventionLabel: string;
    anchorDate: string;
    year: number;
    weekdaySignature: string;
  } | null;
  metricFamily: string | null;
  conversation: StructuredConversationState;
  notes: string[];
};

const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";

export function resolveFabricFollowUp(input: {
  question: string;
  previous?: StructuredConversationState | null;
  branchHint?: string | null;
  referenceDate?: Date;
}): FollowUpResolution {
  const prev = input.previous || createEmptyConversationState();
  const q = String(input.question || "").trim();
  const ql = q.toLowerCase();
  const notes: string[] = [];
  const ref = input.referenceDate || new Date();

  let branchId = normalizeBranchId(input.branchHint) || prev.activeBranchId || null;
  const mentioned = normalizeBranchId(q);
  if (mentioned) branchId = mentioned;
  // Never invent a branch id from free text; keep previous or hint only.

  // "And June?" / "What about June?"
  const andMonth = ql.match(new RegExp(`^(?:and|what about)\\s+(${MONTHS})\\??$`, "i"));
  if (andMonth && prev.activeBranchId) {
    const month = andMonth[1];
    const temporal = defaultTemporalService.resolveExpression(`named_month:${month}`, ref);
    // Prefer parse via question form for named months
    const viaQ = defaultTemporalService.resolveFromQuestion(`How was ${month}?`, ref);
    const current = viaQ.range || temporal.range;
    notes.push("followup_and_named_month");
    const conversation = updateConversationState(prev, {
      activeBranchId: branchId || prev.activeBranchId,
      activeCompanyId: prev.activeCompanyId,
      activeBrandId: prev.activeBrandId,
      activeMetricFamily: prev.activeMetricFamily || "commercial",
      activePeriods: {
        current,
        comparison: prev.activePeriods.current, // retain prior period as comparison candidate
      },
      previousIntent: prev.previousIntent || "performance_overview",
    });
    return {
      usedFollowUp: true,
      resolvedQuestion: `How was ${month}?`,
      branchId: conversation.activeBranchId,
      currentPeriod: current,
      comparisonPeriod: prev.activePeriods.current,
      metricFamily: conversation.activeMetricFamily,
      conversation,
      notes,
    };
  }

  // "Why the difference?"
  if (/^why the difference\??$/i.test(ql) && prev.activePeriods.current) {
    notes.push("followup_why_difference");
    const current = prev.activePeriods.current;
    const comparison = prev.activePeriods.comparison;
    const conversation = updateConversationState(prev, {
      activeBranchId: branchId || prev.activeBranchId,
      activeMetricFamily: prev.activeMetricFamily || "commercial",
      activePeriods: { current, comparison },
      previousIntent: "period_compare",
    });
    const labelA = current?.label || current?.semantic || "current period";
    const labelB = comparison?.label || comparison?.semantic || "previous period";
    return {
      usedFollowUp: true,
      resolvedQuestion: `Compare ${labelA} with ${labelB}`,
      branchId: conversation.activeBranchId,
      currentPeriod: current,
      comparisonPeriod: comparison,
      metricFamily: conversation.activeMetricFamily,
      conversation,
      notes,
    };
  }

  // "What about weekends only?"
  if (/weekend/i.test(ql) && /what about|only/i.test(ql) && prev.activePeriods.current) {
    notes.push("followup_weekend_filter");
    const conversation = updateConversationState(prev, {
      activeBranchId: branchId || prev.activeBranchId,
      filterPatch: { weekendOnly: true },
      activePeriods: prev.activePeriods,
    });
    return {
      usedFollowUp: true,
      resolvedQuestion: q,
      branchId: conversation.activeBranchId,
      currentPeriod: prev.activePeriods.current,
      comparisonPeriod: prev.activePeriods.comparison,
      metricFamily: prev.activeMetricFamily || "commercial",
      conversation,
      notes,
    };
  }

  // Fresh question — resolve temporally, keep company/brand if present
  const temporal = defaultTemporalService.resolveFromQuestion(q, ref);
  const conversation = updateConversationState(prev, {
    activeCompanyId: prev.activeCompanyId || "nac_hospitality",
    activeBrandId: prev.activeBrandId || "nac",
    activeBranchId: branchId,
    activeMetricFamily: "commercial",
    activePeriods: {
      current: temporal.range,
      comparison: temporal.compareRange,
    },
  });

  return {
    usedFollowUp: false,
    resolvedQuestion: q,
    branchId,
    currentPeriod: temporal.range,
    comparisonPeriod: temporal.compareRange,
    forecastPeriod: temporal.forecastRange || null,
    nextHolidayDate: temporal.nextHolidayDate || null,
    eventWindow: temporal.eventWindow || null,
    metricFamily: "commercial",
    conversation,
    notes: temporal.holidayBundle ? [...notes, "holiday_event_window_resolved"] : notes,
  };
}
