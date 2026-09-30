/**
 * Structured short-term conversation state — not unlimited transcript.
 */

import type { CapabilityId } from "./capabilityRegistry.ts";
import type { BranchId, DateRange } from "./types.ts";

/** Semantic analysis context. Numbers are recomputed; this stores intent only. */
export type ManagementContext = {
  capability: "comparison" | "ranking" | "trend" | "period" | null;
  metric: "net_sales" | "covers" | "orders" | "average_spend" | "sales_per_day" | null;
  source: "cash_up" | "commerce_orders" | "menu_analytics" | "review_analytics" | null;
  mode: "full_vs_open" | "like_for_like" | "single_period" | null;
  rankingDirection: "top" | "bottom" | null;
  topN: number | null;
};

export function emptyManagementContext(): ManagementContext {
  return {
    capability: null,
    metric: null,
    source: null,
    mode: null,
    rankingDirection: null,
    topN: null,
  };
}

export type StructuredConversationState = {
  activeCompanyId: string | null;
  activeBrandId: string | null;
  activeBranchId: BranchId | null;
  activePeriods: {
    current: DateRange | null;
    comparison: DateRange | null;
  };
  activeMetricFamily: string | null;
  activeCapabilities: CapabilityId[];
  filters: Record<string, string | number | boolean | null>;
  evidenceRefs: string[];
  hypothesisRefs: string[];
  previousIntent: string | null;
  management: ManagementContext;
};

export function createEmptyConversationState(): StructuredConversationState {
  return {
    activeCompanyId: null,
    activeBrandId: null,
    activeBranchId: null,
    activePeriods: { current: null, comparison: null },
    activeMetricFamily: null,
    activeCapabilities: [],
    filters: {},
    evidenceRefs: [],
    hypothesisRefs: [],
    previousIntent: null,
    management: emptyManagementContext(),
  };
}

export function updateConversationState(
  prev: StructuredConversationState | null | undefined,
  patch: Partial<StructuredConversationState> & {
    filterPatch?: Record<string, string | number | boolean | null>;
  },
): StructuredConversationState {
  const base = prev || createEmptyConversationState();
  const periodPatch = patch.activePeriods;
  const activePeriods = periodPatch
    ? {
      current: Object.prototype.hasOwnProperty.call(periodPatch, "current")
        ? (periodPatch.current ?? null)
        : base.activePeriods.current,
      comparison: Object.prototype.hasOwnProperty.call(periodPatch, "comparison")
        ? (periodPatch.comparison ?? null)
        : base.activePeriods.comparison,
    }
    : base.activePeriods;
  return {
    activeCompanyId: patch.activeCompanyId ?? base.activeCompanyId,
    activeBrandId: patch.activeBrandId ?? base.activeBrandId,
    activeBranchId: patch.activeBranchId ?? base.activeBranchId,
    activePeriods,
    activeMetricFamily: patch.activeMetricFamily ?? base.activeMetricFamily,
    activeCapabilities: patch.activeCapabilities ?? base.activeCapabilities,
    filters: {
      ...base.filters,
      ...(patch.filters || {}),
      ...(patch.filterPatch || {}),
    },
    evidenceRefs: patch.evidenceRefs ?? base.evidenceRefs,
    hypothesisRefs: patch.hypothesisRefs ?? base.hypothesisRefs,
    previousIntent: patch.previousIntent ?? base.previousIntent,
    management: {
      ...emptyManagementContext(),
      ...(base.management || {}),
      ...(patch.management || {}),
    },
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
