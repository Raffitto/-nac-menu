export const COST_STATUSES = Object.freeze({
  VALID: "VALID_COST",
  LEGITIMATE_ZERO: "LEGITIMATE_ZERO_COST",
  MISSING: "MISSING_COST",
  NO_HISTORY: "NO_HISTORICAL_COST",
  UNRESOLVED_ITEM: "UNRESOLVED_ITEM",
  UNRESOLVED_UNIT: "UNRESOLVED_UNIT",
  STALE: "STALE_COST",
  INVALID_LINE: "INVALID_RECIPE_LINE",
  INCOMPLETE_SUBRECIPE: "INCOMPLETE_SUBRECIPE",
  MISSING_RECIPE: "MISSING_RECIPE",
});

export const COST_TRUST = Object.freeze({
  TRUSTED: "TRUSTED",
  MOSTLY_COMPLETE: "MOSTLY_COMPLETE",
  INCOMPLETE: "INCOMPLETE",
  UNRELIABLE: "UNRELIABLE",
});

export const COST_TRUST_LABELS = Object.freeze({
  [COST_TRUST.TRUSTED]: "Trusted",
  [COST_TRUST.MOSTLY_COMPLETE]: "Mostly complete",
  [COST_TRUST.INCOMPLETE]: "Incomplete",
  [COST_TRUST.UNRELIABLE]: "Unreliable",
});

export function isTrustedProductCost(productCost) {
  return productCost?.costTrustStatus === COST_TRUST.TRUSTED
    && productCost?.profitabilityAvailable === true
    && Number.isFinite(Number(productCost?.costPerSoldPortion));
}

export function gateMenuEngineeringClassification(item, classification) {
  if (!isTrustedProductCost(item)) {
    return {
      ...classification,
      quadrant: "COST_DATA_INCOMPLETE",
      suggestion: "Complete and verify historical recipe cost before profitability classification.",
      costTrustStatus: item?.costTrustStatus || COST_TRUST.UNRELIABLE,
    };
  }
  return {
    ...classification,
    costTrustStatus: item.costTrustStatus,
  };
}

export function formatSar(value) {
  if (value == null || value === "") return "Unavailable";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Unavailable";
  return `SAR ${amount.toFixed(2)}`;
}

export function costTrustLabel(value) {
  return COST_TRUST_LABELS[value] || COST_TRUST_LABELS[COST_TRUST.UNRELIABLE];
}
