import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import InventoryTruthView from "./InventoryTruthView";
import { KNOWN_CASE_FIXTURE } from "./truth/knownCases.fixtures";
import { buildInventoryTruthResult } from "../lib/inventoryTruthApi";

jest.mock("../lib/inventoryApi", () => ({
  fetchInventoryStaffAccess: jest.fn(async () => ({
    vaultRole: "super_admin",
    branchIds: ["khobar", "riyadh", "jeddah"],
    primaryBranchId: "khobar",
  })),
}));

jest.mock("../lib/inventoryTruthApi", () => {
  const actual = jest.requireActual("../lib/inventoryTruthApi");
  return {
    ...actual,
    fetchInventoryTruthFoundation: jest.fn(),
    fetchInventoryTruthSales: jest.fn(),
  };
});

const { fetchInventoryTruthFoundation, fetchInventoryTruthSales } = require("../lib/inventoryTruthApi");

describe("InventoryTruthView", () => {
  const foundation = {
    branchId: "khobar",
    ingredients: KNOWN_CASE_FIXTURE.ingredients,
    recipes: KNOWN_CASE_FIXTURE.recipes,
    versions: KNOWN_CASE_FIXTURE.versions,
    lines: KNOWN_CASE_FIXTURE.lines,
    catalogueItems: [],
    costStateByIngredientId: KNOWN_CASE_FIXTURE.costStateByIngredientId,
    movements: [],
    stockCounts: [],
  };

  beforeEach(() => {
    fetchInventoryTruthFoundation.mockResolvedValue(foundation);
    fetchInventoryTruthSales.mockResolvedValue({
      rows: KNOWN_CASE_FIXTURE.salesRows,
      periodStart: "2026-08-02",
      periodEnd: "2026-08-08",
      branchId: "khobar",
    });
  });

  test("shows readiness and does not render actual or variance as zero", async () => {
    render(<InventoryTruthView branchId="khobar" />);
    expect(await screen.findByTestId("inventory-truth-readiness")).toBeInTheDocument();
    expect(screen.getByTestId("inventory-truth-actual").textContent).toMatch(/UNAVAILABLE/i);
    expect(screen.getByTestId("inventory-truth-actual").textContent).not.toMatch(/Actual consumption: 0/);
    expect(screen.getByTestId("inventory-truth-cost").textContent).toMatch(/Costed ingredients: 4/);
  });

  test("explorer traces theoretical honey after a sales period is calculated", async () => {
    render(<InventoryTruthView branchId="khobar" />);
    await screen.findByTestId("inventory-truth-ingredient-list");
    fireEvent.click(screen.getByRole("button", { name: "Calculate theoretical" }));
    await waitFor(() => expect(fetchInventoryTruthSales).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Honey" }));
    expect(await screen.findByTestId("inventory-truth-explorer")).toHaveTextContent("Honey");
    expect(screen.getByTestId("inventory-truth-trace")).toHaveTextContent("French Toast");
    expect(screen.getByTestId("inventory-truth-trace")).toHaveTextContent("House Salad");
    expect(screen.getByTestId("inventory-truth-explorer")).toHaveTextContent("Not computable");
    expect(screen.getByTestId("inventory-truth-explorer")).toHaveTextContent("Unavailable");
    const expected = buildInventoryTruthResult(foundation, {
      rows: KNOWN_CASE_FIXTURE.salesRows,
      periodStart: "2026-08-02",
      periodEnd: "2026-08-08",
    });
    const honey = expected.theoretical.rows.find((row) => row.canonicalIngredientId === "honey");
    expect(screen.getByTestId("inventory-truth-explorer")).toHaveTextContent(honey.quantityTheoreticallyConsumed);
  });
});
