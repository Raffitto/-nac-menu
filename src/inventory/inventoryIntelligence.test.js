import {
  addDecimal,
  buildInvoiceLineFingerprint,
  calculateMenuMargin,
  calculatePriceVariance,
  calculateRecipeCost,
  calculateWeightedAverage,
  compareDecimal,
  convertToCanonicalQuantity,
  determineReviewStatus,
  divideDecimal,
  multiplyDecimal,
  normalizeText,
  normalizeUnit,
  rankIngredientMatches,
  resolveLineMatch,
  validateInvoiceExtraction,
} from "./inventoryIntelligence";

const ingredients = [
  { id: "cream", canonicalName: "Whipping Cream" },
  { id: "chicken", canonicalName: "Chicken Breast" },
];

const catalogue = [
  {
    id: "cat-cream",
    ingredientId: "cream",
    supplierSku: "ARLA-1L",
    originalProductName: "WHIPPING CREAM 1LTR",
    normalizedProductName: "whipping cream 1ltr",
    aliases: ["WHIP CREAM ARLA 12X1L", "ARLA UHT CREAM"],
    purchaseUnit: "litre",
    verificationState: "verified",
  },
  {
    id: "cat-chicken",
    ingredientId: "chicken",
    supplierSku: "CHK-10",
    originalProductName: "CHICKEN BREAST FRESH",
    normalizedProductName: "chicken breast fresh",
    aliases: ["CHKN BRT 10KG", "صدر دجاج طازج"],
    purchaseUnit: "kilogram",
    verificationState: "verified",
  },
];

describe("exact decimal inventory arithmetic", () => {
  test("adds and multiplies decimal strings without binary float drift", () => {
    expect(addDecimal("0.1", "0.2")).toBe("0.3");
    expect(multiplyDecimal("12", "26.50")).toBe("318");
  });

  test("divides to deterministic decimal precision", () => {
    expect(divideDecimal("20", "8", 4)).toBe("2.5");
  });

  test("compares equivalent decimal representations", () => {
    expect(compareDecimal("12.000", "12")).toBe(0);
  });
});

describe("supplier and ingredient normalization", () => {
  test("normalizes punctuation and whitespace", () => {
    expect(normalizeText("  WHIP-CREAM, ARLA  12X1L ")).toBe("whip cream arla 12x1l");
  });

  test("normalizes Arabic spelling variants and diacritics", () => {
    expect(normalizeText("صَدْر دَجَاج طَازَج")).toBe("صدر دجاج طازج");
    expect(normalizeText("إختبار")).toBe("اختبار");
  });

  test("matches exact supplier SKU first", () => {
    const matches = rankIngredientMatches(
      { supplierSku: "ARLA-1L", originalDescription: "anything", unit: "litre" },
      catalogue,
      ingredients
    );
    expect(matches[0]).toMatchObject({
      ingredientId: "cream",
      method: "exact_supplier_sku",
      confidence: 1,
      requiresHumanReview: false,
    });
  });

  test("matches a verified alias exactly", () => {
    const result = resolveLineMatch(
      { originalDescription: "ARLA UHT CREAM", unit: "litre" },
      catalogue,
      ingredients
    );
    expect(result.selected).toMatchObject({
      ingredientId: "cream",
      method: "exact_verified_alias",
      requiresHumanReview: false,
    });
  });

  test("matches multilingual verified aliases", () => {
    const result = resolveLineMatch(
      { originalDescription: "صدر دجاج طازج", unit: "kg" },
      catalogue,
      ingredients
    );
    expect(result.selected.ingredientId).toBe("chicken");
    expect(result.requiresHumanReview).toBe(false);
  });

  test("generates fuzzy candidates but requires review", () => {
    const result = resolveLineMatch(
      { originalDescription: "fresh chicken breast boneless", unit: "kg" },
      catalogue,
      ingredients
    );
    expect(result.selected.ingredientId).toBe("chicken");
    expect(result.selected.confidence).toBeGreaterThan(0);
    expect(result.requiresHumanReview).toBe(true);
    expect(result.alternatives).toEqual(expect.any(Array));
  });

  test("unknown ingredient remains unmatched", () => {
    const result = resolveLineMatch(
      { originalDescription: "rare purple ingredient", unit: "each" },
      catalogue,
      ingredients
    );
    expect(result.selected).toBeNull();
    expect(result.requiresHumanReview).toBe(true);
  });
});

