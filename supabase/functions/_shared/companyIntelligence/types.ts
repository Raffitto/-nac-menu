/**
 * Shared primitives for Company Intelligence Fabric.
 */

export type IsoDate = string; // YYYY-MM-DD
export type CompanyId = string;
export type BrandId = string;
export type BranchId = "khobar" | "riyadh" | "jeddah" | string;

export type DateRange = {
  startDate: IsoDate;
  endDate: IsoDate;
  label?: string | null;
  semantic?: string | null;
};

export type ResearchBudgetTier = 0 | 1 | 2 | 3;

export type FeasibilityStatus =
  | "ANSWERABLE"
  | "PARTIALLY_ANSWERABLE"
  | "NOT_ANSWERABLE_AS_REQUESTED"
  | "REQUIRES_RESEARCH"
  | "REQUIRES_CLARIFICATION";

export type ComparabilityStatus =
  | "comparable"
  | "partially_comparable"
  | "not_comparable";

export type ComparisonMethod =
  | "full_period"
  | "matched_days"
  | "daily_average"
  | "matched_weekday"
  | "none";

export type ClaimType =
  | "VERIFIED_FACT"
  | "DERIVED_METRIC"
  | "FORECAST"
  | "SUPPORTED_ASSOCIATION"
  | "PLAUSIBLE_HYPOTHESIS"
  | "UNSUPPORTED";

export type SourceAuthority =
  | "CANONICAL_STRUCTURED"
  | "LEGACY_EXTERNAL_EVIDENCE"
  | "LEGACY_FOODICS_COMPARISON_ONLY"
  | "OPERATIONAL_RECORDED_EVIDENCE"
  | "EXTERNAL_CONTEXT"
  | "SECONDARY_EXTERNAL_CONTEXT"
  | "COMPANY_HISTORICAL"
  | "UNKNOWN";

export type EvidenceDomain =
  | "INTERNAL_STRUCTURED"
  | "INTERNAL_QUALITATIVE"
  | "COMPANY_HISTORICAL"
  | "EXTERNAL";
