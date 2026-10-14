import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import ManagerReceivingView from "./ManagerReceivingView";
import {
  fetchInventoryReferenceData,
  fetchInventoryStaffAccess,
  fetchReceiptHistory,
} from "../lib/inventoryApi";

jest.mock("../lib/inventoryApi", () => ({
  fetchInventoryReferenceData: jest.fn(),
  fetchInventoryStaffAccess: jest.fn(),
  fetchReceiptHistory: jest.fn(),
}));

const manager = {
  vaultRole: "branch_manager",
  primaryBranchId: "khobar",
  branchIds: ["khobar"],
};

const reference = {
  ingredients: [{ id: "ing-1", canonical_name: "Milk", base_inventory_unit: "litre" }],
  suppliers: [{ id: "sup-1", supplier_name: "Ecowhiz" }],
};

beforeEach(() => {
  fetchInventoryStaffAccess.mockResolvedValue(manager);
  fetchInventoryReferenceData.mockResolvedValue(reference);
  fetchReceiptHistory.mockResolvedValue([{
    id: "receipt-1",
    branch_id: "khobar",
    supplier_id: "sup-1",
    source_reference: "DN-9",
    status: "posted",
    inventory_purchase_receipt_lines: [
      { ingredient_id: "ing-1", canonical_unit: "litre" },
    ],
  }]);
});

async function fillDelivery({ reference = "DN-20", ordered = "10", received = "4" } = {}) {
  fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "sup-1" } });
  fireEvent.change(screen.getByLabelText("Delivery reference"), { target: { value: reference } });
  fireEvent.change(screen.getByLabelText("Ingredient"), { target: { value: "ing-1" } });
  fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "litre" } });
  fireEvent.change(screen.getByLabelText("Ordered quantity"), { target: { value: ordered } });
  fireEvent.change(screen.getByLabelText("Received quantity"), { target: { value: received } });
  fireEvent.click(screen.getByRole("button", { name: "Add to delivery" }));
}

test("a partial delivery stays in the preview and is not posted", async () => {
  render(<ManagerReceivingView branchId="khobar" />);
  expect(await screen.findByLabelText("Supplier")).toBeInTheDocument();
  await fillDelivery();
  expect(await screen.findByText(/Milk: received 4 litre · partial/)).toBeInTheDocument();
  expect(screen.getByText("Nothing is posted.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /post/i })).not.toBeInTheDocument();
  expect(fetchReceiptHistory).toHaveBeenCalledWith({ branchId: "khobar" });
});

test("a delivery already in history is rejected", async () => {
  render(<ManagerReceivingView branchId="khobar" />);
  await screen.findByLabelText("Supplier");
  await fillDelivery({ reference: "DN-9", ordered: "2", received: "2" });
  expect(await screen.findByText(/already recorded/i)).toBeInTheDocument();
  expect(screen.getByText("No lines yet.")).toBeInTheDocument();
});

test("a viewer cannot record a delivery", async () => {
  fetchInventoryStaffAccess.mockResolvedValue({
    vaultRole: "viewer",
    primaryBranchId: "khobar",
    branchIds: ["khobar"],
  });
  render(<ManagerReceivingView branchId="khobar" />);
  expect(await screen.findByText(/cannot record a delivery/i)).toBeInTheDocument();
  expect(screen.queryByLabelText("Supplier")).not.toBeInTheDocument();
});

test("posted history for the branch is shown", async () => {
  render(<ManagerReceivingView branchId="khobar" />);
  expect(await screen.findByText(/DN-9 · posted/)).toBeInTheDocument();
});
