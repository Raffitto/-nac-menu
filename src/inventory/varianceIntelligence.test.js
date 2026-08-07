import {
  VARIANCE_CAUSES,
  VARIANCE_CONFIDENCE,
  VARIANCE_SEVERITY,
  buildVarianceAnalysis,
  calculateExpectedClosing,
  calculateTrustedVarianceValue,
  calculateVarianceQuantity,
  classifyVarianceExplanation,
  classifyVarianceSeverity,
  explainRelatedSkuVariance,
  summarizeVarianceCommandCenter,
} from "./varianceIntelligence";

function facts(overrides = {}) {
  return {
    itemName: "Chicken Breast",
    openingQuantity: "100",
    expectedClosing: "20",
    physicalClosing: "15",
    varianceQuantity: "-5",
    varianceValue: "-135",
    historicalUnitCost: "27",
    costStatus: "VALID_COST",
    recipeCoveragePct: 100,
    theoreticalRecipeConsumption: "40",
    actual: {
      purchases: "20",
      returnsToSupplier: "0",
      transfersIn: "0",
      transfersOut: "0",
      staffMeal: "0",
      operationalDisposal: "0",
      recordedWaste: "0",
      productionInput: "0",
      productionOutput: "0",
      actualOrderConsumption: "100",
      adjustmentsNet: "0",
    },
    countQuality: { warnings: [], hasUncountedLocation: false, hasUnresolvedUnit: false },
    openExceptions: [],
    priceAlerts: [],
    relatedItems: [],
    evidence: { movements: [{ movementId: "movement-1" }] },
    review: { status: "OPEN" },
    ...overrides,
  };
}