describe("unit and pack conversion", () => {
  test.each([
    ["L", "litre"],
    ["ltr", null],
    ["KG", "kilogram"],
    ["ml", "millilitre"],
    ["pcs", "each"],
  ])("normalizes supported unit %s", (input, expected) => {
    if (expected) expect(normalizeUnit(input)).toBe(expected);
    else expect(() => normalizeUnit(input)).toThrow("Unsupported unit");
  });

  test("converts 12 cartons × 1 litre to 12 litres", () => {
    expect(convertToCanonicalQuantity({
      quantity: "12",
      originalUnit: "cartons",
      packQuantity: "1",
      packSize: "1",
      packUnit: "litre",
      canonicalUnit: "litre",
    })).toMatchObject({ canonicalQuantity: "12", canonicalUnit: "litre" });
  });

  test("converts 2 cases × 10 kilograms to 20 kilograms", () => {
    expect(convertToCanonicalQuantity({
      quantity: "2",
      originalUnit: "case",
      packQuantity: "1",
      packSize: "10",
      packUnit: "kg",
      canonicalUnit: "kilogram",
    }).canonicalQuantity).toBe("20");
  });

  test("converts 24 bottles × 330ml to 7,920ml", () => {
    expect(convertToCanonicalQuantity({
      quantity: "24",
      originalUnit: "bottles",
      packQuantity: "1",
      packSize: "330",
      packUnit: "ml",
      canonicalUnit: "millilitre",
    }).canonicalQuantity).toBe("7920");
  });

  test("uses an audited verified conversion factor when supplied", () => {
    expect(convertToCanonicalQuantity({
      quantity: "3",
      originalUnit: "case",
      canonicalUnit: "gram",
      verifiedConversionFactor: "2500",
    })).toMatchObject({
      canonicalQuantity: "7500",
      conversionFactor: "2500",
      source: "verified_mapping",
    });
  });

  test("rejects dimensionally incompatible conversion", () => {
    expect(() => convertToCanonicalQuantity({
      quantity: "1",
      originalUnit: "kg",
      canonicalUnit: "litre",
    })).toThrow("Incompatible units");
  });
});

describe("OCR extraction validation and review gating", () => {
  const validInvoice = {
    supplierName: "Supplier",
    invoiceDate: "2026-07-14",
    currency: "SAR",
    subtotal: "100",
    tax: "15",
    discount: "5",
    total: "110",
    ocrConfidence: 0.98,
    lines: [{
      originalDescription: "Cream",
      quantity: "10",
      unit: "litre",
      unitPrice: "10",
      tax: "15",
      discount: "5",
      lineTotal: "110",
    }],
  };

  test("accepts arithmetically valid invoice headers and lines", () => {
    expect(validateInvoiceExtraction(validInvoice)).toEqual([]);
  });

  test("detects invoice and line arithmetic mismatches", () => {
    const exceptions = validateInvoiceExtraction({
      ...validInvoice,
      total: "999",
      lines: [{ ...validInvoice.lines[0], lineTotal: "999" }],
    });
    expect(exceptions.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "invoice_total_mismatch",
      "line_total_mismatch",
    ]));
  });

  test("detects OCR failure-quality fields", () => {
    const exceptions = validateInvoiceExtraction({
      invoiceDate: "not-a-date",
      currency: "USD",
      ocrConfidence: 0.2,
      lines: [],
    });
    expect(exceptions.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "invalid_or_missing_invoice_date",
      "unsupported_currency",
      "supplier_ambiguity",
      "low_ocr_confidence",
    ]));
  });

  test("detects negative quantity, zero line and ambiguous pack", () => {
    const exceptions = validateInvoiceExtraction({
      ...validInvoice,
      lines: [{
        quantity: "-1",
        lineTotal: "0",
        unit: null,
        requiresPackSize: true,
        packSize: null,
      }],
    });
    expect(exceptions.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "negative_quantity",
      "zero_value_line",
      "unit_ambiguity",
      "pack_size_ambiguity",
    ]));
  });

  test("detects abnormal tax", () => {
    const exceptions = validateInvoiceExtraction({
      ...validInvoice,
      lines: [{ ...validInvoice.lines[0], taxRate: "120" }],
    });
    expect(exceptions.some(({ code }) => code === "abnormal_tax")).toBe(true);
  });

  test("low-confidence line forces needs-review status", () => {
    expect(determineReviewStatus({
      exceptions: [],
      lineMatches: [{ requiresHumanReview: true }],
    })).toBe("needs_review");
  });

  test("only clean high-confidence extraction may skip review queue", () => {
    expect(determineReviewStatus({
      exceptions: [],
      lineMatches: [{ requiresHumanReview: false }],
    })).toBe("extracted");
  });
});

