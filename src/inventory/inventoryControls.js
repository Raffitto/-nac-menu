import {
  addDecimal,
  absDecimal,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "./inventoryIntelligence";

export const INVENTORY_CLASSIFICATIONS = Object.freeze([
  { value: "food_ingredient", label: "Food ingredient", recipeCostEligible: true },
  { value: "beverage", label: "Beverage", recipeCostEligible: true },
  { value: "packaging", label: "Packaging", recipeCostEligible: false },
  { value: "cleaning", label: "Cleaning", recipeCostEligible: false },
  { value: "operating_supply", label: "Operating supply", recipeCostEligible: false },
  { value: "chemical", label: "Chemical", recipeCostEligible: false },
  { value: "equipment_consumable", label: "Equipment consumable", recipeCostEligible: false },
  { value: "other", label: "Other", recipeCostEligible: false },
]);

export const OPERATIONAL_MOVEMENT_OPTIONS = Object.freeze([
  { value: "disposal", label: "Operational disposal", direction: "out" },
  { value: "operational_use", label: "Operational use", direction: "out" },
  { value: "staff_meal", label: "Staff meal", direction: "out" },
  { value: "production_consumption", label: "Production input", direction: "out" },
  { value: "production_output", label: "Production output", direction: "in" },
  { value: "production_waste", label: "Recorded production waste", direction: "out" },
  { value: "order_waste", label: "Recorded order waste", direction: "out" },
  { value: "spoilage", label: "Spoilage", direction: "out" },
  { value: "breakage", label: "Breakage", direction: "out" },
  { value: "complimentary_internal_use", label: "Complimentary / internal use", direction: "out" },
]);

const PACK_UNITS = new Set([
  "box", "boxes", "pack", "packs", "packet", "packets",
  "case", "cases", "bottle", "bottles", "roll", "rolls",
]);

function positive(value) {
  return value != null && compareDecimal(value, "0") > 0;
}

function ratio(left, right) {
  if (!positive(right)) return null;
  return divideDecimal(absDecimal(left), absDecimal(right), 6);
}

export function classificationDefault(classification) {
  return INVENTORY_CLASSIFICATIONS.find(({ value }) => value === classification)
    ?.recipeCostEligible ?? false;
}

export function evaluateCountGuardrails({
  enteredQuantity,
  sourceQuantity = enteredQuantity,
  sourceUnit,
  canonicalUnit,
  conversionFactor,
  expectedQuantity = "0",
  previousCount = null,
}) {
  const warnings = [];
  const baseline = [expectedQuantity, previousCount]
    .filter(positive)
    .sort((left, right) => compareDecimal(absDecimal(right), absDecimal(left)))[0] || "0";
  const normalizedSourceUnit = String(sourceUnit || "").trim().toLowerCase();

  if (PACK_UNITS.has(normalizedSourceUnit) && (!positive(conversionFactor) || compareDecimal(conversionFactor, "1") === 0)) {
    warnings.push({
      code: "pack_conversion_anomaly",
      severity: "review",
      message: "This item is counted in a pack unit. Confirm the explicit conversion to the base unit.",
      evidence: { sourceUnit, conversionFactor: conversionFactor ?? null },
    });
  }

  const multiple = ratio(enteredQuantity, baseline);
  if (multiple && compareDecimal(multiple, "10") >= 0) {
    warnings.push({
      code: "implausible_count",
      severity: "review",
      message: "Unusual quantity compared with expected stock and the previous posted count.",
      evidence: { enteredQuantity, expectedQuantity, previousCount, multipleOfBaseline: multiple },
    });
  }

  if (
    canonicalUnit === "kilogram"
    && positive(baseline)
    && compareDecimal(baseline, "1") < 0
    && compareDecimal(absDecimal(enteredQuantity), "10") >= 0
  ) {
    warnings.push({
      code: "possible_grams_as_kilograms",
      severity: "review",
      message: `This item is normally below 1 kg. You entered ${enteredQuantity} kg. Did you mean ${sourceQuantity} g / ${divideDecimal(sourceQuantity, "1000", 6)} kg?`,
      evidence: { expectedQuantity, previousCount },
    });
  }

  return warnings;
}

export function detectQuantityAnomaly({
  quantity,
  historicalQuantities = [],
  minimumMultiple = "10",
}) {
  const positiveHistory = historicalQuantities.filter(positive);
  if (!positive(quantity) || !positiveHistory.length) return null;
  const sorted = [...positiveHistory].sort((left, right) => compareDecimal(left, right));
  const median = sorted[Math.floor(sorted.length / 2)];
  const multiple = divideDecimal(quantity, median, 6);
  if (compareDecimal(multiple, minimumMultiple) < 0) return null;
  return {
    code: "quantity_anomaly",
    severity: "review",
    message: `Quantity is ${multiple}× the recent median.`,
    evidence: { quantity, median, historicalQuantities },
  };
}

export function detectUnitCostAnomaly({
  unitCost,
  historicalUnitCosts = [],
  minimumChangePercent = "50",
}) {
  const positiveHistory = historicalUnitCosts.filter(positive);
  if (!positive(unitCost) || !positiveHistory.length) return null;
  const latest = positiveHistory[positiveHistory.length - 1];
  const changePercent = multiplyDecimal(
    divideDecimal(subtractDecimal(unitCost, latest), latest, 8),
    "100",
  );
  if (compareDecimal(absDecimal(changePercent), minimumChangePercent) < 0) return null;
  return {
    code: "unit_cost_anomaly",
    severity: "review",
    message: `Unit cost changed by ${changePercent}% from the latest comparable purchase.`,
    evidence: { unitCost, latestUnitCost: latest, changePercent },
  };
}

export function findPairedCorrection(candidate, nearbyLines = []) {
  const candidateTotal = candidate?.lineTotal;
  if (!positive(candidateTotal)) return null;
  const match = nearbyLines.find((line) =>
    line.id !== candidate.id
    && line.supplierId === candidate.supplierId
    && line.sourceReference === candidate.sourceReference
    && (
      line.sku === candidate.sku
      || line.inventoryItemId === candidate.inventoryItemId
    )
    && positive(line.lineTotal)
  );
  if (!match) return null;
  return {
    code: "possible_paired_correction",
    severity: "info",
    message: "A nearby line for the same item may reconstruct the intended quantity and value.",
    evidence: { candidateLineId: candidate.id, relatedLineId: match.id },
  };
}

export function calculateProductionYield({
  inputQuantity,
  expectedYieldPercent,
  actualOutputQuantity,
  recordedWasteQuantity = "0",
}) {
  const expectedOutputQuantity = multiplyDecimal(
    inputQuantity,
    divideDecimal(expectedYieldPercent, "100", 8),
  );
  const theoreticalYieldLoss = subtractDecimal(inputQuantity, expectedOutputQuantity);
  const outputVariance = subtractDecimal(actualOutputQuantity, expectedOutputQuantity);
  return {
    expectedOutputQuantity,
    actualOutputQuantity: String(actualOutputQuantity),
    theoreticalYieldLoss,
    recordedWaste: String(recordedWasteQuantity),
    outputVariance,
    labels: {
      theoreticalYieldLoss: "Calculated yield difference",
      recordedWaste: "Recorded actual waste",
    },
  };
}

export function explainRelatedItemVariance(items) {
  if (!Array.isArray(items) || items.length < 2) return null;
  const positiveItem = items.find(({ variance }) => compareDecimal(variance, "0") > 0);
  const negativeItem = items.find(({ variance }) => compareDecimal(variance, "0") < 0);
  if (!positiveItem || !negativeItem) return null;
  const combinedVariance = items.reduce(
    (total, item) => addDecimal(total, item.variance),
    "0",
  );
  return {
    likelyCause: "RELATED_SKU_MAPPING",
    confidence: "medium_high",
    message: "Related items carry opposing variances; check recipe, purchasing, or substitution mapping.",
    evidence: {
      positive: { id: positiveItem.id, variance: positiveItem.variance },
      negative: { id: negativeItem.id, variance: negativeItem.variance },
      combinedVariance,
    },
  };
}

export function assessCostCompleteness(lines, { staleAfterDays = 90, asOf = new Date() } = {}) {
  const issues = [];
  let trusted = 0;
  for (const line of lines || []) {
    if (line.mappingStatus === "unresolved") {
      issues.push({ ingredientId: line.ingredientId, status: "unresolved_cost" });
      continue;
    }
    if (line.unitCost == null) {
      issues.push({ ingredientId: line.ingredientId, status: "missing_cost" });
      continue;
    }
    if (compareDecimal(line.unitCost, "0") === 0 && !line.legitimateZeroCost) {
      issues.push({ ingredientId: line.ingredientId, status: "missing_cost" });
      continue;
    }
    if (line.costEffectiveAt) {
      const ageDays = (asOf.getTime() - new Date(line.costEffectiveAt).getTime()) / 86400000;
      if (ageDays > staleAfterDays) {
        issues.push({ ingredientId: line.ingredientId, status: "stale_cost", ageDays: Math.floor(ageDays) });
        continue;
      }
    }
    trusted += 1;
  }
  const total = lines?.length || 0;
  const confidencePercent = total ? Math.round((trusted / total) * 100) : 0;
  return {
    confidencePercent,
    reliable: total > 0 && confidencePercent >= 80,
    issues,
    marginStatus: total > 0 && confidencePercent >= 80 ? "available" : "unreliable",
  };
}
