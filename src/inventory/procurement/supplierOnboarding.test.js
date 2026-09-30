import { triageInvoice } from "./inboxTriage";
import {
  classifySupplierCandidates,
  knowledgeCorrection,
  packCountChoices,
  RECEIVING_POLICY_CHOICES,
  supplierWordingFromInvoice,
} from "./supplierOnboarding";
import { suggestCodeFamily } from "./receivingPolicy";

const ECOWHIZ_INVOICE = {
  invoice_number: "18426",
  invoice_date: "2026-09-27",
  supplier_id: null,
  structured_extraction: {
    supplierName: "Ecowhiz Industries Company",
    supplierVatNumber: "311462249600003",
  },
  inventory_invoice_lines: [
    {
      id: "bag",
      active: true,
      supplier_sku: "2080534",
      original_description: "Nac Printed Paper Bag - Each",
      original_quantity: 250,
      original_unit: "Each",
      unit_price: null,
      line_total: null,
      review_status: "needs_review",
    },
    {
      id: "tissue",
      active: true,
      supplier_sku: "2030912",
      original_description: "Nac Printed Wet Tissue 1000 Pcs",
      original_quantity: 4,
      unit_price: null,
      line_total: null,
      review_status: "needs_review",
    },
  ],
};

describe("first-time supplier onboarding", () => {
  test("reads the OCR supplier name and VAT without inventing contact fields", () => {
    expect(supplierWordingFromInvoice(ECOWHIZ_INVOICE)).toEqual({
      name: "Ecowhiz Industries Company",
      vat: "311462249600003",
    });
    expect(supplierWordingFromInvoice({})).toEqual({ name: null, vat: null });
  });

  test("an exact VAT must be reused and a similar name stays a choice", () => {
    const suppliers = [
      { id: "vat-hit", supplier_name: "Ecowhiz Industries", vat_number: "311462249600003" },
      { id: "name-hit", supplier_name: "Other Packaging Company", vat_number: null },
    ];
    const vat = classifySupplierCandidates({
      name: "Ecowhiz Industries Company",
      vat: "311462249600003",
      suppliers,
    });
    expect(vat.decision).toBe("use_existing");
    expect(vat.allowSeparate).toBe(false);
    expect(vat.candidates.map((row) => row.id)).toEqual(["vat-hit"]);

    const fuzzy = classifySupplierCandidates({
      name: "Ecowhiz Industries Company",
      vat: null,
      suppliers: [{ id: "similar", supplier_name: "Ecowhiz Trading", vat_number: null }],
    });
    expect(fuzzy.decision).toBe("choose");
    expect(fuzzy.allowSeparate).toBe(true);
    expect(fuzzy.candidates[0].strength).toBe("possible_name");
  });

  test("does not treat a generic word as a supplier match", () => {
    const result = classifySupplierCandidates({
      name: "Ecowhiz Industries Company",
      suppliers: [{ id: "other", supplier_name: "National Company", vat_number: null }],
    });
    expect(result.decision).toBe("create");
    expect(result.candidates).toEqual([]);
  });

  test("document choices are explicit and none is preselected", () => {
    expect(RECEIVING_POLICY_CHOICES.map((choice) => choice.id)).toEqual([
      "normal_supplier_invoice",
      "company_settled_document",
      "cash_market",
    ]);
    expect(RECEIVING_POLICY_CHOICES.every((choice) => choice.treatment === choice.id)).toBe(true);
  });

  test("paper bags suggest packaging and tissue suggests consumable without allocating a code", () => {
    expect(suggestCodeFamily("Nac Printed Paper Bag - Each").family).toBe("P");
    expect(suggestCodeFamily("Nac Printed Wet Tissue 1000 Pcs").family).toBe("C");
    expect(suggestCodeFamily("Nac Printed Paper Bag - Each").allocatesCode).toBe(false);
  });

  test("tissue pack choices stay unselected until the manager chooses", () => {
    const choices = packCountChoices({
      description: "Nac Printed Wet Tissue 1000 Pcs",
      quantity: 4,
    });
    expect(choices.map((choice) => choice.id)).toEqual(["packs", "pieces"]);
    expect(choices[0].canonicalQuantity).toBe("4");
    expect(choices[1].canonicalQuantity).toBe("4000");
  });

  test("a later Ecowhiz document reuses the SKU pack only when this document is confirmed", () => {
    const lines = ECOWHIZ_INVOICE.inventory_invoice_lines.map((line) => ({
      ...line,
      review_status: "verified",
      ingredient_id: line.id === "bag" ? "paper" : "tissue",
      canonical_received_quantity: line.id === "bag" ? 250 : 4000,
      canonical_unit: "each",
      conversion_factor: line.id === "tissue" ? 1000 : 1,
      pack_status: line.id === "tissue" ? "verified" : null,
    }));
    const ingredients = [
      { id: "paper", canonical_name: "Nac Printed Paper Bag - Each" },
      { id: "tissue", canonical_name: "Nac Printed Wet Tissue 1000 Pcs" },
    ];
    const inherited = triageInvoice({
      invoice: { id: "18499", supplier_id: "ecowhiz", invoice_number: "18499" },
      lines,
      ingredients,
      supplierProfile: { settlementMode: "company_settled", priceRequiredOnReceiving: false, confirmed: true },
      learnedPacks: { 2030912: { status: "verified", conversionFactor: 1 } },
    });
    expect(inherited.headline).toBe("1 ACTION REMAINING");
    expect(inherited.mayPost).toBe(false);

    const ready = triageInvoice({
      invoice: {
        id: "18499",
        supplier_id: "ecowhiz",
        invoice_number: "18499",
        receiving_treatment: "company_settled_document",
      },
      lines,
      ingredients,
      learnedPacks: { 2030912: { status: "verified", conversionFactor: 1 } },
    });
    expect(ready.headline).toBe("READY TO RECEIVE");
    expect(ready.priceNote).toBe("PRICE NOT REQUIRED — THIS DOCUMENT");
    expect(ready.mayPost).toBe(true);
  });

  test("correcting learned knowledge does not rewrite a historical receipt", () => {
    const correction = knowledgeCorrection({
      previous: { interpretation: "pieces" },
      next: { interpretation: "packs" },
      reason: "Restaurant counts packs, not loose pieces",
    });
    expect(correction.rewritesHistoricalReceipts).toBe(false);
    expect(() => knowledgeCorrection({ previous: {}, next: {}, reason: "" })).toThrow(/reason/);
  });
});
