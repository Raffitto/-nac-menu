import {
  absDecimal,
  addDecimal,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "./inventoryIntelligence";

export const VARIANCE_CAUSES = Object.freeze({
  EXPECTED_OPERATIONAL_DISPOSAL: "EXPECTED_OPERATIONAL_DISPOSAL",
  STAFF_MEAL_ACCOUNTED: "STAFF_MEAL_ACCOUNTED",
  PRODUCTION_YIELD_CONFIG: "PRODUCTION_YIELD_CONFIG",
  RECORDED_PRODUCTION_WASTE: "RECORDED_PRODUCTION_WASTE",
  COUNT_ENTRY_ERROR: "COUNT_ENTRY_ERROR",
  UNIT_CONVERSION_ERROR: "UNIT_CONVERSION_ERROR",
  RELATED_SKU_MAPPING: "RELATED_SKU_MAPPING",
  RECIPE_COVERAGE_GAP: "RECIPE_COVERAGE_GAP",
  RECIPE_COST_INCOMPLETE: "RECIPE_COST_INCOMPLETE",
  THEORETICAL_CONSUMPTION_ANOMALY: "THEORETICAL_CONSUMPTION_ANOMALY",
  PURCHASE_ENTRY_ERROR: "PURCHASE_ENTRY_ERROR",
  PURCHASE_COST_ANOMALY: "PURCHASE_COST_ANOMALY",
  DUPLICATE_TRANSACTION: "DUPLICATE_TRANSACTION",
  TRANSFER_MISMATCH: "TRANSFER_MISMATCH",
  UNRECORDED_WASTE: "UNRECORDED_WASTE",
  NEGATIVE_THEORETICAL_STOCK: "NEGATIVE_THEORETICAL_STOCK",
  MISSING_MOVEMENT: "MISSING_MOVEMENT",
  COST_DATA_INCOMPLETE: "COST_DATA_INCOMPLETE",
  TRUE_UNEXPLAINED_VARIANCE: "TRUE_UNEXPLAINED_VARIANCE",
  NEEDS_REVIEW: "NEEDS_REVIEW",
});

export const VARIANCE_CONFIDENCE = Object.freeze({
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
});

export const VARIANCE_SEVERITY = Object.freeze({
  CRITICAL: "CRITICAL",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
});

export const VARIANCE_REVIEW_STATUSES = Object.freeze([
  "OPEN",
  "REVIEWING",
  "EXPLAINED",
  "ACTION_REQUIRED",
  "RESOLVED",
  "DISMISSED",
]);

export const DEFAULT_MATERIALITY = Object.freeze({
  criticalValue: "5000",
  highValue: "1000",
  mediumValue: "250",
  highQuantityPercent: "100",
  mediumQuantityPercent: "25",
});

export const SUGGESTED_ACTIONS = Object.freeze({
  [VARIANCE_CAUSES.COUNT_ENTRY_ERROR]: "Review count quantity/unit and source evidence.",
  [VARIANCE_CAUSES.UNIT_CONVERSION_ERROR]: "Review the source unit and confirmed pack conversion.",
  [VARIANCE_CAUSES.RELATED_SKU_MAPPING]: "Review recipe and purchasing mappings for related SKUs.",
  [VARIANCE_CAUSES.PRODUCTION_YIELD_CONFIG]: "Review expected yield / production waste configuration.",
  [VARIANCE_CAUSES.EXPECTED_OPERATIONAL_DISPOSAL]: "Confirm recorded operational disposal evidence.",
  [VARIANCE_CAUSES.STAFF_MEAL_ACCOUNTED]: "Confirm staff-meal quantity and business date.",
  [VARIANCE_CAUSES.RECORDED_PRODUCTION_WASTE]: "Review recorded production waste and yield evidence.",
  [VARIANCE_CAUSES.MISSING_MOVEMENT]: "Record the missing operational inventory movement.",
  [VARIANCE_CAUSES.UNRECORDED_WASTE]: "Record waste or disposal with supporting evidence.",
  [VARIANCE_CAUSES.RECIPE_COVERAGE_GAP]: "Complete recipe mapping before evaluating theoretical variance.",
  [VARIANCE_CAUSES.RECIPE_COST_INCOMPLETE]: "Resolve historical ingredient costs before valuing this variance.",
  [VARIANCE_CAUSES.THEORETICAL_CONSUMPTION_ANOMALY]: "Review recipe dose, sales linkage, and theoretical consumption.",
  [VARIANCE_CAUSES.PURCHASE_ENTRY_ERROR]: "Review purchase quantity, unit, and invoice source evidence.",
  [VARIANCE_CAUSES.PURCHASE_COST_ANOMALY]: "Review supplier price and nearby correction transactions.",
  [VARIANCE_CAUSES.DUPLICATE_TRANSACTION]: "Review possible duplicate source references before correction.",
  [VARIANCE_CAUSES.TRANSFER_MISMATCH]: "Resolve sent vs received transfer discrepancy.",
  [VARIANCE_CAUSES.NEGATIVE_THEORETICAL_STOCK]: "Review movements that drove expected stock below zero.",
  [VARIANCE_CAUSES.COST_DATA_INCOMPLETE]: "Resolve historical cost evidence before assessing SAR impact.",
  [VARIANCE_CAUSES.TRUE_UNEXPLAINED_VARIANCE]: "Investigate source movements, count evidence, and operational usage.",
  [VARIANCE_CAUSES.NEEDS_REVIEW]: "Collect a complete physical count and source evidence.",
});

function decimal(value, fallback = "0") {
  return value == null || value === "" ? fallback : String(value);
}

function positive(value) {
  return compareDecimal(decimal(value), "0") > 0;
}

function nonZero(value) {
  return compareDecimal(decimal(value), "0") !== 0;
}

function ratio(numerator, denominator) {
  if (!positive(absDecimal(decimal(denominator)))) return null;
  return divideDecimal(absDecimal(decimal(numerator)), absDecimal(decimal(denominator)), 8);
}

function warningCodes(facts) {
  return new Set((facts.countQuality?.warnings || []).map((warning) => warning.code));
}

function exceptionTypes(facts) {
  return new Set((facts.openExceptions || []).map((exception) => exception.exceptionType));
}

function addCause(causes, cause) {
  if (cause && !causes.includes(cause)) causes.push(cause);
}

function isAccountedVariance(variance, accountedQuantity) {
  if (!positive(accountedQuantity)) return false;
  const remainingRatio = ratio(variance, accountedQuantity);
  return remainingRatio != null && compareDecimal(remainingRatio, "0.1") <= 0;
}

export function calculateExpectedClosing({
  openingQuantity = "0",
  purchases = "0",
  transfersIn = "0",
  productionOutput = "0",
  adjustmentsNet = "0",
  returnsToSupplier = "0",
  transfersOut = "0",
  staffMeal = "0",
  operationalDisposal = "0",
  recordedWaste = "0",
  productionInput = "0",
  actualOrderConsumption = "0",
  complimentary = "0",
}) {
  const additions = [
    openingQuantity,
    purchases,
    transfersIn,
    productionOutput,
    adjustmentsNet,
  ].reduce((total, value) => addDecimal(total, decimal(value)), "0");
  return [
    returnsToSupplier,
    transfersOut,
    staffMeal,
    operationalDisposal,
    recordedWaste,
    productionInput,
    actualOrderConsumption,
    complimentary,
  ].reduce((total, value) => subtractDecimal(total, absDecimal(decimal(value))), additions);
}

export function calculateVarianceQuantity({ physicalClosing, expectedClosing }) {
  if (physicalClosing == null || expectedClosing == null) return null;
  return subtractDecimal(decimal(physicalClosing), decimal(expectedClosing));
}

export function calculateTrustedVarianceValue({
  varianceQuantity,
  historicalUnitCost,
  costStatus,
}) {
  if (varianceQuantity == null || historicalUnitCost == null) return null;
  if (!["VALID_COST", "LEGITIMATE_ZERO_COST"].includes(costStatus)) return null;
  return multiplyDecimal(decimal(varianceQuantity), decimal(historicalUnitCost));
}

export function explainRelatedSkuVariance(items = []) {
  const positiveItem = items.find((item) => compareDecimal(decimal(item.varianceQuantity), "0") > 0);
  const negativeItem = items.find((item) => compareDecimal(decimal(item.varianceQuantity), "0") < 0);
  if (!positiveItem || !negativeItem) return null;
  return {
    cause: VARIANCE_CAUSES.RELATED_SKU_MAPPING,
    combinedVariance: items.reduce(
      (total, item) => addDecimal(total, decimal(item.varianceQuantity)),
      "0",
    ),
    positiveItem,
    negativeItem,
  };
}

export function classifyVarianceExplanation(facts) {
  const contributing = [];
  const warnings = warningCodes(facts);
  const exceptions = exceptionTypes(facts);
  const variance = facts.varianceQuantity;
  const expected = facts.expectedClosing;
  const actual = facts.actual || {};
  const related = explainRelatedSkuVariance(facts.relatedItems || []);
  let primaryCause;
  let confidence;

  if (facts.physicalClosing == null || variance == null) {
    primaryCause = VARIANCE_CAUSES.NEEDS_REVIEW;
    confidence = VARIANCE_CONFIDENCE.INSUFFICIENT_DATA;
  } else if (facts.countQuality?.hasUncountedLocation) {
    primaryCause = VARIANCE_CAUSES.NEEDS_REVIEW;
    confidence = VARIANCE_CONFIDENCE.INSUFFICIENT_DATA;
  } else if (
    warnings.has("pack_conversion_anomaly")
    || warnings.has("possible_grams_as_kilograms")
    || facts.countQuality?.hasUnresolvedUnit
  ) {
    primaryCause = VARIANCE_CAUSES.UNIT_CONVERSION_ERROR;
    confidence = VARIANCE_CONFIDENCE.MEDIUM;
  } else if (warnings.has("implausible_count")) {
    primaryCause = VARIANCE_CAUSES.COUNT_ENTRY_ERROR;
    confidence = VARIANCE_CONFIDENCE.MEDIUM;
  } else if (exceptions.has("transfer_mismatch")) {
    primaryCause = VARIANCE_CAUSES.TRANSFER_MISMATCH;
    confidence = VARIANCE_CONFIDENCE.HIGH;
  } else if (exceptions.has("possible_duplicate")) {
    primaryCause = VARIANCE_CAUSES.DUPLICATE_TRANSACTION;
    confidence = VARIANCE_CONFIDENCE.HIGH;
  } else if (related) {
    primaryCause = VARIANCE_CAUSES.RELATED_SKU_MAPPING;
    confidence = VARIANCE_CONFIDENCE.MEDIUM;
  } else if (
    compareDecimal(decimal(expected), "0") < 0
    && (positive(actual.productionInput) || positive(actual.recordedWaste))
  ) {
    primaryCause = VARIANCE_CAUSES.PRODUCTION_YIELD_CONFIG;
    confidence = VARIANCE_CONFIDENCE.MEDIUM;
    addCause(contributing, VARIANCE_CAUSES.NEGATIVE_THEORETICAL_STOCK);
  } else if (isAccountedVariance(variance, actual.operationalDisposal)) {
    primaryCause = VARIANCE_CAUSES.EXPECTED_OPERATIONAL_DISPOSAL;
    confidence = VARIANCE_CONFIDENCE.HIGH;
  } else if (isAccountedVariance(variance, actual.staffMeal)) {
    primaryCause = VARIANCE_CAUSES.STAFF_MEAL_ACCOUNTED;
    confidence = VARIANCE_CONFIDENCE.HIGH;
  } else if (isAccountedVariance(variance, actual.recordedWaste)) {
    primaryCause = VARIANCE_CAUSES.RECORDED_PRODUCTION_WASTE;
    confidence = VARIANCE_CONFIDENCE.HIGH;
  } else if (
    /(?:frying|sunflower|soya|soy|cooking)\s+oil|\boil\b/i.test(facts.itemName || "")
    && compareDecimal(decimal(variance), "0") < 0
    && !positive(actual.operationalDisposal)
  ) {
    primaryCause = VARIANCE_CAUSES.MISSING_MOVEMENT;
    confidence = VARIANCE_CONFIDENCE.MEDIUM;
    addCause(contributing, VARIANCE_CAUSES.UNRECORDED_WASTE);
  } else if (
    exceptions.has("quantity_anomaly")
    || exceptions.has("over_receipt")
    || exceptions.has("quantity_cost_mismatch")
  ) {
    if (facts.nearbyCorrectionEvidence) {
      primaryCause = VARIANCE_CAUSES.NEEDS_REVIEW;
      confidence = VARIANCE_CONFIDENCE.MEDIUM;
    } else {
      primaryCause = VARIANCE_CAUSES.PURCHASE_ENTRY_ERROR;
      confidence = VARIANCE_CONFIDENCE.HIGH;
    }
  } else if (
    exceptions.has("unit_cost_anomaly")
    || exceptions.has("supplier_price_movement")
    || (facts.priceAlerts || []).length > 0
  ) {
    if (facts.nearbyCorrectionEvidence) {
      primaryCause = VARIANCE_CAUSES.NEEDS_REVIEW;
      confidence = VARIANCE_CONFIDENCE.MEDIUM;
    } else {
      primaryCause = VARIANCE_CAUSES.PURCHASE_COST_ANOMALY;
      confidence = VARIANCE_CONFIDENCE.MEDIUM;
    }
  } else if (Number(facts.recipeCoveragePct || 0) < 80) {
    primaryCause = VARIANCE_CAUSES.RECIPE_COVERAGE_GAP;
    confidence = VARIANCE_CONFIDENCE.HIGH;
  } else if (compareDecimal(decimal(expected), "0") < 0) {
    primaryCause = VARIANCE_CAUSES.NEGATIVE_THEORETICAL_STOCK;
    confidence = VARIANCE_CONFIDENCE.MEDIUM;
  } else if (nonZero(variance)) {
    primaryCause = VARIANCE_CAUSES.TRUE_UNEXPLAINED_VARIANCE;
    confidence = VARIANCE_CONFIDENCE.LOW;
  } else {
    primaryCause = VARIANCE_CAUSES.NEEDS_REVIEW;
    confidence = VARIANCE_CONFIDENCE.LOW;
  }

  if (Number(facts.recipeCoveragePct || 0) < 80) {
    addCause(contributing, VARIANCE_CAUSES.RECIPE_COVERAGE_GAP);
  }
  if (!["VALID_COST", "LEGITIMATE_ZERO_COST"].includes(facts.costStatus)) {
    addCause(contributing, VARIANCE_CAUSES.COST_DATA_INCOMPLETE);
  }
  if (compareDecimal(decimal(expected), "0") < 0) {
    addCause(contributing, VARIANCE_CAUSES.NEGATIVE_THEORETICAL_STOCK);
  }
  if (primaryCause === VARIANCE_CAUSES.RECIPE_COVERAGE_GAP && nonZero(variance)) {
    addCause(contributing, VARIANCE_CAUSES.TRUE_UNEXPLAINED_VARIANCE);
  }
  if (
    (facts.countQuality?.overrideReasons || []).length > 0
    && confidence === VARIANCE_CONFIDENCE.HIGH
  ) {
    confidence = VARIANCE_CONFIDENCE.MEDIUM;
  }

  return {
    primaryCause,
    contributingCauses: contributing.filter((cause) => cause !== primaryCause),
    confidence,
    suggestedAction: SUGGESTED_ACTIONS[primaryCause],
    relatedSkuEvidence: related,
  };
}

export function classifyVarianceSeverity(facts, thresholds = DEFAULT_MATERIALITY) {
  const value = facts.varianceValue == null ? null : absDecimal(decimal(facts.varianceValue));
  const quantityPercent = ratio(
    facts.varianceQuantity,
    positive(absDecimal(decimal(facts.expectedClosing)))
      ? facts.expectedClosing
      : facts.physicalClosing,
  );
  const quantityPct = quantityPercent == null ? null : multiplyDecimal(quantityPercent, "100");
  const hasBlocking = (facts.openExceptions || []).some(
    (exception) => exception.severity === "blocking",
  );
  if (
    hasBlocking
    || (value != null && compareDecimal(value, thresholds.criticalValue) >= 0)
  ) return VARIANCE_SEVERITY.CRITICAL;
  if (
    facts.countQuality?.hasUncountedLocation
    || (facts.countQuality?.warnings || []).length > 0
  ) return VARIANCE_SEVERITY.HIGH;
  if (
    (value != null && compareDecimal(value, thresholds.highValue) >= 0)
    || (quantityPct != null && compareDecimal(quantityPct, thresholds.highQuantityPercent) >= 0)
  ) return VARIANCE_SEVERITY.HIGH;
  if (
    (value != null && compareDecimal(value, thresholds.mediumValue) >= 0)
    || (quantityPct != null && compareDecimal(quantityPct, thresholds.mediumQuantityPercent) >= 0)
    || (
      facts.physicalClosing == null
      && (
        nonZero(facts.openingQuantity)
        || Object.values(facts.actual || {}).some(nonZero)
      )
    )
  ) return VARIANCE_SEVERITY.MEDIUM;
  return VARIANCE_SEVERITY.LOW;
}

export function buildVarianceAnalysis(facts, thresholds = DEFAULT_MATERIALITY) {
  const explanation = classifyVarianceExplanation(facts);
  return {
    ...facts,
    ...explanation,
    severity: classifyVarianceSeverity(facts, thresholds),
    materiality: {
      varianceValue: facts.varianceValue,
      varianceQuantity: facts.varianceQuantity,
      prioritized: classifyVarianceSeverity(facts, thresholds) !== VARIANCE_SEVERITY.LOW,
    },
  };
}

export function summarizeVarianceCommandCenter(items = []) {
  const summary = {
    totalItems: items.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    negativeTheoreticalStock: 0,
    countQualityIssues: 0,
    missingRecipeCoverage: 0,
    untrustedValueCount: 0,
    totalTrustedVarianceValue: "0",
  };
  for (const item of items) {
    const severityKey = String(item.severity || "LOW").toLowerCase();
    summary[severityKey] += 1;
    if (
      item.primaryCause === VARIANCE_CAUSES.NEGATIVE_THEORETICAL_STOCK
      || item.contributingCauses?.includes(VARIANCE_CAUSES.NEGATIVE_THEORETICAL_STOCK)
    ) summary.negativeTheoreticalStock += 1;
    if (item.countQuality?.warnings?.length || item.countQuality?.hasUncountedLocation) {
      summary.countQualityIssues += 1;
    }
    if (
      item.primaryCause === VARIANCE_CAUSES.RECIPE_COVERAGE_GAP
      || item.contributingCauses?.includes(VARIANCE_CAUSES.RECIPE_COVERAGE_GAP)
    ) summary.missingRecipeCoverage += 1;
    if (item.varianceValue == null) summary.untrustedValueCount += 1;
    else summary.totalTrustedVarianceValue = addDecimal(
      summary.totalTrustedVarianceValue,
      absDecimal(decimal(item.varianceValue)),
    );
  }
  return summary;
}
