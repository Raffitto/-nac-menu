import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import InvoiceIntakeView from "./InvoiceIntakeView";
import { fetchInventoryReferenceData, fetchInvoiceHistory } from "../lib/inventoryApi";
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
  fetchInventoryReferenceData: jest.fn(),
  fetchInvoiceHistory: jest.fn(),
  generateMatchCandidates: jest.fn(),
  getInvoiceSourceUrl: jest.fn(),
  rejectInvoice: jest.fn(),
  resolveInvoiceException: jest.fn(),
  retrieveOcrResult: jest.fn(),
  triggerInvoiceOcr: jest.fn(),
  updateInvoiceReview: jest.fn(),
  uploadInvoice: jest.fn(),
}));

describe("InvoiceIntakeView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", "/inventory");
  });

  test("requires an authenticated internal session", () => {
    usePlatformSession.mockReturnValue({ session: null, checked: true, issue: null });
    render(<InvoiceIntakeView />);
    expect(screen.getByTestId("inventory-sign-in")).toHaveTextContent("Invoice intake");
  });

  test("renders the isolated upload and review workflow for an authenticated user", async () => {
    usePlatformSession.mockReturnValue({
      session: { user: { id: "user-1", email: "manager@nac.test" } },
      checked: true,
      issue: null,
    });
    fetchInvoiceHistory.mockResolvedValue([]);
    fetchInventoryReferenceData.mockResolvedValue({
      ingredients: [],
      suppliers: [],
      locations: [],
    });

    render(<InvoiceIntakeView />);

    expect(await screen.findByText("Inventory & Invoice Intelligence")).toBeInTheDocument();
    expect(screen.getByText("Upload supplier invoice")).toBeInTheDocument();
    expect(screen.getByText("Review queue")).toBeInTheDocument();
    expect(screen.getByText("Select an invoice to review.")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchInvoiceHistory).toHaveBeenCalledWith({ branchId: "khobar" });
      expect(fetchInventoryReferenceData).toHaveBeenCalledWith("khobar");
    });
  });
});
