import {
  areUnitsCompatible,
  convertToCanonicalQuantity,
  normalizeMeasurementUnit,
} from "../inventoryIntelligence";
import { CONVERSION_STATUS } from "./contracts";

/**
 * Recipe units use the single shared measurement alias table in
 * inventoryIntelligence (MEASUREMENT_UNIT_ALIASES). Packaging units are refused.
 * Do not add a second alias table here.
 */
export function normalizeRecipeUnit(value) {
  return normalizeMeasurementUnit(value);
}

export function resolveRecipeLineUom({
  quantity,
  unit,
  baseUom,
  verifiedConversionFactor = null,
} = {}) {
  const quantityOriginal = quantity == null || quantity === "" ? null : String(quantity);
  const uomOriginal = unit == null || String(unit).trim() === "" ? null : String(unit);
  const target = normalizeRecipeUnit(baseUom);
  const source = normalizeRecipeUnit(uomOriginal);

  if (quantityOriginal == null) {
    return {
      quantityOriginal,
      uomOriginal,
      quantityBase: null,
      baseUom: target,
      conversionSource: null,
      conversionStatus: CONVERSION_STATUS.UNKNOWN,
    };
  }

  if (verifiedConversionFactor != null && target) {
    try {
      const converted = convertToCanonicalQuantity({
        quantity: quantityOriginal,
        originalUnit: source || uomOriginal,
        canonicalUnit: target,
        verifiedConversionFactor,
      });
      return {
        quantityOriginal,
        uomOriginal,
        quantityBase: converted.canonicalQuantity,
        baseUom: target,
        conversionSource: "verified_mapping",
        conversionStatus: CONVERSION_STATUS.CONVERTED,
      };
    } catch {
      return {
        quantityOriginal,
        uomOriginal,
        quantityBase: null,
        baseUom: target,
        conversionSource: "verified_mapping",
        conversionStatus: CONVERSION_STATUS.INCOMPATIBLE,
      };
    }
  }

  if (!source && uomOriginal) {
    return {
      quantityOriginal,
      uomOriginal,
      quantityBase: null,
      baseUom: target,
      conversionSource: null,
      conversionStatus: CONVERSION_STATUS.UNKNOWN,
    };
  }

  if (!source || !target) {
    return {
      quantityOriginal,
      uomOriginal,
      quantityBase: null,
      baseUom: target,
      conversionSource: null,
      conversionStatus: CONVERSION_STATUS.MISSING_CONVERSION,
    };
  }

  if (source === target) {
    return {
      quantityOriginal,
      uomOriginal,
      quantityBase: quantityOriginal,
      baseUom: target,
      conversionSource: "exact",
      conversionStatus: CONVERSION_STATUS.EXACT,
    };
  }

  if (!areUnitsCompatible(source, target)) {
    return {
      quantityOriginal,
      uomOriginal,
      quantityBase: null,
      baseUom: target,
      conversionSource: null,
      conversionStatus: CONVERSION_STATUS.INCOMPATIBLE,
    };
  }

  try {
    const converted = convertToCanonicalQuantity({
      quantity: quantityOriginal,
      originalUnit: source,
      canonicalUnit: target,
    });
    return {
      quantityOriginal,
      uomOriginal,
      quantityBase: converted.canonicalQuantity,
      baseUom: target,
      conversionSource: converted.source,
      conversionStatus: CONVERSION_STATUS.CONVERTED,
    };
  } catch {
    return {
      quantityOriginal,
      uomOriginal,
      quantityBase: null,
      baseUom: target,
      conversionSource: null,
      conversionStatus: CONVERSION_STATUS.MISSING_CONVERSION,
    };
  }
}

export function summarizeUomCoverage(resolvedLines = []) {
  const counts = {
    EXACT: 0,
    CONVERTED: 0,
    MISSING_CONVERSION: 0,
    INCOMPATIBLE: 0,
    UNKNOWN: 0,
  };
  for (const line of resolvedLines || []) {
    if (counts[line.conversionStatus] != null) counts[line.conversionStatus] += 1;
  }
  const convertible = counts.EXACT + counts.CONVERTED;
  const blocked = counts.MISSING_CONVERSION + counts.INCOMPATIBLE + counts.UNKNOWN;
  const total = convertible + blocked;
  return {
    ...counts,
    total,
    convertible,
    blocked,
    requiringHumanConfiguration: blocked,
    coveragePct: total ? convertible / total : null,
  };
}
