/**
 * Feasibility gate — cheap "Can I answer this?" before research.
 */

import type { BusinessTimelineRegistry } from "./businessTimeline.ts";
import { defaultBusinessTimeline } from "./businessTimeline.ts";
import type { CoverageReport } from "./coverageModel.ts";
import type { IntelligenceScope } from "./scope.ts";
import type { DateRange, FeasibilityStatus } from "./types.ts";

export type FeasibilityReasonCode =
  | "branch_not_operating_in_baseline_period"
  | "branch_not_operating_in_current_period"
  | "insufficient_sales_coverage"
  | "comparison_period_missing"
  | "scope_ambiguous"
  | "external_context_required"
  | "period_unresolved"
  | "ok";

export type FeasibilityResult = {
  status: FeasibilityStatus;
  reasons: FeasibilityReasonCode[];
  detail: string[];
  suggestedAlternatives: string[];
};

export function assessFeasibility(input: {
  scope: IntelligenceScope;
  currentPeriod?: DateRange | null;
  comparisonPeriod?: DateRange | null;
  requiresComparison?: boolean;
  coverage?: CoverageReport | null;
  requiresExternalResearch?: boolean;
  timeline?: BusinessTimelineRegistry;
  /** When true, non-operating historical window can still yield next-date / forecast answers. */
  allowPartialWithoutHistorical?: boolean;
}): FeasibilityResult {
  const timeline = input.timeline || defaultBusinessTimeline;
  const reasons: FeasibilityReasonCode[] = [];
  const detail: string[] = [];
  const suggestedAlternatives: string[] = [];

  const branch = input.scope.primaryBranchId;
  if (!branch && !input.scope.access.canSeeNetwork) {
    reasons.push("scope_ambiguous");
    detail.push("No primary branch resolved and network scope not allowed.");
  }

  if (input.requiresComparison && !input.comparisonPeriod) {
    reasons.push("comparison_period_missing");
    detail.push("Comparison requested but comparison period is missing.");
  }

  if (!input.currentPeriod && input.requiresComparison) {
    reasons.push("period_unresolved");
    detail.push("Current period could not be resolved.");
  }

  if (branch && input.comparisonPeriod) {
    const baseline = timeline.getOperatingStatus(branch, input.comparisonPeriod);
    if (baseline.status === "not_yet_open") {
      reasons.push("branch_not_operating_in_baseline_period");
      detail.push(
        `${branch} was not operating during ${input.comparisonPeriod.label || input.comparisonPeriod.startDate + "–" + input.comparisonPeriod.endDate}`
          + (baseline.openingDate ? ` (opened ${baseline.openingDate}).` : "."),
      );
      if (input.currentPeriod) {
        suggestedAlternatives.push(
          `Compare available post-opening periods for ${branch} only`,
        );
        suggestedAlternatives.push(
          `Compare ${input.currentPeriod.label || "current period"} against the first comparable post-opening window`,
        );
      }
    }
  }

  if (branch && input.currentPeriod) {
    const current = timeline.getOperatingStatus(branch, input.currentPeriod);
    if (current.status === "not_yet_open") {
      reasons.push("branch_not_operating_in_current_period");
      detail.push(`${branch} was not operating in the requested current period.`);
    }
  }

  if (input.coverage && input.coverage.coverageRatio != null && input.coverage.coverageRatio < 0.5) {
    reasons.push("insufficient_sales_coverage");
    detail.push(`Coverage ratio ${input.coverage.coverageRatio.toFixed(2)} is too weak for a full answer.`);
  }

  if (input.requiresExternalResearch) {
    reasons.push("external_context_required");
  }

  if (reasons.includes("branch_not_operating_in_baseline_period")) {
    return {
      status: "NOT_ANSWERABLE_AS_REQUESTED",
      reasons,
      detail,
      suggestedAlternatives,
    };
  }

  if (reasons.includes("branch_not_operating_in_current_period")) {
    if (input.allowPartialWithoutHistorical) {
      suggestedAlternatives.push("Answer next holiday date and bounded forecast without invalid historical baseline");
      return {
        status: "PARTIALLY_ANSWERABLE",
        reasons,
        detail,
        suggestedAlternatives,
      };
    }
    return {
      status: "NOT_ANSWERABLE_AS_REQUESTED",
      reasons,
      detail,
      suggestedAlternatives,
    };
  }

  if (reasons.includes("scope_ambiguous") || reasons.includes("comparison_period_missing") || reasons.includes("period_unresolved")) {
    return {
      status: reasons.includes("scope_ambiguous") ? "REQUIRES_CLARIFICATION" : "NOT_ANSWERABLE_AS_REQUESTED",
      reasons,
      detail,
      suggestedAlternatives,
    };
  }

  if (reasons.includes("insufficient_sales_coverage")) {
    return {
      status: "PARTIALLY_ANSWERABLE",
      reasons,
      detail,
      suggestedAlternatives,
    };
  }

  if (reasons.includes("external_context_required")) {
    return {
      status: "REQUIRES_RESEARCH",
      reasons,
      detail,
      suggestedAlternatives,
    };
  }

  return {
    status: "ANSWERABLE",
    reasons: reasons.length ? reasons : ["ok"],
    detail,
    suggestedAlternatives,
  };
}
