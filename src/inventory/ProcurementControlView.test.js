import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProcurementControlView from "./ProcurementControlView";
import {
  createPurchaseOrder,
  fetchInventoryAuditTrail,
  fetchInventoryExceptions,
  fetchInventoryReferenceData,
  fetchInventoryStaffAccess,
  fetchPurchaseOrderProgress,
  fetchPurchaseOrders,
  fetchReceiptHistory,
  fetchSupplierReturns,
  transitionPurchaseOrder,
} from "../lib/inventoryApi";

jest.mock("../lib/inventoryApi", () => ({
  createPurchaseOrder: jest.fn(),
  fetchInventoryAuditTrail: jest.fn(),
  fetchInventoryExceptions: jest.fn(),
  fetchInventoryReferenceData: jest.fn(),
  fetchInventoryStaffAccess: jest.fn(),
  fetchPurchaseOrderProgress: jest.fn(),
  fetchPurchaseOrders: jest.fn(),
  fetchReceiptHistory: jest.fn(),
  fetchSupplierReturns: jest.fn(),
  postSupplierReturn: jest.fn(),
  transitionPurchaseOrder: jest.fn(),
}));

const reference = {
  ingredients: [{
    id: "ingredient-1",
    canonical_name: "Verification Cream",
    base_inventory_unit: "litre",
    purchasing_unit: "litre",
  }],
  suppliers: [{ id: "supplier-1", supplier_name: "Verification Supplier" }],
  locations: [{ id: "location-1", name: "Verification Receiving", is_default_receiving: true }],
};

describe("ProcurementControlView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchInventoryReferenceData.mockResolvedValue(reference);
    fetchPurchaseOrders.mockResolvedValue([]);
    fetchReceiptHistory.mockResolvedValue([]);
    fetchSupplierReturns.mockResolvedValue([]);
    fetchInventoryExceptions.mockResolvedValue([]);
    fetchInventoryStaffAccess.mockResolvedValue({
      vaultRole: "branch_manager",
      primaryBranchId: "khobar",
      branchIds: ["khobar"],
    });
    fetchInventoryAuditTrail.mockResolvedValue([]);
    fetchPurchaseOrderProgress.mockResolvedValue([]);
    createPurchaseOrder.mockResolvedValue({ status: "draft", purchaseOrderId: "po-1" });
    transitionPurchaseOrder.mockResolvedValue({ status: "approved", purchaseOrderId: "po-1" });
  });

  test("creates a branch-scoped purchase order with normalized line values", async () => {
    render(<ProcurementControlView branchId="khobar" mode="purchase-orders" />);
    fireEvent.click(await screen.findByText("New PO"));

    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "supplier-1" } });
    fireEvent.change(screen.getByLabelText("Destination"), { target: { value: "location-1" } });
    fireEvent.change(screen.getByLabelText("Reference"), { target: { value: "PO-VERIFY-1" } });
    fireEvent.change(screen.getByLabelText("PO line 1 item"), { target: { value: "ingredient-1" } });
    fireEvent.change(screen.getByLabelText("PO line 1 requestedQuantity"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("PO line 1 normalizedBaseQuantity"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("PO line 1 expectedUnitCost"), { target: { value: "28" } });
    fireEvent.click(screen.getByText("Create draft"));

    await waitFor(() => expect(createPurchaseOrder).toHaveBeenCalledWith(expect.objectContaining({
      branchId: "khobar",
      supplierId: "supplier-1",
      destinationLocationId: "location-1",
      referenceNumber: "PO-VERIFY-1",
      lines: [expect.objectContaining({
        ingredientId: "ingredient-1",
        requestedQuantity: "2",
        requestedUnit: "litre",
        normalizedBaseQuantity: "2",
        canonicalUnit: "litre",
        expectedUnitCost: "28",
      })],
    })));
  });

  test("uses the server transition RPC for purchase-order approval", async () => {
    fetchPurchaseOrders.mockResolvedValue([{
      id: "po-1",
      branch_id: "khobar",
      supplier_id: "supplier-1",
      reference_number: "PO-VERIFY-2",
      status: "submitted",
      expected_total: 56,
      inventory_suppliers: { supplier_name: "Verification Supplier" },
      inventory_purchase_order_lines: [],
    }]);
    jest.spyOn(window, "prompt").mockReturnValue("Manager approval");

    render(<ProcurementControlView branchId="khobar" mode="purchase-orders" />);
    fireEvent.click(await screen.findByText("approved"));

    await waitFor(() => expect(transitionPurchaseOrder).toHaveBeenCalledWith(
      "po-1",
      "approved",
      "Manager approval"
    ));
    window.prompt.mockRestore();
  });
});
