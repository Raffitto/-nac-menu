/* global BigInt */

const UNIT_ALIASES = Object.freeze({
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
  bottle: "each",
  bottles: "each",
  carton: "each",
  cartons: "each",
  case: "each",
  cases: "each",
  box: "each",
  boxes: "each",
});

const UNIT_DIMENSIONS = Object.freeze({
  each: "count",
  gram: "mass",
  kilogram: "mass",
  millilitre: "volume",
  litre: "volume",
});

const BASE_FACTORS = Object.freeze({
  each: "1",
  gram: "1",
  kilogram: "1000",
  millilitre: "1",
  litre: "1000",
});

const POW10 = [1n];

function pow10(scale) {
  while (POW10.length <= scale) POW10.push(POW10[POW10.length - 1] * 10n);
  return POW10[scale];
}

export function parseDecimal(value) {
  const raw = String(value ?? "0").trim().replace(/,/g, "");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw)) {
    throw new Error(`Invalid decimal: ${value}`);
  }
  const negative = raw.startsWith("-");
  const unsigned = raw.replace(/^[+-]/, "");
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const scale = fraction.length;
  const coefficient = BigInt(`${whole || "0"}${fraction}` || "0") * (negative ? -1n : 1n);
  return { coefficient, scale };
}

function align(a, b) {
  const scale = Math.max(a.scale, b.scale);
  return {
    a: a.coefficient * pow10(scale - a.scale),
    b: b.coefficient * pow10(scale - b.scale),
    scale,
  };
}

export function decimalToString(decimal, trim = true) {
  const negative = decimal.coefficient < 0n;
  let digits = (negative ? -decimal.coefficient : decimal.coefficient).toString();
  const scale = decimal.scale;
  if (scale) digits = digits.padStart(scale + 1, "0");
  const whole = scale ? digits.slice(0, -scale) : digits;
  let fraction = scale ? digits.slice(-scale) : "";
  if (trim) fraction = fraction.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function addDecimal(left, right) {
  const values = align(parseDecimal(left), parseDecimal(right));
  return decimalToString({ coefficient: values.a + values.b, scale: values.scale });
}

export function subtractDecimal(left, right) {
  const values = align(parseDecimal(left), parseDecimal(right));
  return decimalToString({ coefficient: values.a - values.b, scale: values.scale });
}

export function multiplyDecimal(left, right) {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  return decimalToString({ coefficient: a.coefficient * b.coefficient, scale: a.scale + b.scale });
}

export function divideDecimal(left, right, scale = 12) {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  if (b.coefficient === 0n) throw new Error("Division by zero");
  const numerator = a.coefficient * pow10(scale + b.scale);
  const denominator = b.coefficient * pow10(a.scale);
  const quotient = numerator / denominator;
  return decimalToString({ coefficient: quotient, scale });
}

export function compareDecimal(left, right) {
  const values = align(parseDecimal(left), parseDecimal(right));
  return values.a === values.b ? 0 : values.a > values.b ? 1 : -1;
}

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeUnit(value) {
  const unit = UNIT_ALIASES[normalizeText(value)];
  if (!unit) throw new Error(`Unsupported unit: ${value}`);
  return unit;
}

export function areUnitsCompatible(left, right) {
  try {
    return UNIT_DIMENSIONS[normalizeUnit(left)] === UNIT_DIMENSIONS[normalizeUnit(right)];
  } catch {
    return false;
  }
}

export function convertToCanonicalQuantity({
  quantity,
  originalUnit,
  packQuantity = "1",
  packSize = "1",
  packUnit,
  canonicalUnit,
  verifiedConversionFactor,
}) {
  const target = normalizeUnit(canonicalUnit);
  if (verifiedConversionFactor != null) {
    return {
      canonicalQuantity: multiplyDecimal(quantity, verifiedConversionFactor),
      canonicalUnit: target,
      conversionFactor: String(verifiedConversionFactor),
      source: "verified_mapping",
    };
  }

  const source = normalizeUnit(packUnit || originalUnit);
  if (!areUnitsCompatible(source, target)) {
    throw new Error(`Incompatible units: ${source} cannot convert to ${target}`);
  }
  const sourceInBase = multiplyDecimal(multiplyDecimal(packQuantity, packSize), BASE_FACTORS[source]);
  const targetFactor = BASE_FACTORS[target];
  const conversionFactor = divideDecimal(sourceInBase, targetFactor);
  return {
    canonicalQuantity: multiplyDecimal(quantity, conversionFactor),
    canonicalUnit: target,
    conversionFactor,
    source: "explicit_pack",
  };
}

function tokenSet(value) {
  return new Set(normalizeText(value).split(" ").filter(Boolean));
}

export function tokenSimilarity(left, right) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

export function rankIngredientMatches(line, catalogueItems = [], ingredients = []) {
  const sku = normalizeText(line.supplierSku);
  const description = normalizeText(line.originalDescription || line.normalizedDescription);
  const candidates = [];

  for (const item of catalogueItems) {
    let confidence = 0;
    let method = "supplier_catalogue_similarity";
    const signals = [];
    if (sku && normalizeText(item.supplierSku) === sku) {
      confidence = item.verificationState === "verified" ? 1 : 0.96;
      method = "exact_supplier_sku";
      signals.push("supplier_sku");
    } else if (
      item.verificationState === "verified" &&
      [item.originalProductName, item.normalizedProductName, ...(item.aliases || [])]
        .map(normalizeText)
        .includes(description)
    ) {
      confidence = 0.99;
      method = "exact_verified_alias";
      signals.push("verified_alias");
    } else {
      confidence = Math.max(
        tokenSimilarity(description, item.normalizedProductName),
        ...(item.aliases || []).map((alias) => tokenSimilarity(description, alias))
      ) * 0.9;
      if (confidence > 0) signals.push("token_similarity");
    }
    if (item.purchaseUnit && line.unit && areUnitsCompatible(item.purchaseUnit, line.unit)) {
      confidence = Math.min(1, confidence + 0.03);
      signals.push("unit_compatibility");
    }
    if (confidence > 0) {
      candidates.push({
        ingredientId: item.ingredientId,
        supplierCatalogueItemId: item.id,
        confidence: Number(confidence.toFixed(4)),
        method,
        signals,
      });
    }
  }

  for (const ingredient of ingredients) {
    if (candidates.some((candidate) => candidate.ingredientId === ingredient.id && candidate.confidence >= 0.95)) {
      continue;
    }
    const confidence = tokenSimilarity(description, ingredient.canonicalName) * 0.75;
    if (confidence > 0) {
      candidates.push({
        ingredientId: ingredient.id,
        supplierCatalogueItemId: null,
        confidence: Number(confidence.toFixed(4)),
        method: "canonical_ingredient_similarity",
        signals: ["canonical_name", "token_similarity"],
      });
    }
  }

  return candidates
    .sort((a, b) => b.confidence - a.confidence)
    .filter((candidate, index, all) =>
      all.findIndex((other) =>
        other.ingredientId === candidate.ingredientId &&
        other.supplierCatalogueItemId === candidate.supplierCatalogueItemId
      ) === index
    )
    .slice(0, 5)
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      requiresHumanReview: candidate.confidence < 0.95,
    }));
}

