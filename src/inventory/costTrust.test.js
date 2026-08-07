import {
  COST_TRUST,
  costTrustLabel,
  formatSar,
  gateMenuEngineeringClassification,
  isTrustedProductCost,
} from "./costTrust";

describe("cost trust helpers", () => {
  test("requires explicit trusted and available cost for profitability", () => {
    expect(isTrustedProductCost({
      costTrustStatus: COST_TRUST.TRUSTED,
      profitabilityAvailable: true,
      costPerSoldPortion: 15,
    })).toBe(true);
    expect(isTrustedProductCost({
      costTrustStatus: COST_TRUST.INCOMPLETE,
      profitabilityAvailable: false,
      costPerSoldPortion: 0,
    })).toBe(false);
  });

  test("gates menu engineering when cost is absent or incomplete", () => {
    expect(gateMenuEngineeringClassification({}, {
      quadrant: "Star",
      suggestion: "Feature",
    })).toMatchObject({
      quadrant: "COST_DATA_INCOMPLETE",
      costTrustStatus: "UNRELIABLE",
    });
  });

  test("preserves classification only for trusted cost", () => {
    expect(gateMenuEngineeringClassification({
      costTrustStatus: "TRUSTED",
      profitabilityAvailable: true,
      costPerSoldPortion: 15,
    }, {
      quadrant: "Star",
    })).toMatchObject({
      quadrant: "Star",
      costTrustStatus: "TRUSTED",
    });
  });

  test("does not format missing cost as zero", () => {
    expect(formatSar(null)).toBe("Unavailable");
    expect(formatSar(0)).toBe("SAR 0.00");
    expect(costTrustLabel("INCOMPLETE")).toBe("Incomplete");
  });
});
