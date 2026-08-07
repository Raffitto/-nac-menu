import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import OperationalControlView from "./OperationalControlView";
import {
  createOperationalEvent,
  fetchInventoryExceptions,
  fetchInventoryReferenceData,
  fetchInventoryStaffAccess,
  fetchOperationalEvents,
} from "../lib/inventoryApi";

jest.mock("../lib/inventoryApi", () => ({
  createOperationalEvent: jest.fn(),
  fetchInventoryExceptions: jest.fn(),
  fetchInventoryReferenceData: jest.fn(),
  fetchInventoryStaffAccess: jest.fn(),
  fetchOperationalEvents: jest.fn(),
}));

describe("OperationalControlView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchInventoryReferenceData.mockResolvedValue({
      ingredients: [{
        id: "oil",
        canonical_name: "Soya Frying Oil",
        base_inventory_unit: "litre",
      }],
      locations: [{ id: "kitchen", name: "Kitchen" }],
      suppliers: [],
    });
    fetchOperationalEvents.mockResolvedValue([]);
    fetchInventoryExceptions.mockResolvedValue([]);
    fetchInventoryStaffAccess.mockResolvedValue({
      vaultRole: "branch_manager",
      primaryBranchId: "khobar",
      branchIds: ["khobar"],
    });
    createOperationalEvent.mockResolvedValue({ status: "posted", movementId: "movement-1" });
    Object.defineProperty(global, "crypto", {
      configurable: true,
      value: { randomUUID: () => "event-1" },
    });
  });

  test("posts frying-oil disposal with business date and evidence", async () => {
    render(<OperationalControlView branchId="khobar" />);
    await screen.findByTestId("operational-control-view");
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Used frying oil disposal" } });
    fireEvent.click(screen.getByRole("button", { name: "Post movement" }));

    await waitFor(() => expect(createOperationalEvent).toHaveBeenCalledWith(
      "disposal",
      expect.objectContaining({
        branchId: "khobar",
        ingredientId: "oil",
        locationId: "kitchen",
        canonicalQuantity: "20",
        canonicalUnit: "litre",
        reason: "Used frying oil disposal",
        evidence: { entryMethod: "inventory_command_center" },
      }),
    ));
    expect(await screen.findByText(/posted to the immutable inventory ledger/i)).toBeInTheDocument();
  });

  test("keeps unauthorized branch users read-only", async () => {
    fetchInventoryStaffAccess.mockResolvedValue({
      vaultRole: "branch_manager",
      primaryBranchId: "riyadh",
      branchIds: ["riyadh"],
    });
    render(<OperationalControlView branchId="khobar" />);
    expect(await screen.findByRole("button", { name: "Post movement" })).toBeDisabled();
    expect(screen.getByText(/Read-only/)).toBeInTheDocument();
  });
});
