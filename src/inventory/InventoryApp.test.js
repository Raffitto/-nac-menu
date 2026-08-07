import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import InventoryApp from "./InventoryApp";
import {
  fetchFoodBibleOverview,
  fetchInventoryExceptions,
  fetchInventoryReferenceData,
  fetchInvoiceHistory,
  fetchIngredients,
  fetchInventoryDataReadiness,
  fetchInventoryStaffAccess,
  fetchInventoryVarianceAnalysis,
  fetchOperationalEvents,
  fetchPurchaseOrders,
  fetchReceiptHistory,
  fetchCountSessions,
  fetchSupplierReturns,
  fetchTransfers,
} from "../lib/inventoryApi";
import { usePlatformSession } from "../dashboard/hooks/usePlatformSession";

jest.mock("../dashboard/hooks/usePlatformSession", () => ({
  usePlatformSession: jest.fn(),
}));

jest.mock("../dashboard/components/NacAnalyticsSignIn", () => ({
  __esModule: true,
  default: ({ title }) => <div data-testid="inventory-sign-in">{title}</div>,
}));

jest.mock("../lib/supabase", () => ({
  supabase: { auth: { signOut: jest.fn() } },
}));

jest.mock("../lib/inventoryApi", () => ({
  approveInvoice: jest.fn(),
  confirmLineMapping: jest.fn(),
  createIngredient: jest.fn(),
  createCountSession: jest.fn(),
  createOperationalEvent: jest.fn(),
  createPurchaseOrder: jest.fn(),
  createRecipe: jest.fn(),
  createTransfer: jest.fn(),
  confirmStockCountWarning: jest.fn(),
  dispatchTransfer: jest.fn(),
  fetchCountSessionDetails: jest.fn(),
  fetchCountSessions: jest.fn(),
  fetchInventoryAuditTrail: jest.fn(),
  fetchFoodBibleOverview: jest.fn(),
  fetchIngredientDependencySummary: jest.fn(),
  fetchIngredients: jest.fn(),
  fetchInventoryDataReadiness: jest.fn(),
  fetchInventoryExceptions: jest.fn(),
  fetchInventoryReferenceData: jest.fn(),
  fetchInventoryStaffAccess: jest.fn(),
  fetchInventoryVarianceAnalysis: jest.fn(),
  fetchInvoiceHistory: jest.fn(),
  fetchOperationalEvents: jest.fn(),
  fetchPurchaseOrderProgress: jest.fn(),
  fetchPurchaseOrders: jest.fn(),
  fetchReceiptHistory: jest.fn(),
  fetchRecipeBundle: jest.fn(),
  fetchRecipeUsageCounts: jest.fn(),
  fetchSupplierReturns: jest.fn(),
  fetchTransfers: jest.fn(),
  findDuplicateIngredient: jest.fn(),
  generateMatchCandidates: jest.fn(),
  getInvoiceSourceUrl: jest.fn(),
  linkInvoicePurchaseOrder: jest.fn(),
  postSupplierReturn: jest.fn(),
  rejectInvoice: jest.fn(),
  resolveInvoiceException: jest.fn(),
  retrieveOcrResult: jest.fn(),
  saveRecipeDraft: jest.fn(),
  saveCountSessionLine: jest.fn(),
  setIngredientActive: jest.fn(),
  setRecipeActive: jest.fn(),
  triggerInvoiceOcr: jest.fn(),
  transitionPurchaseOrder: jest.fn(),
  transitionCountSession: jest.fn(),
  transitionTransfer: jest.fn(),
  receiveTransfer: jest.fn(),
  updateIngredient: jest.fn(),
  updateInvoiceReview: jest.fn(),
  uploadInvoice: jest.fn(),
}));

