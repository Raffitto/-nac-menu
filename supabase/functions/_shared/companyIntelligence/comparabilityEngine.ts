/**
 * Deterministic comparability engine — LLM must not decide arithmetic comparability.
 */

import type { OperatingStatus } from "./businessTimeline.ts";
import { inclusiveDayCount, type CoverageReport } from "./coverageModel.ts";
import type { ComparabilityStatus, ComparisonMethod, DateRange } from "./types.ts";

export type ComparabilityResult = {
  status: ComparabilityStatus;
  reasons: string[];
  requestedPeriods: {
    current: DateRange | null;
    comparison: DateRange | null;
  };
  observedCoverage: {
    current: CoverageReport | null;
    comparison: CoverageReport | null;
  };
  structuralDifferences: string[];
  recommendedMethod: ComparisonMethod;
};

export function assessComparability(input: {
  current: DateRange | null;
  comparison: DateRange | null;
  currentCoverage?: CoverageReport | null;
  comparisonCoverage?: CoverageReport | null;
  currentOperating?: OperatingStatus | null;
  comparisonOperating?: OperatingStatus | null;
}): ComparabilityResult {
  const reasons: string[] = [];
  const structuralDifferences: string[] = [];
  const current = input.current;
  const comparison = input.comparison;

  if (!current || !comparison) {
    return {
      status: "not_comparable",
      reasons: ["missing_period"],
      requestedPeriods: { current, comparison },
      observedCoverage: {
        current: input.currentCoverage || null,
        comparison: input.comparisonCoverage || null,
      },
      structuralDifferences,
      recommendedMethod: "none",
    };
  }

  if (input.comparisonOperating?.status === "not_yet_open") {
    structuralDifferences.push("baseline_branch_not_yet_open");
    reasons.push("branch_not_operating_in_baseline_period");
    return {
      status: "not_comparable",
      reasons,
      requestedPeriods: { current, comparison },
      observedCoverage: {
        current: input.currentCoverage || null,
        comparison: input.comparisonCoverage || null,
      },
      structuralDifferences,
      recommendedMethod: "none",
    };
  }

  if (input.currentOperating?.status === "not_yet_open") {
    structuralDifferences.push("current_branch_not_yet_open");
    reasons.push("branch_not_operating_in_current_period");
    return {
      status: "not_comparable",
      reasons,
      requestedPeriods: { current, comparison },
      observedCoverage: {
        current: input.currentCoverage || null,
        comparison: input.comparisonCoverage || null,
      },
      structuralDifferences,
      recommendedMethod: "none",
    };
  }

  const currentDays = inclusiveDayCount(current);
  const comparisonDays = inclusiveDayCount(comparison);
  if (currentDays !== comparisonDays) {
    structuralDifferences.push("different_period_lengths");
    reasons.push("period_length_mismatch");
  }

  const curRatio = input.currentCoverage?.coverageRatio;
  const cmpRatio = input.comparisonCoverage?.coverageRatio;
  const partial =
    (curRatio != null && curRatio < 1)
    || (cmpRatio != null && cmpRatio < 1)
    || structuralDifferences.includes("different_period_lengths");

  if (curRatio != null && curRatio < 0.5) reasons.push("weak_current_coverage");
  if (cmpRatio != null && cmpRatio < 0.5) reasons.push("weak_comparison_coverage");

  if (reasons.includes("weak_current_coverage") && reasons.includes("weak_comparison_coverage")) {
    return {
      status: "not_comparable",
      reasons,
      requestedPeriods: { current, comparison },
      observedCoverage: {
        current: input.currentCoverage || null,
        comparison: input.comparisonCoverage || null,
      },
      structuralDifferences,
      recommendedMethod: "none",
    };
  }

  let recommendedMethod: ComparisonMethod = "full_period";
  if (partial) {
    recommendedMethod = "matched_days";
    reasons.push("use_matched_or_normalized_method");
  }
  if (
    (curRatio != null && curRatio < 0.8)
    || (cmpRatio != null && cmpRatio < 0.8)
  ) {
    recommendedMethod = "matched_days";
  }

  return {
    status: partial ? "partially_comparable" : "comparable",
    reasons: reasons.length ? reasons : ["periods_aligned"],
    requestedPeriods: { current, comparison },
    observedCoverage: {
      current: input.currentCoverage || null,
      comparison: input.comparisonCoverage || null,
    },
    structuralDifferences,
    recommendedMethod,
  };
}
