import {
  assessCostCompleteness,
  calculateProductionYield,
  detectQuantityAnomaly,
  detectUnitCostAnomaly,
  evaluateCountGuardrails,
  explainRelatedItemVariance,
  findPairedCorrection,
} from "./inventoryControls";

describe("stock count guardrails", () => {
  test("flags the spinach grams-as-kilograms scenario", () => {
    const warnings = evaluateCountGuardrails({
      enteredQuantity: "100",
      sourceQuantity: "100",
      sourceUnit: "kilogram",
      canonicalUnit: "kilogram",
      conversionFactor: "1",
      expectedQuantity: "0.42",
      previousCount: "0.35",
    });
    expect(warnings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "implausible_count",
      "possible_grams_as_kilograms",
    ]));
    expect(warnings.find(({ code }) => code === "possible_grams_as_kilograms").message)
      .toContain("0.1 kg");
  });

  test("requires explicit box-to-pack conversion for baking paper", () => {
    expect(evaluateCountGuardrails({
      enteredQuantity: "1",
      sourceUnit: "box",
      canonicalUnit: "each",
      conversionFactor: "1",
      expectedQuantity: "2",
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "pack_conversion_anomaly" }),
    ]));
  });

  test("does not warn for an explicit legitimate pack conversion", () => {
    expect(evaluateCountGuardrails({
      enteredQuantity: "10",
      sourceUnit: "box",
      canonicalUnit: "each",
      conversionFactor: "10",
      expectedQuantity: "9",
      previousCount: "8",
    })).toEqual([]);
  });
});

describe("deterministic purchase anomalies", () => {
  test("flags the baby spinach quantity outlier", () => {
    expect(detectQuantityAnomaly({
      quantity: "250",
      historicalQuantities: ["0.15", "0.20", "0.30"],
    })).toMatchObject({ code: "quantity_anomaly", severity: "review" });
  });

  test("flags the thyme unit-cost collapse", () => {
    expect(detectUnitCostAnomaly({
      unitCost: "9",
      historicalUnitCosts: ["88", "91", "90"],
    })).toMatchObject({ code: "unit_cost_anomaly", severity: "review" });
  });

  test("finds nearby same-reference lines before escalating a correction pair", () => {
    const line = {
      id: "floor-cleaner-a",
      supplierId: "supplier-1",
      sourceReference: "invoice-20",
      sku: "FLOOR",
      inventoryItemId: "cleaner",
      lineTotal: "68.75",
    };
    expect(findPairedCorrection(line, [
      line,
      {
        id: "floor-cleaner-b",
        supplierId: "supplier-1",
        sourceReference: "invoice-20",
        sku: "FLOOR",
        inventoryItemId: "cleaner",
        lineTotal: "206.25",
      },
    ])).toMatchObject({ code: "possible_paired_correction", severity: "info" });
  });
});

describe("production and variance explanation", () => {
  test("keeps theoretical yield loss separate from recorded waste", () => {
    expect(calculateProductionYield({
      inputQuantity: "100",
      expectedYieldPercent: "80",
      actualOutputQuantity: "75",
      recordedWasteQuantity: "3",
    })).toMatchObject({
      expectedOutputQuantity: "80",
      theoreticalYieldLoss: "20",
      recordedWaste: "3",
      outputVariance: "-5",
      labels: {
        theoreticalYieldLoss: "Calculated yield difference",
        recordedWaste: "Recorded actual waste",
      },
    });
  });

  test("explains opposing shrimp SKU variances without merging history", () => {
    expect(explainRelatedItemVariance([
      { id: "shrimp-fresh", variance: "27.6" },
      { id: "shrimp-10-20", variance: "-19.7" },
    ])).toMatchObject({
      likelyCause: "RELATED_SKU_MAPPING",
      confidence: "medium_high",
      evidence: { combinedVariance: "7.9" },
    });
  });
});

describe("cost trust", () => {
  test("distinguishes legitimate zero cost from missing and unresolved cost", () => {
    const result = assessCostCompleteness([
      { ingredientId: "water", unitCost: "0", legitimateZeroCost: true },
      { ingredientId: "chicken", unitCost: null },
      { ingredientId: "sauce", mappingStatus: "unresolved" },
    ]);
    expect(result.confidencePercent).toBe(33);
    expect(result.reliable).toBe(false);
    expect(result.marginStatus).toBe("unreliable");
    expect(result.issues).toEqual(expect.arrayContaining([
      { ingredientId: "chicken", status: "missing_cost" },
      { ingredientId: "sauce", status: "unresolved_cost" },
    ]));
  });

  test("marks stale cost separately", () => {
    expect(assessCostCompleteness([
      { ingredientId: "coffee", unitCost: "90", costEffectiveAt: "2026-01-01T00:00:00Z" },
    ], { asOf: new Date("2026-08-01T00:00:00Z"), staleAfterDays: 90 }).issues[0])
      .toMatchObject({ status: "stale_cost" });
  });
});
