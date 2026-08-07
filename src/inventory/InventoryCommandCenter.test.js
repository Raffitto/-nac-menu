import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import InventoryCommandCenter from "./InventoryCommandCenter";
import {
  fetchInventoryVarianceAnalysis,
  setInventoryVarianceReview,
} from "../lib/inventoryApi";

jest.mock("../lib/inventoryApi", () => ({
  fetchInventoryVarianceAnalysis: jest.fn(),
  setInventoryVarianceReview: jest.fn(),
}));

const item = {
  inventoryItemId: "item-1",
  itemName: "Coffee Beans",
  branchId: "khobar",
  periodStart: "2026-07-01",
  periodEnd: "2026-07-31",
  analysisAsOf: "2026-07-31",
  canonicalUnit: "kilogram",
  openingQuantity: "20",
  actual: {
    purchases: "10",
    returnsToSupplier: "0",
    transfersIn: "0",
    transfersOut: "0",
    staffMeal: "0",
    operationalDisposal: "0",
    recordedWaste: "0",
    productionInput: "0",
    productionOutput: "0",
    actualOrderConsumption: "0",
    adjustmentsNet: "0",
  },
  expectedClosing: "18.3",
  physicalClosing: "30",
  varianceQuantity: "11.7",
  varianceValue: null,
  costStatus: "NO_HISTORICAL_COST",
  recipeCoveragePct: 0,
  theoreticalRecipeConsumption: null,
  primaryCause: "RECIPE_COVERAGE_GAP",
  contributingCauses: ["COST_DATA_INCOMPLETE"],
  confidence: "HIGH",
  severity: "HIGH",
  suggestedAction: "Complete recipe mapping before evaluating theoretical variance.",
  countQuality: {
    countSessionId: "count-1",
    selectedLocationCount: 2,
    countedLocationCount: 2,
    warnings: [],
  },
  openExceptions: [],
  evidence: {
    movements: [{
      movementId: "movement-1",
      movementType: "purchase_receipt",
      businessDate: "2026-07-10",
      quantity: "10",
      sourceReference: "INV-100",
    }],
  },
  review: { status: "OPEN" },
  materiality: { prioritized: true },
};

describe("InventoryCommandCenter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchInventoryVarianceAnalysis.mockResolvedValue({
      branchId: "khobar",
      recipeCoveragePct: 0,
      theoreticalConsumptionAvailable: false,
      theoreticalConsumptionReason: "RECIPE_COVERAGE_GAP",
      items: [item],
      summary: {
        critical: 0,
        high: 1,
        countQualityIssues: 0,
        negativeTheoreticalStock: 0,
        missingRecipeCoverage: 1,
        untrustedValueCount: 1,
        totalTrustedVarianceValue: "0",
      },
    });
    setInventoryVarianceReview.mockResolvedValue({ status: "REVIEWING" });
  });

  test("shows honest recipe and SAR trust gates", async () => {
    render(<InventoryCommandCenter branchId="khobar" />);
    expect(await screen.findByText("Coffee Beans")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText(/theoretical ingredient consumption is unavailable/i)).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  test("opens deterministic item evidence detail", async () => {
    render(<InventoryCommandCenter branchId="khobar" />);
    fireEvent.click(await screen.findByRole("button", { name: "Explain Coffee Beans" }));
    expect(screen.getByRole("dialog", { name: /Variance explanation for Coffee Beans/ })).toBeInTheDocument();
    expect(screen.getAllByText("Recipe Coverage Gap")).toHaveLength(2);
    expect(screen.getByText(/Complete recipe mapping/)).toBeInTheDocument();
    expect(screen.getByText(/INV-100/)).toBeInTheDocument();
  });

  test("persists review workflow separately from source evidence", async () => {
    window.prompt = jest.fn(() => "Controller reviewed the count and recipe gap.");
    render(<InventoryCommandCenter branchId="khobar" />);
    fireEvent.click(await screen.findByRole("button", { name: "Explain Coffee Beans" }));
    fireEvent.click(screen.getByRole("button", { name: "Reviewing" }));
    await waitFor(() => expect(setInventoryVarianceReview).toHaveBeenCalledWith(expect.objectContaining({
      branchId: "khobar",
      ingredientId: "item-1",
      status: "REVIEWING",
      reason: "Controller reviewed the count and recipe gap.",
      countSessionId: "count-1",
    })));
  });
});
