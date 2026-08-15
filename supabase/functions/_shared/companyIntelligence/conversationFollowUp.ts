/**
 * Core short-term conversation follow-up wiring for Fabric.
 * Delegates merge rules to canonical turn semantics:
 * explicit current-turn meaning always outranks inherited context.
 */

import type { StructuredConversationState } from "./conversationState.ts";
import {
  extractFollowUpFocus as extractFocusFromSemantics,
  isPeriodOnlyFollowUpTurn as isPeriodOnlyFromSemantics,
  resolveFollowUpPeriodFocus as resolveFocusFromSemantics,
  resolveTurnSemantics,
  type TurnSemantics,
} from "./turnSemantics.ts";
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
  semantics?: TurnSemantics;
  ambiguity?: TurnSemantics["ambiguity"];
};

export function extractFollowUpFocus(question: string): string | null {
  return extractFocusFromSemantics(question);
}

export function isPeriodOnlyFollowUpTurn(
  question: string,
  referenceDate: Date = new Date(),
): boolean {
  return isPeriodOnlyFromSemantics(question, referenceDate);
}

export function resolveFollowUpPeriodFocus(
  focus: string,
  referenceDate: Date = new Date(),
): DateRange | null {
  return resolveFocusFromSemantics(focus, referenceDate);
}

export function resolveFabricFollowUp(input: {
  question: string;
  previous?: StructuredConversationState | null;
  branchHint?: string | null;
  referenceDate?: Date;
}): FollowUpResolution {
  const semantics = resolveTurnSemantics(input);
  return {
    usedFollowUp: semantics.usedFollowUp,
    resolvedQuestion: semantics.resolvedQuestion,
    branchId: semantics.scope.branchId,
    currentPeriod: semantics.period,
    comparisonPeriod: semantics.comparisonPeriod,
    forecastPeriod: semantics.forecastPeriod || null,
    nextHolidayDate: semantics.nextHolidayDate || null,
    eventWindow: semantics.eventWindow,
    metricFamily: semantics.conversation.activeMetricFamily,
    conversation: semantics.conversation,
    notes: semantics.notes,
    semantics,
    ambiguity: semantics.ambiguity,
  };
}
