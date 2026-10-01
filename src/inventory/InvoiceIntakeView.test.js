import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import InvoiceIntakeView from "./InvoiceIntakeView";
import {
  approveInvoice,
  fetchInventoryReferenceData,
  fetchInvoiceHistory,
  reconcileInvoiceExceptions,
  retrieveOcrResult,
  triggerInvoiceOcr,
  uploadInvoice,
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
  fetchInventoryReferenceData: jest.fn(),
  fetchInvoiceHistory: jest.fn(),
  generateMatchCandidates: jest.fn(),
  getInvoiceSourceUrl: jest.fn(),
  rejectInvoice: jest.fn(),
  resolveInvoiceException: jest.fn(),
  retrieveOcrResult: jest.fn(),
  reconcileInvoiceExceptions: jest.fn(),
  triggerInvoiceOcr: jest.fn(),
  updateInvoiceReview: jest.fn(),
  uploadInvoice: jest.fn(),
  supplierCandidatesForInvoice: jest.fn(async () => ({ name: null, vat: null, candidates: [] })),
  attachSupplierToInvoice: jest.fn(),
  confirmSupplierReceivingProfile: jest.fn(),
  confirmLinePack: jest.fn(),
  createIngredient: jest.fn(),
  assignHumanCode: jest.fn(),
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

const receivingLines = [
  {
    id: "bag",
    active: true,
    supplier_sku: "2080534",
    original_description: "Nac Printed Paper Bag - Each",
    original_quantity: 250,
    canonical_received_quantity: 250,
    canonical_unit: "each",
    conversion_factor: 1,
    review_status: "verified",
    ingredient_id: "paper",
    unit_price: null,
    line_total: null,
  },
  {
    id: "wet",
    active: true,
    supplier_sku: "2030912",
    original_description: "Nac Printed Wet Tissue 1000 Pcs",
    original_quantity: 4,
    canonical_received_quantity: 4000,
    canonical_unit: "each",
    conversion_factor: 1000,
    pack_status: "verified",
    review_status: "verified",
    ingredient_id: "tissue",
    unit_price: null,
    line_total: null,
  },
];

function readyDocument(overrides = {}) {
  return {
    id: "inv-18426",
    status: "needs_review",
    supplier_id: "ecowhiz",
    invoice_number: "18426",
    receiving_treatment: "company_settled_document",
    receiving_location_id: "store",
    purchase_channel: "supplier_credit",
    currency: "SAR",
    total: null,
    inventory_invoice_lines: receivingLines,
    inventory_invoice_exceptions: [],
    inventory_suppliers: { supplier_name: "Ecowhiz Industries Company" },
    ...overrides,
  };
}

async function openDocument(invoice, locations, retrieve) {
  const locationRows = locations === undefined
    ? [{ id: "store", name: "Khobar dry store", active: true }]
    : locations;
  usePlatformSession.mockReturnValue({
    session: { user: { id: "user-1", email: "manager@nac.test" } },
    checked: true,
    issue: null,
  });
  fetchInvoiceHistory.mockResolvedValue([invoice]);
  fetchInventoryReferenceData.mockResolvedValue({
    ingredients: [
      { id: "paper", canonical_name: "Nac Printed Paper Bag - Each" },
      { id: "tissue", canonical_name: "Nac Printed Wet Tissue 1000 Pcs" },
    ],
    suppliers: [],
    locations: locationRows,
  });
  reconcileInvoiceExceptions.mockResolvedValue(null);
  retrieveOcrResult.mockImplementation(retrieve || (async () => invoice));
  render(<InvoiceIntakeView />);
  return screen.findByRole("button", { name: "Approve & post" });
}

describe("Approve and post result", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", "/inventory");
  });

  test("a successful post becomes POSTED and cannot be clicked again", async () => {
    const button = await openDocument(readyDocument());
    approveInvoice.mockResolvedValue({ status: "posted", receiptId: "receipt-1" });
    fireEvent.click(button);
    expect(await screen.findByText("POSTED")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Posted" })).toBeDisabled();
    expect(approveInvoice).toHaveBeenCalledTimes(1);
    expect(approveInvoice).toHaveBeenCalledWith("inv-18426");
  });

  test("a backend rejection stays next to the button and can be retried", async () => {
    const button = await openDocument(readyDocument());
    approveInvoice.mockRejectedValue(new Error("Approve and post invoice: No receiving location configured for branch khobar"));
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/No receipt was created/));
    const retry = screen.getByRole("button", { name: "Approve & post" });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    await waitFor(() => expect(approveInvoice).toHaveBeenCalledTimes(2));
  });

  test("an aborted request with an existing receipt shows POSTED and does not retry", async () => {
    let reads = 0;
    const button = await openDocument(readyDocument(), undefined, async () => {
      reads += 1;
      return reads === 1
        ? readyDocument()
        : readyDocument({ status: "posted", posted_receipt_id: "receipt-1" });
    });
    approveInvoice.mockRejectedValue(new Error("Fetch is aborted"));
    fireEvent.click(button);
    expect(await screen.findByText("POSTED")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Posted" })).toBeDisabled();
    expect(approveInvoice).toHaveBeenCalledTimes(1);
  });

  test("an aborted request with no receipt shows the error and allows retry", async () => {
    const button = await openDocument(readyDocument());
    approveInvoice.mockRejectedValue(new Error("network timeout"));
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/No receipt was created/));
    expect(screen.getByRole("button", { name: "Approve & post" })).toBeEnabled();
  });

  test("an aborted request that cannot be re-read stays blocked", async () => {
    let reads = 0;
    const button = await openDocument(readyDocument(), undefined, async () => {
      reads += 1;
      if (reads === 1) return readyDocument();
      throw new Error("still offline");
    });
    approveInvoice.mockRejectedValue(new Error("Fetch is aborted"));
    fireEvent.click(button);
    expect(await screen.findByText(/could not be confirmed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve & post" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Refresh status" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Approve & post" }));
    expect(approveInvoice).toHaveBeenCalledTimes(1);
  });

  test("a second click while posting does not call the receipt function again", async () => {
    let resolvePost;
    approveInvoice.mockImplementation(() => new Promise((resolve) => {
      resolvePost = resolve;
    }));
    const button = await openDocument(readyDocument());
    fireEvent.click(button);
    fireEvent.click(button);
    expect(approveInvoice).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Posting receipt…" })).toBeDisabled();
    resolvePost({ status: "posted", receiptId: "receipt-1" });
    expect(await screen.findByText("POSTED")).toBeInTheDocument();
  });

  test("verified conversions replace unresolved pack wording", async () => {
    await openDocument(readyDocument({
      inventory_invoice_lines: receivingLines.map((line) => ({ ...line, match_method: "manual_review" })),
    }));
    expect(screen.getByText("Supplier delivered: 250 each")).toBeInTheDocument();
    expect(screen.getByText("Received into inventory: 250 each")).toBeInTheDocument();
    expect(screen.getByText("Supplier delivered: 4 × 1000 pcs")).toBeInTheDocument();
    expect(screen.getByText("Received into inventory: 4000 each")).toBeInTheDocument();
    expect(screen.queryByText(/Pack \?/)).not.toBeInTheDocument();
    expect(screen.queryByText("MISSING INFORMATION")).not.toBeInTheDocument();
    expect(screen.queryByText(/manual review/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("Verified").length).toBeGreaterThan(0);
  });

  test("one canonical restaurant location is used automatically and the test location is ignored", async () => {
    const button = await openDocument(readyDocument({ receiving_location_id: null, branch_id: "khobar" }), [
      { id: "e2e", name: "NAC INVENTORY E2E TEST LOCATION", active: true, is_default_receiving: false, branch_id: "khobar" },
      { id: "restaurant", name: "NAC Khobar Restaurant", active: true, is_default_receiving: true, branch_id: "khobar", location_type: "restaurant" },
    ]);
    expect(button).toBeEnabled();
    expect(screen.getByTestId("receiving-location")).toHaveTextContent("Receiving at NAC Khobar Restaurant · automatic");
    expect(screen.queryByRole("button", { name: "Save receiving location" })).not.toBeInTheDocument();
  });

  test("company-settled null prices stay valid, and a missing location blocks posting", async () => {
    const button = await openDocument(readyDocument({ receiving_location_id: null }), []);
    expect(button).toBeDisabled();
    expect(screen.getByTestId("inventory-inbox")).toHaveTextContent(/Choose where this delivery was received/);
    expect(screen.getByText(/No receiving location is configured/)).toBeInTheDocument();
    fireEvent.click(button);
    expect(approveInvoice).not.toHaveBeenCalled();
  });

  test("two different SKUs linked to one incompatible item stay blocked", async () => {
    const button = await openDocument(readyDocument({
      inventory_invoice_lines: receivingLines.map((line) => (
        line.id === "wet" ? { ...line, ingredient_id: "paper" } : line
      )),
    }));
    expect(button).toBeDisabled();
    expect(screen.getByTestId("inventory-inbox")).toHaveTextContent(/Paper Bag/);
    fireEvent.click(button);
    expect(approveInvoice).not.toHaveBeenCalled();
  });
});
