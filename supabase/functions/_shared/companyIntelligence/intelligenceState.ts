/**
 * Canonical request-state contract for Company Intelligence Fabric.
 * Typed substructures — not an arbitrary blob god object.
 */

import type { ComparabilityResult } from "./comparabilityEngine.ts";
import type { CapabilityId } from "./capabilityRegistry.ts";
import type { StructuredConversationState } from "./conversationState.ts";
import { createEmptyConversationState } from "./conversationState.ts";
import type { ClaimRecord, EvidenceRecord } from "./evidenceLedger.ts";
import type { FeasibilityResult } from "./feasibilityGate.ts";
import type { IntelligenceScope } from "./scope.ts";
import { createIntelligenceScope } from "./scope.ts";
import type { IntelligenceTelemetry } from "./telemetry.ts";
import { createEmptyTelemetry } from "./telemetry.ts";
import type { DateRange, ResearchBudgetTier } from "./types.ts";
import type { CoverageReport } from "./coverageModel.ts";

export type IntelligencePlan = {
  goal: string | null;
  capabilities: CapabilityId[];
  researchBudgetTier: ResearchBudgetTier;
  needsClarification: boolean;
  clarificationPrompt: string | null;
};

export type EventWindowState = {
  holidayId: string;
  convention: string;
  conventionLabel: string;
  anchorDate: string;
  year: number;
  weekdaySignature: string;
} | null;

export type PeriodState = {
  current: DateRange | null;
  comparison: DateRange | null;
  /** Next/future event window used for bounded forecasts. */
  forecast: DateRange | null;
  requestedSemantics: string | null;
  eventWindow: EventWindowState;
  nextHolidayDate: string | null;
};

export type FabricStage =
  | "INITIALIZED"
  | "SCOPED"
  | "TEMPORAL_RESOLVED"
  | "FEASIBILITY_CHECKED"
  | "PLANNED"
  | "EXECUTING"
  | "EVIDENCE_READY"
  | "SYNTHESIZED"
  | "VERIFIED"
  | "COMPLETE";

export type CompanyIntelligenceState = {
  stage: FabricStage;
  request: {
    originalQuestion: string;
    normalizedQuestion: string;
    threadId: string | null;
  };
  scope: IntelligenceScope;
  conversation: StructuredConversationState;
  feasibility: FeasibilityResult | null;
  plan: IntelligencePlan;
  periods: PeriodState;
  comparability: ComparabilityResult | null;
  toolResults: Record<string, unknown>;
  evidence: EvidenceRecord[];
  coverage: CoverageReport[];
  claims: ClaimRecord[];
  warnings: string[];
  cost: IntelligenceTelemetry;
  answer: {
    text: string | null;
    verified: boolean | null;
  };
};

export function createCompanyIntelligenceState(input: {
  originalQuestion: string;
  normalizedQuestion?: string;
  threadId?: string | null;
  scope?: Partial<Parameters<typeof createIntelligenceScope>[0]>;
  conversation?: StructuredConversationState | null;
}): CompanyIntelligenceState {
  return {
    stage: "INITIALIZED",
    request: {
      originalQuestion: String(input.originalQuestion || ""),
      normalizedQuestion: String(input.normalizedQuestion || input.originalQuestion || ""),
      threadId: input.threadId || null,
    },
    scope: createIntelligenceScope(input.scope || {}),
    conversation: input.conversation || createEmptyConversationState(),
    feasibility: null,
    plan: {
      goal: null,
      capabilities: [],
      researchBudgetTier: 0,
      needsClarification: false,
      clarificationPrompt: null,
    },
    periods: {
      current: null,
      comparison: null,
      forecast: null,
      requestedSemantics: null,
      eventWindow: null,
      nextHolidayDate: null,
    },
    comparability: null,
    toolResults: {},
    evidence: [],
    coverage: [],
    claims: [],
    warnings: [],
    cost: createEmptyTelemetry(),
    answer: {
      text: null,
      verified: null,
    },
  };
}

/** Preserve critical fields when merging patches (no silent Network widen / period drop). */
export function patchIntelligenceState(
  state: CompanyIntelligenceState,
  patch: Partial<CompanyIntelligenceState>,
): CompanyIntelligenceState {
  const nextScope = patch.scope
    ? {
      ...state.scope,
      ...patch.scope,
      primaryBranchId: patch.scope.primaryBranchId ?? state.scope.primaryBranchId,
      branchIds: patch.scope.branchIds ?? state.scope.branchIds,
    }
    : state.scope;

  return {
    ...state,
    ...patch,
    request: { ...state.request, ...(patch.request || {}) },
    scope: nextScope,
    conversation: patch.conversation
      ? { ...state.conversation, ...patch.conversation }
      : state.conversation,
    plan: patch.plan ? { ...state.plan, ...patch.plan } : state.plan,
    periods: patch.periods
      ? {
        current: patch.periods.current !== undefined ? patch.periods.current : state.periods.current,
        comparison: patch.periods.comparison !== undefined
          ? patch.periods.comparison
          : state.periods.comparison,
        forecast: patch.periods.forecast !== undefined
          ? patch.periods.forecast
          : state.periods.forecast,
        requestedSemantics: patch.periods.requestedSemantics !== undefined
          ? patch.periods.requestedSemantics
          : state.periods.requestedSemantics,
        eventWindow: patch.periods.eventWindow !== undefined
          ? patch.periods.eventWindow
          : state.periods.eventWindow,
        nextHolidayDate: patch.periods.nextHolidayDate !== undefined
          ? patch.periods.nextHolidayDate
          : state.periods.nextHolidayDate,
      }
      : state.periods,
    toolResults: patch.toolResults
      ? { ...state.toolResults, ...patch.toolResults }
      : state.toolResults,
    evidence: patch.evidence ?? state.evidence,
    coverage: patch.coverage ?? state.coverage,
    claims: patch.claims ?? state.claims,
    warnings: patch.warnings ?? state.warnings,
    cost: patch.cost ? { ...state.cost, ...patch.cost } : state.cost,
    answer: patch.answer ? { ...state.answer, ...patch.answer } : state.answer,
  };
}
