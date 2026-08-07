import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import InventoryDataReadinessView from "./InventoryDataReadinessView";
import {
  createInventoryItemFromInvoiceCandidate,
  fetchInventoryDataReadiness,
  fetchInventoryStaffAccess,
  reviewSalesConsumptionBatch,
  setMenuItemCostingIntent,
} from "../lib/inventoryApi";

jest.mock("../lib/inventoryApi", () => ({
  createInventoryItemFromInvoiceCandidate: jest.fn(),
  fetchInventoryDataReadiness: jest.fn(),
  fetchInventoryStaffAccess: jest.fn(),
  reviewSalesConsumptionBatch: jest.fn(),
  setMenuItemCostingIntent: jest.fn(),
}));

const readiness = {
  productCoverage: {
    totalActiveProducts: 177,
    mapped: 0,
    trusted: 0,
    directStock: 0,
    unresolved: 177,
  },
  ingredientCoverage: {
    referencedIngredients: 0,
    historicalCostAvailable: 0,
  },
  salesCoverage: {
    approvedBatchCount: 0,
    unitCoveragePct: null,
    salesValueCoveragePct: null,
  },
  products: [{
    menuItemId: "menu-1",
    name: "Water",
    category: "Drinks",
    section: "Soft Drinks",
    coverageStatus: "MISSING_RECIPE",
    suggestedIntent: "direct_stock",
    suggestionConfidence: "MEDIUM",
    recipeName: null,
    costTrustStatus: "UNRELIABLE",
    soldUnits: 0,
    salesValue: 0,
  }],
  catalogueCandidates: [{
    invoice_line_id: "line-1",
    original_description: "MILK 12X1L",
    supplier_name: "Supplier",
    supplier_sku: "MILK-1",
    original_quantity: 12,
    original_unit: "carton",
    candidate_status: "DUPLICATE_CANDIDATE",
    duplicate_ingredient_name: "Milk",
  }],
  salesSources: [{
    batch_id: "batch-1",
    period_start: "2026-05-12",
    period_end: "2026-05-19",
    source_file_name: "Sales.xls",
    import_type: "product_sales",
    row_count: 99,
    sold_units: 3893,
    sales_value: 133854,
    unmatched_rows: 9,
    modifier_rows: 35,
    dated_rows: 0,
    has_overlapping_source: true,
    review_status: "pending",
  }],
};

describe("InventoryDataReadinessView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchInventoryDataReadiness.mockResolvedValue(readiness);
    fetchInventoryStaffAccess.mockResolvedValue({ vaultRole: "super_admin" });
  });

  test("shows honest product and unavailable sales coverage", async () => {
    render(<InventoryDataReadinessView branchId="khobar" />);
    expect(await screen.findAllByText("177")).toHaveLength(2);
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    expect(screen.getByText("Water")).toBeInTheDocument();
    expect(screen.getByText("MEDIUM confidence suggestion")).toBeInTheDocument();
    expect(screen.getByText(/Approve a non-overlapping sales source/)).toBeInTheDocument();
  });

  test("requires a reason before confirming a costing intent", async () => {
    window.prompt = jest.fn().mockReturnValue("Reviewed bottled product");
    setMenuItemCostingIntent.mockResolvedValue({});
    render(<InventoryDataReadinessView branchId="khobar" />);
    const select = await screen.findByLabelText("Costing intent for Water");
    fireEvent.change(select, { target: { value: "recipe_required" } });
    await waitFor(() => expect(setMenuItemCostingIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: "khobar",
        menuItemId: "menu-1",
        costingIntent: "recipe_required",
        reason: "Reviewed bottled product",
      }),
    ));
  });

  test("opens direct-stock suggestions in the canonical recipe editor", async () => {
    const onOpenFoodBible = jest.fn();
    render(
      <InventoryDataReadinessView
        branchId="khobar"
        onOpenFoodBible={onOpenFoodBible}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Document" }));
    expect(onOpenFoodBible).toHaveBeenCalledWith({
      menuItemId: "menu-1",
      recipeType: "direct_stock",
    });
  });

  test("blocks duplicate catalogue candidates from canonical creation", async () => {
    render(<InventoryDataReadinessView branchId="khobar" />);
    fireEvent.click(await screen.findByText("Catalogue onboarding"));
    expect(screen.getByText("MILK 12X1L")).toBeInTheDocument();
    expect(screen.getByText("Milk")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create canonical" })).toBeDisabled();
    expect(createInventoryItemFromInvoiceCandidate).not.toHaveBeenCalled();
  });

  test("reviews an explicit sales source as net of voids and refunds", async () => {
    window.prompt = jest.fn().mockReturnValue("Confirmed report semantics");
    reviewSalesConsumptionBatch.mockResolvedValue({});
    render(<InventoryDataReadinessView branchId="khobar" />);
    fireEvent.click(await screen.findByText("Sales sources"));
    fireEvent.click(screen.getByRole("button", { name: "Approve net source" }));
    await waitFor(() => expect(reviewSalesConsumptionBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: "batch-1",
        status: "approved",
        quantitySemantics: "net_of_voids_refunds",
      }),
    ));
  });
});
