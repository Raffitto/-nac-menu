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

function monthWords(question: string): string[] {
  return String(question || "").toLowerCase().match(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/g) || [];
}

export function isExplicitComparisonReset(question: string): boolean {
  const q = String(question || "").toLowerCase().replace(/[?!.]+$/g, "").trim();
  if (/^(?:and\s+)?(?:yesterday|today|last week|this week|last month|this month)$/.test(q)) return true;
  if (/^(?:sales|covers|orders|guests|revenue)(?:\s+of)?\s+(?:yesterday|today)$/.test(q)) return true;
  if (/\bhow many\b/.test(q)) return true;
  return false;
}

export function isSelfContainedManagementQuestion(question: string): boolean {
  const q = String(question || "").toLowerCase();
  const months = monthWords(q);
  if (months.length < 2) return false;
  return /\b(?:compare|vs|versus|why|lower|higher|better|worse|changed|difference|explain)\b/.test(q);
}

export function isComparisonAnalysisFollowUp(question: string): boolean {
  if (isExplicitComparisonReset(question) || isSelfContainedManagementQuestion(question)) return false;
  const q = String(question || "").toLowerCase().replace(/[?!.]+$/g, "").trim();
  const focus = q.replace(/^(?:what about|how about|and)\s+(?:the\s+)?/, "");
  if (/^(?:yesterday|today|last week|this week|last month|this month|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/.test(focus)
    && !/\b(?:per day|covers|orders|spend|days)\b/.test(focus)) {
    return false;
  }
  return /^(?:per day|sales per day|covers|orders|average spend|avg spend|spend per cover|average order|aov|best days?|worst days?|why)$/.test(focus)
    || /\b(?:per day|covers|orders|average spend|spend per cover|average order|first\s+\d+\s+days|best days|worst days)\b/.test(q)
    || /^why\b/.test(q)
    || /\bwhat changed the most\b/.test(q)
    || /\bwhich had the best\b/.test(q);
}

function hasInheritContext(prev: StructuredConversationState): boolean {
  return Boolean(
    prev.activePeriods?.current
    || prev.activeMetricFamily
    || prev.previousIntent
    || (prev.activeCapabilities && prev.activeCapabilities.length),
  );
}

export function extractFollowUpFocus(question: string): string | null {
  const q = String(question || "").trim();
  const m = q.match(/^(?:what about|how about|and)\s+(.+?)\??$/i);
  return m ? m[1].trim() : null;
}

/**
 * True when the turn primarily supplies a new temporal period
 * ("what about Jan 2026", "and March?", "how about April?").
 * Used so Fabric stays engaged for period-only follow-ups.
 */
export function isPeriodOnlyFollowUpTurn(
  question: string,
  referenceDate: Date = new Date(),
): boolean {
  const q = String(question || "").trim();
  if (/^(?:compare(?:\s+it)?\s+with|vs|versus)\s+/i.test(q)) {
    const focus = q.replace(/^(?:compare(?:\s+it)?\s+with|vs|versus)\s+/i, "").replace(/\?+$/, "").trim();
    return Boolean(resolveFollowUpPeriodFocus(focus, referenceDate)?.startDate);
  }
  const focus = extractFollowUpFocus(q);
  if (!focus) return false;
  return Boolean(resolveFollowUpPeriodFocus(focus, referenceDate)?.startDate);
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

  const keepComparison = inherit && prev.activePeriods?.current && prev.activePeriods?.comparison;
  const analysisFollowUp = keepComparison && !isExplicitComparisonReset(q) && isComparisonAnalysisFollowUp(q);
  if (analysisFollowUp) {
    notes.push("followup_comparison_analysis");
    const dayClip = ql.match(/first\s+(\d{1,2})\s+days/);
    const clipPeriod = (period: DateRange | null) => {
      if (!period?.startDate || !dayClip) return period;
      const n = Number(dayClip[1]);
      const [year, month, day] = period.startDate.split("-").map(Number);
      const end = new Date(Date.UTC(year, month - 1, day + n - 1)).toISOString().slice(0, 10);
      const endDate = end < period.endDate ? end : period.endDate;
      return { ...period, endDate, label: `${period.label || period.startDate} · first ${n} days` };
    };
    const current = clipPeriod(prev.activePeriods.current);
    const comparison = clipPeriod(prev.activePeriods.comparison);
    const conversation = updateConversationState(prev, {
      activeBranchId: branchId || prev.activeBranchId,
      activeMetricFamily: metricFamily || "commercial",
      activeCapabilities: ["commercial.compare", "commercial.performance"],
      activePeriods: { current, comparison },
      previousIntent: "period_compare",
    });
    return {
      usedFollowUp: true,
      resolvedQuestion: q,
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

  // Explicit compare follow-up: "compare it with June" / "compare with jan 2026"
  // Keep the prior period as current; attach the mentioned period as comparison.
  const compareFocus = q.match(/^(?:compare(?:\s+it)?\s+with|vs|versus)\s+(.+?)\??$/i);
  if (compareFocus && inherit && prev.activePeriods.current) {
    const comparison = resolveFollowUpPeriodFocus(compareFocus[1], ref);
    if (comparison?.startDate && comparison?.endDate) {
      notes.push("followup_explicit_compare");
      const current = prev.activePeriods.current;
      const conversation = updateConversationState(prev, {
        activeBranchId: branchId || prev.activeBranchId,
        activeCompanyId: prev.activeCompanyId || "nac_hospitality",
        activeBrandId: prev.activeBrandId || "nac",
        activeMetricFamily: metricFamily || "commercial",
        activeCapabilities: ["commercial.compare", "commercial.performance"],
        activePeriods: { current, comparison },
        previousIntent: "period_compare",
      });
      const labelA = current.label || current.semantic || "current period";
      const labelB = comparison.label || comparison.semantic || compareFocus[1];
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
  }

  // Generic temporal follow-up: "what about June" / "what about jan 2026"
  // Inherit commercial intent/metric/scope; replace ONLY the period dimension.
  // Do NOT auto-attach comparison — that would force July-vs-June compare.
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
          ? prev.activeCapabilities.filter((c) => c !== "commercial.compare")
          : ["commercial.performance"],
        activePeriods: {
          current,
          comparison: null,
        },
        previousIntent: previousIntent || "performance_overview",
      });
      return {
        usedFollowUp: true,
        resolvedQuestion: buildInheritedCommercialQuestion(current, focus),
        branchId: conversation.activeBranchId,
        currentPeriod: current,
        comparisonPeriod: null,
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