describe("InventoryApp", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", "/inventory?branch=khobar&view=invoices");
    usePlatformSession.mockReturnValue({
      session: { user: { id: "user-1", email: "manager@nac.test" } },
      checked: true,
      issue: null,
    });
    fetchInvoiceHistory.mockResolvedValue([]);
    fetchOperationalEvents.mockResolvedValue([]);
    fetchPurchaseOrders.mockResolvedValue([]);
    fetchReceiptHistory.mockResolvedValue([]);
    fetchSupplierReturns.mockResolvedValue([]);
    fetchTransfers.mockResolvedValue([]);
    fetchCountSessions.mockResolvedValue([]);
    fetchInventoryExceptions.mockResolvedValue([]);
    fetchInventoryVarianceAnalysis.mockResolvedValue({
      branchId: "khobar",
      recipeCoveragePct: 0,
      theoreticalConsumptionAvailable: false,
      items: [],
      summary: {},
    });
    fetchInventoryReferenceData.mockResolvedValue({ ingredients: [], suppliers: [], locations: [] });
    fetchIngredients.mockResolvedValue([]);
    fetchInventoryDataReadiness.mockResolvedValue({
      productCoverage: {},
      ingredientCoverage: {},
      salesCoverage: {},
      products: [],
      catalogueCandidates: [],
      salesSources: [],
    });
    fetchFoodBibleOverview.mockResolvedValue({
      summary: { totalMenuItems: 0, complete: 0, inProgress: 0, missing: 0, needsAttention: 0, coveragePct: 0 },
      rows: [],
      recipes: [],
      ingredients: [],
      hasActiveIngredients: false,
    });
    fetchInventoryStaffAccess.mockResolvedValue({
      vaultRole: "branch_manager",
      primaryBranchId: "khobar",
      branchIds: ["khobar"],
    });
  });

  test("requires authentication", () => {
    usePlatformSession.mockReturnValue({ session: null, checked: true, issue: null });
    render(<InventoryApp />);
    expect(screen.getByTestId("inventory-sign-in")).toHaveTextContent("Invoice intake");
  });

  test("shows invoice, procurement, transfer, count, ingredient, food bible, readiness, and operations tabs", async () => {
    render(<InventoryApp />);
    expect(await screen.findByTestId("inventory-tab-invoices")).toBeInTheDocument();
    expect(screen.getByTestId("inventory-tab-overview")).toBeInTheDocument();
    expect(screen.getByTestId("inventory-tab-purchase-orders")).toBeInTheDocument();
    expect(screen.getByTestId("inventory-tab-purchases")).toBeInTheDocument();
    expect(screen.getByTestId("inventory-tab-returns")).toBeInTheDocument();
    expect(screen.getByTestId("inventory-tab-transfers")).toBeInTheDocument();
    expect(screen.getByTestId("inventory-tab-stock-counts")).toBeInTheDocument();
    expect(screen.getByTestId("inventory-tab-ingredients")).toBeInTheDocument();
    expect(screen.getByTestId("inventory-tab-food-bible")).toBeInTheDocument();
    expect(screen.getByTestId("inventory-tab-data-readiness")).toBeInTheDocument();
    expect(screen.getByTestId("inventory-tab-operations")).toBeInTheDocument();
    expect(screen.getByText("Upload supplier invoice")).toBeInTheDocument();
  });

  test("switches between inventory sections without breaking invoice review", async () => {
    render(<InventoryApp />);
    await screen.findByText("Upload supplier invoice");
    fireEvent.click(screen.getByTestId("inventory-tab-overview"));
    expect(await screen.findByTestId("inventory-command-center")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("inventory-tab-ingredients"));
    expect(await screen.findByTestId("ingredient-master-view")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("inventory-tab-food-bible"));
    expect(await screen.findByTestId("food-bible-view")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("inventory-tab-data-readiness"));
    expect(await screen.findByTestId("inventory-data-readiness")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("inventory-tab-operations"));
    expect(await screen.findByTestId("operational-control-view")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("inventory-tab-purchase-orders"));
    expect(await screen.findByTestId("procurement-view-purchase-orders")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("inventory-tab-purchases"));
    expect(await screen.findByTestId("procurement-view-purchases")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("inventory-tab-returns"));
    expect(await screen.findByTestId("procurement-view-returns")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("inventory-tab-transfers"));
    expect(await screen.findByTestId("inventory-operations-transfers")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("inventory-tab-stock-counts"));
    expect(await screen.findByTestId("inventory-operations-stock-counts")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("inventory-tab-invoices"));
    expect(await screen.findByText("Upload supplier invoice")).toBeInTheDocument();
  });
});
