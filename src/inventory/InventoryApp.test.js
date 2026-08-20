import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import InventoryApp from "./InventoryApp";
import { fetchFoodBibleOverview, fetchCanonicalCostContext, fetchInventoryReferenceData, fetchInvoiceHistory, fetchIngredients, fetchInventoryStaffAccess } from "../lib/inventoryApi";
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
  createRecipe: jest.fn(),
  fetchFoodBibleOverview: jest.fn(),
  fetchCanonicalCostContext: jest.fn(),
  fetchIngredientDependencySummary: jest.fn(),
  fetchIngredients: jest.fn(),
  fetchInventoryReferenceData: jest.fn(),
  fetchInventoryStaffAccess: jest.fn(),
  fetchInvoiceHistory: jest.fn(),
  fetchRecipeBundle: jest.fn(),
  fetchRecipeUsageCounts: jest.fn(),
  findDuplicateIngredient: jest.fn(),
  generateMatchCandidates: jest.fn(),
  getInvoiceSourceUrl: jest.fn(),
  rejectInvoice: jest.fn(),
  resolveInvoiceException: jest.fn(),
  retrieveOcrResult: jest.fn(),
  saveRecipeDraft: jest.fn(),
  setIngredientActive: jest.fn(),
  setRecipeActive: jest.fn(),
  triggerInvoiceOcr: jest.fn(),
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
    fetchInventoryReferenceData.mockResolvedValue({ ingredients: [], suppliers: [], locations: [] });
    fetchIngredients.mockResolvedValue([]);
    fetchFoodBibleOverview.mockResolvedValue({
      summary: { totalMenuItems: 0, complete: 0, inProgress: 0, missing: 0, needsAttention: 0, coveragePct: 0 },
      rows: [],
      recipes: [],
      ingredients: [],
      hasActiveIngredients: false,
    });
    fetchCanonicalCostContext.mockResolvedValue({ costByCanonicalId: {} });
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

  test("shows invoice review, ingredients, and food bible tabs", async () => {
    render(<InventoryApp />);
    expect(await screen.findByTestId("inventory-tab-invoices")).toBeInTheDocument();
    expect(screen.getByTestId("inventory-tab-ingredients")).toBeInTheDocument();
    expect(screen.getByTestId("inventory-tab-food-bible")).toBeInTheDocument();
    expect(screen.getByText("Upload supplier invoice")).toBeInTheDocument();
  });

  test("switches between inventory sections without breaking invoice review", async () => {
    render(<InventoryApp />);
    await screen.findByText("Upload supplier invoice");
    fireEvent.click(screen.getByTestId("inventory-tab-ingredients"));
    expect(await screen.findByTestId("ingredient-master-view")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("inventory-tab-food-bible"));
    expect(await screen.findByTestId("food-bible-view")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("inventory-tab-invoices"));
    expect(await screen.findByText("Upload supplier invoice")).toBeInTheDocument();
  });
});
