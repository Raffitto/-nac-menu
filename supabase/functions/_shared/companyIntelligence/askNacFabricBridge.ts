/**
 * Thin bridge: existing Ask NAC flow → Company Intelligence Fabric state.
 * Does not replace routeIntent / tools / narration wholesale.
 */

import { assessComparability } from "./comparabilityEngine.ts";
import { decideResearchBudget } from "./researchBudget.ts";
import { assessFeasibility } from "./feasibilityGate.ts";
import {
  createCompanyIntelligenceState,
  patchIntelligenceState,
  type CompanyIntelligenceState,
} from "./intelligenceState.ts";
import { defaultBusinessTimeline } from "./businessTimeline.ts";
import { defaultTemporalService } from "./temporalService.ts";
import { updateConversationState } from "./conversationState.ts";
import type { CapabilityId } from "./capabilityRegistry.ts";
import { normalizeBranchId } from "./scope.ts";

export function bootstrapFabricState(input: {
  question: string;
  branchHint?: string | null;
  threadId?: string | null;
  deterministicHighConfidence?: boolean;
  referenceDate?: Date;
}): CompanyIntelligenceState {
  const branch = normalizeBranchId(input.branchHint);
  let state = createCompanyIntelligenceState({
    originalQuestion: input.question,
    threadId: input.threadId || null,
    scope: {
      primaryBranchId: branch,
      branchIds: branch ? [branch] : [],
    },
  });

  const temporal = defaultTemporalService.resolveFromQuestion(
    input.question,
    input.referenceDate || new Date(),
  );

  state = patchIntelligenceState(state, {
    periods: {
      current: temporal.range,
      comparison: temporal.compareRange,
      forecast: temporal.forecastRange || null,
      requestedSemantics: temporal.expression,
      eventWindow: temporal.eventWindow || null,
      nextHolidayDate: temporal.nextHolidayDate || null,
    },
  });

  const requiresComparison = Boolean(temporal.compareRange)
    || /\b(compare|vs|versus|last year|previous|why the difference)\b/i.test(input.question);

  const comparisonOperating = branch && temporal.compareRange
    ? defaultBusinessTimeline.getOperatingStatus(branch, temporal.compareRange)
    : null;
  const currentOperating = branch && temporal.range
    ? defaultBusinessTimeline.getOperatingStatus(branch, temporal.range)
    : null;

  const holidayBundle = temporal.holidayBundle;
  const allowPartialWithoutHistorical = Boolean(
    holidayBundle?.intent.detected
    && (holidayBundle.intent.wantsForecast || holidayBundle.intent.wantsNextDate)
    && currentOperating?.status === "not_yet_open",
  );

  const feasibility = assessFeasibility({
    scope: state.scope,
    currentPeriod: temporal.range,
    comparisonPeriod: temporal.compareRange,
    requiresComparison,
    timeline: defaultBusinessTimeline,
    allowPartialWithoutHistorical,
  });

  const comparability = requiresComparison
    ? assessComparability({
      current: temporal.range,
      comparison: temporal.compareRange,
      currentOperating,
      comparisonOperating,
    })
    : (temporal.forecastRange && temporal.range
      ? assessComparability({
        current: temporal.forecastRange,
        comparison: temporal.range,
        currentOperating: branch
          ? defaultBusinessTimeline.getOperatingStatus(branch, temporal.forecastRange)
          : null,
        comparisonOperating: currentOperating,
      })
      : null);

  const capabilities: CapabilityId[] = ["calendar.resolve_period", "company.branch_timeline"];
  if (holidayBundle?.intent.wantsForecast) capabilities.push("commercial.forecast");
  if (requiresComparison) capabilities.push("commercial.compare");
  else if (!holidayBundle || holidayBundle.intent.wantsHistoricalPerformance) {
    capabilities.push("commercial.performance");
  }
  if (/\b(why|logbook|operational)\b/i.test(input.question)) capabilities.push("operations.review");
  if (feasibility.status === "PARTIALLY_ANSWERABLE" && currentOperating?.status === "not_yet_open") {
    const idx = capabilities.indexOf("commercial.performance");
    if (idx >= 0) capabilities.splice(idx, 1);
  }

  const budget = decideResearchBudget({
    question: input.question,
    capabilities,
    requiresComparison,
    deterministicRouteHighConfidence: Boolean(input.deterministicHighConfidence),
    feasibilityStatus: feasibility.status,
  });

  state = patchIntelligenceState(state, {
    feasibility,
    comparability,
    plan: {
      goal: feasibility.status === "NOT_ANSWERABLE_AS_REQUESTED"
        ? "explain_infeasible_comparison"
        : "answer_management_question",
      capabilities,
      researchBudgetTier: budget.tier,
      needsClarification: feasibility.status === "REQUIRES_CLARIFICATION",
      clarificationPrompt: null,
    },
    conversation: updateConversationState(state.conversation, {
      activeCompanyId: state.scope.companyId,
      activeBrandId: state.scope.brandId,
      activeBranchId: state.scope.primaryBranchId,
      activePeriods: {
        current: temporal.range,
        comparison: temporal.compareRange,
      },
      activeMetricFamily: "commercial",
      activeCapabilities: capabilities,
    }),
    cost: {
      ...state.cost,
      budgetTier: budget.tier,
      deterministicRouteUsed: Boolean(input.deterministicHighConfidence),
      requestCategory: budget.label,
    },
    warnings: [
      ...feasibility.detail,
      ...(comparability?.reasons || []),
    ],
  });

  return state;
}

/** Deterministic infeasible answer when baseline branch was not operating. */
export function buildInfeasibleComparisonAnswer(state: CompanyIntelligenceState): string | null {
  if (state.feasibility?.status !== "NOT_ANSWERABLE_AS_REQUESTED") return null;
  if (!state.feasibility.reasons.includes("branch_not_operating_in_baseline_period")) return null;

  const branch = state.scope.primaryBranchId || "branch";
  const opening = defaultBusinessTimeline.getOpeningDate(branch);
  const baseline = state.periods.comparison;
  const current = state.periods.current;
  const baselineLabel = baseline?.label || (baseline ? `${baseline.startDate}–${baseline.endDate}` : "the baseline period");
  const currentLabel = current?.label || (current ? `${current.startDate}–${current.endDate}` : "the requested period");

  const openingClause = opening ? ` (opened ${opening})` : "";
  const alts = state.feasibility.suggestedAlternatives.length
    ? ` Suggested alternatives: ${state.feasibility.suggestedAlternatives.join("; ")}.`
    : "";

  return (
    `${capitalize(branch)} was not operating during ${baselineLabel}${openingClause}, `
    + `so a ${baselineLabel} vs ${currentLabel} ${capitalize(branch)} comparison is not valid.`
    + alts
  );
}

function capitalize(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