describe("costing and variance", () => {
  test("updates weighted average by branch and ingredient", () => {
    const result = calculateWeightedAverage({
      existingQuantity: "10",
      existingAverageCost: "20",
      receivedQuantity: "10",
      receivedUnitCost: "30",
    });
    expect(result.averageCost).toBe("25");
    expect(result.resultingQuantity).toBe("20");
    expect(result.method).toBe("weighted_average");
  });

  test("handles zero and negative existing stock explicitly", () => {
    expect(calculateWeightedAverage({
      existingQuantity: "-2",
      existingAverageCost: "99",
      receivedQuantity: "12",
      receivedUnitCost: "26.5",
    })).toMatchObject({
      averageCost: "26.5",
      resultingQuantity: "10",
      pathologicalExistingStock: true,
      method: "receipt_cost_reset_non_positive_stock",
    });
  });

  test("detects price increase over threshold exactly", () => {
    expect(calculatePriceVariance("24", "26.5", "10")).toMatchObject({
      percentageChange: "10.4166666666",
      direction: "increase",
      exceedsThreshold: true,
    });
  });

  test("detects a supplier price decrease", () => {
    expect(calculatePriceVariance("29", "26.5", "5")).toMatchObject({
      direction: "decrease",
      exceedsThreshold: true,
    });
  });

  test("calculates recipe and sub-recipe ingredient costs", () => {
    expect(calculateRecipeCost([
      { canonicalQuantity: "0.5", canonicalUnitCost: "26.5" },
      { canonicalQuantity: "2", canonicalUnitCost: "3.25" },
    ])).toBe("19.75");
  });

  test("calculates menu margin without changing selling price", () => {
    const result = calculateMenuMargin({
      sellingPrice: "115",
      recipeCost: "25",
      taxRate: "15",
      sellingPriceIncludesTax: true,
    });
    expect(result.sellingPrice).toBe("115");
    expect(result.taxExclusivePrice).toBe("100");
    expect(result.grossProfit).toBe("75");
    expect(result.grossMarginPercent).toBe("75");
    expect(result.foodCostPercent).toBe("25");
  });
});

describe("duplicate protection primitives", () => {
  test("line fingerprint is stable across line order and formatting", () => {
    const a = [
      { supplierSku: "A", originalDescription: "Cream 1L", quantity: "1.0", unit: "L", lineTotal: "20.00" },
      { supplierSku: "B", originalDescription: "Chicken", quantity: "2", unit: "kg", lineTotal: "50" },
    ];
    const b = [
      { supplierSku: "B", originalDescription: "Chicken", quantity: "2.0", unit: "KG", lineTotal: "50.0" },
      { supplierSku: "a", originalDescription: "cream-1l", quantity: "1", unit: "l", lineTotal: "20" },
    ];
    expect(buildInvoiceLineFingerprint(a)).toBe(buildInvoiceLineFingerprint(b));
  });
});
