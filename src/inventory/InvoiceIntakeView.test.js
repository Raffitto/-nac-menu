import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import InvoiceIntakeView from "./InvoiceIntakeView";
import { fetchInventoryReferenceData, fetchInvoiceHistory, triggerInvoiceOcr, uploadInvoice } from "../lib/inventoryApi";
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

  test("keeps the photographed page and offers retry when the source upload is aborted", async () => {
    usePlatformSession.mockReturnValue({
      session: { user: { id: "user-1", email: "manager@nac.test" } },
      checked: true,
      issue: null,
    });
    fetchInvoiceHistory.mockResolvedValue([]);
    fetchInventoryReferenceData.mockResolvedValue({ ingredients: [], suppliers: [], locations: [] });
    uploadInvoice.mockRejectedValue(Object.assign(
      new Error("Invoice photo could not be uploaded. Your photo is still selected — tap Retry."),
      { stage: "upload" },
    ));
    jest.spyOn(console, "error").mockImplementation(() => {});

    render(<InvoiceIntakeView />);
    await screen.findByText("Upload supplier invoice");
    const camera = document.querySelector('input[capture="environment"]');
    fireEvent.change(camera, {
      target: { files: [new File(["photo"], "image.jpg", { type: "image/jpeg" })] },
    });
    expect(await screen.findByText(/Page 1: image.jpg/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Upload & extract" }));

    expect(await screen.findByText(/Your photo is still selected — tap Retry/)).toBeInTheDocument();
    expect(screen.getByText(/Page 1: image.jpg/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(triggerInvoiceOcr).not.toHaveBeenCalled();
    console.error.mockRestore();
  });
});
