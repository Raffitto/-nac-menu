/**
 * Structured short-term conversation state — not unlimited transcript.
 */

import type { CapabilityId } from "./capabilityRegistry.ts";
import type { BranchId, DateRange } from "./types.ts";

export type StructuredConversationState = {
  activeCompanyId: string | null;
  activeBrandId: string | null;
  activeBranchId: BranchId | null;
  activePeriods: {
    current: DateRange | null;
    comparison: DateRange | null;
  };
  activeMetricFamily: string | null;
  /** Specific commercial metric when known (sales, covers, orders, avg_spend). */
  activeMetric: string | null;
  activeCapabilities: CapabilityId[];
  filters: Record<string, string | number | boolean | null>;
  evidenceRefs: string[];
  hypothesisRefs: string[];
  previousIntent: string | null;
  activeRanking: "top" | "bottom" | null;
  activeRankingCount: number | null;
  activeAnalysisIntent: string | null;
  activeSemanticPlan: Record<string, unknown> | null;
};

export function createEmptyConversationState(): StructuredConversationState {
  return {
    activeCompanyId: null,
    activeBrandId: null,
    activeBranchId: null,
    activePeriods: { current: null, comparison: null },
    activeMetricFamily: null,
    activeMetric: null,
    activeCapabilities: [],
    filters: {},
    evidenceRefs: [],
    hypothesisRefs: [],
    previousIntent: null,
    activeRanking: null,
    activeRankingCount: null,
    activeAnalysisIntent: null,
    activeSemanticPlan: null,
  };
}

export function updateConversationState(
  prev: StructuredConversationState | null | undefined,
  patch: Partial<StructuredConversationState> & {
    filterPatch?: Record<string, string | number | boolean | null>;
  },
): StructuredConversationState {
  const base = prev || createEmptyConversationState();
  return {
    activeCompanyId: patch.activeCompanyId ?? base.activeCompanyId,
    activeBrandId: patch.activeBrandId ?? base.activeBrandId,
    activeBranchId: patch.activeBranchId ?? base.activeBranchId,
    activePeriods: {
      current: patch.activePeriods && "current" in patch.activePeriods
        ? patch.activePeriods.current ?? null
        : base.activePeriods.current,
      comparison: patch.activePeriods && "comparison" in patch.activePeriods
        ? patch.activePeriods.comparison ?? null
        : base.activePeriods.comparison,
    },
    activeMetricFamily: patch.activeMetricFamily ?? base.activeMetricFamily,
    activeMetric: patch.activeMetric ?? base.activeMetric,
    activeCapabilities: patch.activeCapabilities ?? base.activeCapabilities,
    filters: {
      ...base.filters,
      ...(patch.filters || {}),
      ...(patch.filterPatch || {}),
    },
    evidenceRefs: patch.evidenceRefs ?? base.evidenceRefs,
    hypothesisRefs: patch.hypothesisRefs ?? base.hypothesisRefs,
    previousIntent: patch.previousIntent ?? base.previousIntent,
    activeRanking: patch.activeRanking !== undefined ? patch.activeRanking : base.activeRanking,
    activeRankingCount: patch.activeRankingCount !== undefined ? patch.activeRankingCount : base.activeRankingCount,
    activeAnalysisIntent: patch.activeAnalysisIntent !== undefined ? patch.activeAnalysisIntent : base.activeAnalysisIntent,
    activeSemanticPlan: patch.activeSemanticPlan !== undefined ? patch.activeSemanticPlan : (base.activeSemanticPlan || null),
  };
}

/** Apply follow-up semantics: keep filters/branch unless explicitly changed. */
export function resolveFollowUpScope(
  state: StructuredConversationState,
  mentionedBranch: BranchId | null,
  weekendOnly?: boolean,
): StructuredConversationState {
  return updateConversationState(state, {
    activeBranchId: mentionedBranch || state.activeBranchId,
    filterPatch: weekendOnly ? { weekendOnly: true } : undefined,
  });
}