export function resolveLineMatch(line, catalogueItems, ingredients) {
  const candidates = rankIngredientMatches(line, catalogueItems, ingredients);
  const selected = candidates[0] || null;
  return {
    selected,
    alternatives: candidates.slice(1),
    requiresHumanReview: !selected || selected.requiresHumanReview,
    explanation: selected ? selected.signals.join(", ") : "No deterministic candidate",
  };
}

export function validateInvoiceExtraction(invoice, options = {}) {
  const tolerance = options.tolerance || "0.05";
  const supportedCurrencies = options.supportedCurrencies || ["SAR"];
  const exceptions = [];
  const push = (code, severity, message, lineIndex = null) =>
    exceptions.push({ code, severity, message, lineIndex });

  if (!invoice.invoiceDate || Number.isNaN(Date.parse(invoice.invoiceDate))) {
    push("invalid_or_missing_invoice_date", "blocking", "Invoice date is missing or invalid");
  }
  if (!supportedCurrencies.includes(String(invoice.currency || "").toUpperCase())) {
    push("unsupported_currency", "blocking", `Unsupported currency: ${invoice.currency || "missing"}`);
  }
  if (!invoice.supplierName) push("supplier_ambiguity", "blocking", "Supplier is missing");
  if (invoice.ocrConfidence != null && Number(invoice.ocrConfidence) < (options.ocrThreshold || 0.85)) {
    push("low_ocr_confidence", "review", "OCR confidence is below threshold");
  }

  (invoice.lines || []).forEach((line, index) => {
    if (compareDecimal(line.quantity || "0", "0") < 0) {
      push("negative_quantity", "blocking", "Quantity cannot be negative", index);
    }
    if (compareDecimal(line.lineTotal || "0", "0") === 0) {
      push("zero_value_line", "review", "Line total is zero", index);
    }
    if (!line.unit) push("unit_ambiguity", "blocking", "Unit is missing", index);
    if (line.requiresPackSize && !line.packSize) {
      push("pack_size_ambiguity", "blocking", "Pack size is required", index);
    }
    if (line.quantity != null && line.unitPrice != null && line.lineTotal != null) {
      const expected = subtractDecimal(
        addDecimal(multiplyDecimal(line.quantity, line.unitPrice), line.tax || "0"),
        line.discount || "0"
      );
      if (compareDecimal(absDecimal(subtractDecimal(expected, line.lineTotal)), tolerance) > 0) {
        push("line_total_mismatch", "review", "Quantity × price does not match line total", index);
      }
    }
    if (line.taxRate != null && (compareDecimal(line.taxRate, "0") < 0 || compareDecimal(line.taxRate, "100") > 0)) {
      push("abnormal_tax", "review", "Tax rate is outside 0–100%", index);
    }
  });

  if (invoice.subtotal != null && invoice.total != null) {
    const expected = subtractDecimal(
      addDecimal(invoice.subtotal, invoice.tax || "0"),
      invoice.discount || "0"
    );
    if (compareDecimal(absDecimal(subtractDecimal(expected, invoice.total)), tolerance) > 0) {
      push("invoice_total_mismatch", "review", "Subtotal + tax − discount does not match total");
    }
  }
  return exceptions;
}

