/**
 * Core short-term conversation follow-up wiring for Fabric.
 * Follow-ups modify ONLY dimensions explicitly changed by the user.
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

function hasInheritContext(prev: StructuredConversationState): boolean {
  return Boolean(
    prev.activePeriods?.current
    || prev.activeMetricFamily
    || prev.previousIntent
    || (prev.activeCapabilities && prev.activeCapabilities.length),
  );
}

function extractFollowUpFocus(question: string): string | null {
  const q = String(question || "").trim();
  const m = q.match(/^(?:what about|how about|and)\s+(.+?)\??$/i);
  return m ? m[1].trim() : null;
}

/** Resolve a follow-up focus ("June", "jan 2026") into a calendar range without phrase-specific hacks. */
export function resolveFollowUpPeriodFocus(
  focus: string,
  referenceDate: Date = new Date(),
): DateRange | null {
  const f = String(focus || "").trim();
  if (!f) return null;
  const candidates = [
    `How did ${f} perform overall?`,
    `How did ${f} perform?`,
    `How was ${f}?`,
    `how did ${f} perform`,
    f,
  ];
  for (const candidate of candidates) {
    const resolved = defaultTemporalService.resolveFromQuestion(candidate, referenceDate);
    if (resolved.range?.startDate && resolved.range?.endDate) return resolved.range;
  }
  return null;
}

function buildInheritedCommercialQuestion(period: DateRange | null, focus: string): string {
  const label = period?.label || focus;
  return `How did ${label} perform overall?`;
}

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

  const inherit = hasInheritContext(prev);
  const metricFamily = prev.activeMetricFamily || (inherit ? "commercial" : null);
  const previousIntent = prev.previousIntent || (inherit ? "performance_overview" : null);

  // "Why the difference?" — keep periods, flip to compare intent
  if (/^why the difference\??$/i.test(ql) && prev.activePeriods.current) {
    notes.push("followup_why_difference");
    const current = prev.activePeriods.current;
    const comparison = prev.activePeriods.comparison;
    const conversation = updateConversationState(prev, {
      activeBranchId: branchId || prev.activeBranchId,
      activeMetricFamily: metricFamily || "commercial",
      activePeriods: { current, comparison },
      previousIntent: "period_compare",
      activeCapabilities: prev.activeCapabilities?.length
        ? prev.activeCapabilities
        : ["commercial.compare", "commercial.performance"],
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

  // "What about weekends only?" — filter-only change
  if (/weekend/i.test(ql) && /what about|only/i.test(ql) && prev.activePeriods.current) {
    notes.push("followup_weekend_filter");
    const conversation = updateConversationState(prev, {
      activeBranchId: branchId || prev.activeBranchId,
      filterPatch: { weekendOnly: true },
      activePeriods: prev.activePeriods,
      activeMetricFamily: metricFamily || "commercial",
      previousIntent: previousIntent || "performance_overview",
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

  // Generic temporal follow-up: "what about June" / "what about jan 2026"
  // Inherit commercial intent/metric/scope; replace ONLY the period dimension.
  // Do NOT require activeBranchId — network-scope conversations must follow up too.
  const focus = extractFollowUpFocus(q);
  if (focus && inherit) {
    const current = resolveFollowUpPeriodFocus(focus, ref);
    if (current?.startDate && current?.endDate) {
      notes.push("followup_period_dimension_only");
      const conversation = updateConversationState(prev, {
        activeBranchId: branchId || prev.activeBranchId,
        activeCompanyId: prev.activeCompanyId || "nac_hospitality",
        activeBrandId: prev.activeBrandId || "nac",
        activeMetricFamily: metricFamily || "commercial",
        activeCapabilities: prev.activeCapabilities?.length
          ? prev.activeCapabilities
          : ["commercial.performance"],
        activePeriods: {
          current,
          comparison: prev.activePeriods.current, // prior period as compare candidate
        },
        previousIntent: previousIntent || "performance_overview",
      });
      return {
        usedFollowUp: true,
        resolvedQuestion: buildInheritedCommercialQuestion(current, focus),
        branchId: conversation.activeBranchId,
        currentPeriod: current,
        comparisonPeriod: prev.activePeriods.current,
        metricFamily: conversation.activeMetricFamily,
        conversation,
        notes,
      };
    }
  }

  // Fresh question — resolve temporally; keep company/brand/branch when present
  const temporal = defaultTemporalService.resolveFromQuestion(q, ref);
  const freshMetric = inherit && !temporal.range && metricFamily
    ? metricFamily
    : (metricFamily || "commercial");
  const conversation = updateConversationState(prev, {
    activeCompanyId: prev.activeCompanyId || "nac_hospitality",
    activeBrandId: prev.activeBrandId || "nac",
    activeBranchId: branchId,
    activeMetricFamily: freshMetric,
    activeCapabilities: temporal.range ? prev.activeCapabilities : prev.activeCapabilities,
    activePeriods: {
      current: temporal.range,
      comparison: temporal.compareRange,
    },
    previousIntent: temporal.range ? (previousIntent || prev.previousIntent) : prev.previousIntent,
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
    metricFamily: freshMetric,
    conversation,
    notes: temporal.holidayBundle ? [...notes, "holiday_event_window_resolved"] : notes,
  };
}
