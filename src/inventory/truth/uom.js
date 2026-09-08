import {
  areUnitsCompatible,
  convertToCanonicalQuantity,
  normalizeText,
} from "../inventoryIntelligence";
import { CONVERSION_STATUS } from "./contracts";

const RECIPE_UNIT_ALIASES = Object.freeze({
  each: "each",
  ea: "each",
  item: "each",
  piece: "each",
  pieces: "each",
  pc: "each",
  pcs: "each",
  gram: "gram",
  grams: "gram",
  g: "gram",
  gm: "gram",
  kilogram: "kilogram",
  kilograms: "kilogram",
  kg: "kilogram",
  millilitre: "millilitre",
  milliliter: "millilitre",
  millilitres: "millilitre",
  milliliters: "millilitre",
  ml: "millilitre",
  litre: "litre",
  liter: "litre",
  litres: "litre",
  liters: "litre",
  l: "litre",
});

export function normalizeRecipeUnit(value) {
  if (value == null || String(value).trim() === "") return null;
  return RECIPE_UNIT_ALIASES[normalizeText(value)] || null;
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