export function absDecimal(value) {
  const parsed = parseDecimal(value);
  return decimalToString({ ...parsed, coefficient: parsed.coefficient < 0n ? -parsed.coefficient : parsed.coefficient });
}

export function calculateWeightedAverage({
  existingQuantity,
  existingAverageCost,
  receivedQuantity,
  receivedUnitCost,
}) {
  if (compareDecimal(receivedQuantity, "0") <= 0) throw new Error("Received quantity must be positive");
  if (compareDecimal(existingQuantity, "0") <= 0) {
    return {
      averageCost: String(receivedUnitCost),
      resultingQuantity: addDecimal(existingQuantity, receivedQuantity),
      pathologicalExistingStock: compareDecimal(existingQuantity, "0") < 0,
      method: "receipt_cost_reset_non_positive_stock",
    };
  }
  const resultingQuantity = addDecimal(existingQuantity, receivedQuantity);
  const existingValue = multiplyDecimal(existingQuantity, existingAverageCost);
  const receivedValue = multiplyDecimal(receivedQuantity, receivedUnitCost);
  return {
    averageCost: divideDecimal(addDecimal(existingValue, receivedValue), resultingQuantity),
    resultingQuantity,
    pathologicalExistingStock: false,
    method: "weighted_average",
  };
}

export function calculatePriceVariance(previousCost, currentCost, thresholdPercent = "5") {
  if (previousCost == null || compareDecimal(previousCost, "0") === 0) {
    return { previousCost: previousCost ?? null, currentCost, percentageChange: null, exceedsThreshold: false };
  }
  const percentageChange = multiplyDecimal(divideDecimal(subtractDecimal(currentCost, previousCost), previousCost), "100");
  return {
    previousCost,
    currentCost,
    percentageChange,
    direction: compareDecimal(percentageChange, "0") >= 0 ? "increase" : "decrease",
    exceedsThreshold: compareDecimal(absDecimal(percentageChange), thresholdPercent) >= 0,
  };
}

export function calculateRecipeCost(lines) {
  return lines.reduce(
    (total, line) => addDecimal(total, multiplyDecimal(line.canonicalQuantity, line.canonicalUnitCost)),
    "0"
  );
}

export function calculateMenuMargin({ sellingPrice, recipeCost, taxRate = "0", sellingPriceIncludesTax = true }) {
  const taxExclusivePrice = sellingPriceIncludesTax
    ? divideDecimal(sellingPrice, addDecimal("1", divideDecimal(taxRate, "100")))
    : String(sellingPrice);
  const grossProfit = subtractDecimal(taxExclusivePrice, recipeCost);
  return {
    sellingPrice: String(sellingPrice),
    taxExclusivePrice,
    recipeCost: String(recipeCost),
    grossProfit,
    grossMarginPercent: compareDecimal(taxExclusivePrice, "0") === 0
      ? null
      : multiplyDecimal(divideDecimal(grossProfit, taxExclusivePrice), "100"),
    foodCostPercent: compareDecimal(taxExclusivePrice, "0") === 0
      ? null
      : multiplyDecimal(divideDecimal(recipeCost, taxExclusivePrice), "100"),
  };
}

export function buildInvoiceLineFingerprint(lines) {
  return (lines || [])
    .map((line) => [
      normalizeText(line.supplierSku),
      normalizeText(line.originalDescription),
      decimalToString(parseDecimal(line.quantity || "0")),
      normalizeText(line.unit),
      decimalToString(parseDecimal(line.lineTotal || "0")),
    ].join("|"))
    .sort()
    .join("::");
}

export function determineReviewStatus({ exceptions = [], lineMatches = [] }) {
  const blocking = exceptions.some((exception) => exception.severity === "blocking");
  const needsReview = blocking ||
    exceptions.some((exception) => exception.severity === "review") ||
    lineMatches.some((match) => match.requiresHumanReview);
  return needsReview ? "needs_review" : "extracted";
}

export const INVENTORY_MOVEMENT_TYPES = Object.freeze([
  "opening_balance",
  "purchase_receipt",
  "transfer_in",
  "transfer_out",
  "production_in",
  "production_out",
  "sale_consumption",
  "wastage",
  "staff_meal",
  "complimentary",
  "physical_count_adjustment",
  "manual_adjustment",
  "correction",
  "return_to_supplier",
]);