describe("inventory variance intelligence", () => {
  test("calculates expected closing from signed operational categories", () => {
    expect(calculateExpectedClosing({
      openingQuantity: "100",
      purchases: "40",
      transfersIn: "5",
      productionOutput: "10",
      adjustmentsNet: "-2",
      returnsToSupplier: "3",
      transfersOut: "4",
      staffMeal: "6",
      operationalDisposal: "8",
      recordedWaste: "2",
      productionInput: "12",
      actualOrderConsumption: "7",
      complimentary: "1",
    })).toBe("110");
    expect(calculateVarianceQuantity({ physicalClosing: "95", expectedClosing: "110" })).toBe("-15");
  });

  test("values variance only with trusted historical cost", () => {
    expect(calculateTrustedVarianceValue({
      varianceQuantity: "-10",
      historicalUnitCost: "27",
      costStatus: "VALID_COST",
    })).toBe("-270");
    expect(calculateTrustedVarianceValue({
      varianceQuantity: "-10",
      historicalUnitCost: "0",
      costStatus: "NO_HISTORICAL_COST",
    })).toBeNull();
    expect(calculateTrustedVarianceValue({
      varianceQuantity: "-10",
      historicalUnitCost: "0",
      costStatus: "LEGITIMATE_ZERO_COST",
    })).toBe("0");
  });

  test("recognizes accounted operational disposal", () => {
    expect(classifyVarianceExplanation(facts({
      varianceQuantity: "-0.5",
      actual: { ...facts().actual, operationalDisposal: "10" },
    }))).toMatchObject({
      primaryCause: VARIANCE_CAUSES.EXPECTED_OPERATIONAL_DISPOSAL,
      confidence: VARIANCE_CONFIDENCE.HIGH,
    });
  });

  test("recognizes accounted staff meals", () => {
    expect(classifyVarianceExplanation(facts({
      varianceQuantity: "-1",
      actual: { ...facts().actual, staffMeal: "12" },
    }))).toMatchObject({
      primaryCause: VARIANCE_CAUSES.STAFF_MEAL_ACCOUNTED,
      confidence: VARIANCE_CONFIDENCE.HIGH,
    });
  });

  test("separates production yield configuration from physical gain", () => {
    expect(classifyVarianceExplanation(facts({
      expectedClosing: "-35.11",
      physicalClosing: "55.32",
      varianceQuantity: "90.43",
      actual: { ...facts().actual, productionInput: "188.93", recordedWaste: "78.13" },
    }))).toMatchObject({
      primaryCause: VARIANCE_CAUSES.PRODUCTION_YIELD_CONFIG,
      contributingCauses: expect.arrayContaining([VARIANCE_CAUSES.NEGATIVE_THEORETICAL_STOCK]),
      confidence: VARIANCE_CONFIDENCE.MEDIUM,
    });
  });

  test("finds opposing related SKU variance without netting source records", () => {
    const related = explainRelatedSkuVariance([
      { inventoryItemId: "shrimp-a", varianceQuantity: "27.58" },
      { inventoryItemId: "shrimp-b", varianceQuantity: "-19.70" },
    ]);
    expect(related).toMatchObject({
      cause: VARIANCE_CAUSES.RELATED_SKU_MAPPING,
      combinedVariance: "7.88",
    });
    expect(classifyVarianceExplanation(facts({
      relatedItems: [
        { inventoryItemId: "shrimp-a", varianceQuantity: "27.58" },
        { inventoryItemId: "shrimp-b", varianceQuantity: "-19.70" },
      ],
    }))).toMatchObject({
      primaryCause: VARIANCE_CAUSES.RELATED_SKU_MAPPING,
      confidence: VARIANCE_CONFIDENCE.MEDIUM,
    });
  });

  test("uses count evidence for count and conversion causes", () => {
    expect(classifyVarianceExplanation(facts({
      countQuality: { warnings: [{ code: "implausible_count" }] },
    })).primaryCause).toBe(VARIANCE_CAUSES.COUNT_ENTRY_ERROR);
    expect(classifyVarianceExplanation(facts({
      countQuality: { warnings: [{ code: "possible_grams_as_kilograms" }] },
    })).primaryCause).toBe(VARIANCE_CAUSES.UNIT_CONVERSION_ERROR);
  });

  test("classifies purchase quantity, cost, and transfer exceptions", () => {
    expect(classifyVarianceExplanation(facts({
      openExceptions: [{ exceptionType: "quantity_anomaly" }],
    })).primaryCause).toBe(VARIANCE_CAUSES.PURCHASE_ENTRY_ERROR);
    expect(classifyVarianceExplanation(facts({
      priceAlerts: [{ alertType: "price_increase" }],
    })).primaryCause).toBe(VARIANCE_CAUSES.PURCHASE_COST_ANOMALY);
    expect(classifyVarianceExplanation(facts({
      openExceptions: [{ exceptionType: "transfer_mismatch" }],
    })).primaryCause).toBe(VARIANCE_CAUSES.TRANSFER_MISMATCH);
  });

  test("suppresses severe purchase attribution when nearby correction evidence exists", () => {
    expect(classifyVarianceExplanation(facts({
      nearbyCorrectionEvidence: { sourceReference: "invoice-1", relatedLineId: "line-2" },
      openExceptions: [{ exceptionType: "quantity_anomaly" }],
    }))).toMatchObject({
      primaryCause: VARIANCE_CAUSES.NEEDS_REVIEW,
      confidence: VARIANCE_CONFIDENCE.MEDIUM,
    });
  });

  test("makes incomplete recipes an explicit gap without inventing consumption", () => {
    expect(classifyVarianceExplanation(facts({
      recipeCoveragePct: 0,
      theoreticalRecipeConsumption: null,
    }))).toMatchObject({
      primaryCause: VARIANCE_CAUSES.RECIPE_COVERAGE_GAP,
      confidence: VARIANCE_CONFIDENCE.HIGH,
    });
  });

  test("uses insufficient data when no posted physical count exists", () => {
    expect(classifyVarianceExplanation(facts({
      physicalClosing: null,
      varianceQuantity: null,
    }))).toMatchObject({
      primaryCause: VARIANCE_CAUSES.NEEDS_REVIEW,
      confidence: VARIANCE_CONFIDENCE.INSUFFICIENT_DATA,
    });
  });

  test("deprioritizes confidence and prioritizes severity for incomplete counts", () => {
    const result = buildVarianceAnalysis(facts({
      countQuality: {
        warnings: [],
        hasUncountedLocation: true,
        selectedLocationCount: 3,
        countedLocationCount: 2,
      },
    }));
    expect(result).toMatchObject({
      primaryCause: VARIANCE_CAUSES.NEEDS_REVIEW,
      confidence: VARIANCE_CONFIDENCE.INSUFFICIENT_DATA,
      severity: VARIANCE_SEVERITY.HIGH,
    });
  });

  test("flags missing fryer-oil movement without accusatory language", () => {
    expect(classifyVarianceExplanation(facts({
      itemName: "Soya Frying Oil",
      varianceQuantity: "-120",
      actual: { ...facts().actual, operationalDisposal: "0" },
    }))).toMatchObject({
      primaryCause: VARIANCE_CAUSES.MISSING_MOVEMENT,
      contributingCauses: expect.arrayContaining([VARIANCE_CAUSES.UNRECORDED_WASTE]),
    });
  });

  test("ranks trusted value and quantity materiality without hiding low rows", () => {
    expect(classifyVarianceSeverity(facts({ varianceValue: "-6000" }))).toBe(VARIANCE_SEVERITY.CRITICAL);
    expect(classifyVarianceSeverity(facts({
      varianceValue: null,
      expectedClosing: "10",
      varianceQuantity: "-11",
    }))).toBe(VARIANCE_SEVERITY.HIGH);
    expect(buildVarianceAnalysis(facts({
      varianceValue: "-1",
      expectedClosing: "100",
      varianceQuantity: "-1",
    }))).toMatchObject({
      severity: VARIANCE_SEVERITY.LOW,
      materiality: { prioritized: false },
    });
  });

  test("preserves deterministic evidence and suggested action", () => {
    expect(buildVarianceAnalysis(facts({
      countQuality: { warnings: [{ code: "implausible_count", sourceId: "count-line-1" }] },
    }))).toMatchObject({
      primaryCause: VARIANCE_CAUSES.COUNT_ENTRY_ERROR,
      suggestedAction: "Review count quantity/unit and source evidence.",
      evidence: { movements: [{ movementId: "movement-1" }] },
    });
  });

  test("aggregates command center metrics while keeping unavailable values explicit", () => {
    const items = [
      buildVarianceAnalysis(facts({ varianceValue: "-6000" })),
      buildVarianceAnalysis(facts({
        itemName: "Coffee Beans",
        varianceValue: null,
        costStatus: "NO_HISTORICAL_COST",
        recipeCoveragePct: 0,
        theoreticalRecipeConsumption: null,
      })),
    ];
    expect(summarizeVarianceCommandCenter(items)).toMatchObject({
      totalItems: 2,
      critical: 1,
      untrustedValueCount: 1,
      missingRecipeCoverage: 1,
      totalTrustedVarianceValue: "6000",
    });
  });
});
