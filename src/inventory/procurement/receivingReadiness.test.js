import { evaluateInvoiceReadiness, ingredientSuggestionIsSafe } from "./receivingReadiness";
import { suggestReceivingTreatment } from "./receivingPolicy";

const paper = { id: "paper", canonical_name: "Nac Printed Paper Bag - Each" };
const tissue = { id: "tissue", canonical_name: "Nac Printed Wet Tissue 1000 Pcs" };

describe("18426 readiness after Raffi's confirmations", () => {
  const invoice = {
    supplier_id: "ecowhiz",
    receiving_treatment: "company_settled_document",
    invoice_number: "18426",
  };
  const lines = [
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

  test("is ready when each SKU is its own item and the document treatment is confirmed", () => {
    const result = evaluateInvoiceReadiness({ invoice, lines, ingredients: [paper, tissue] });
    expect(result.ready).toBe(true);
    expect(result.headline).toBe("READY TO RECEIVE");
    expect(result.priceRequired).toBe(false);
    expect(result.lineState.map((line) => line.price.storedPrice)).toEqual([null, null]);
  });

  test("does not treat a shared word as a safe item match", () => {
    expect(ingredientSuggestionIsSafe("Nac Printed Wet Tissue 1000 Pcs", "Nac Printed Paper Bag - Each")).toBe(false);
    expect(ingredientSuggestionIsSafe("Nac Printed Paper Bag - Each", "Nac Printed Paper Bag - Each")).toBe(true);
  });

  test("blocks the wet-tissue line while it is still linked to the paper bag", () => {
    const result = evaluateInvoiceReadiness({
      invoice,
      lines: lines.map((line) => line.id === "wet" ? { ...line, ingredient_id: "paper" } : line),
      ingredients: [paper],
    });
    expect(result.ready).toBe(false);
    expect(result.headline).toBe("1 ACTION REMAINING");
    expect(result.summary).toMatch(/Paper Bag/);
  });

  test("a later priced Ecowhiz invoice is not settled just because 18426 was", () => {
    const suggestion = suggestReceivingTreatment({
      documentKind: "invoice",
      lines: [{ active: true, unit_price: 10, line_total: 20, supplier_sku: "2080534", original_quantity: 100 }],
      priorDecisions: [{ treatment: "company_settled_document", confirmed: true }],
    });
    expect(suggestion.treatment).toBe("normal_supplier_invoice");
    expect(suggestion.confirmed).toBe(false);
    const learned = evaluateInvoiceReadiness({
      invoice: { supplier_id: "ecowhiz", receiving_treatment: null },
      lines: [{
        id: "next",
        active: true,
        supplier_sku: "2080534",
        original_description: "Nac Printed Paper Bag - Each",
        original_quantity: 100,
        canonical_received_quantity: 100,
        canonical_unit: "each",
        conversion_factor: 1,
        review_status: "verified",
        ingredient_id: "paper",
        unit_price: 10,
        line_total: 1000,
      }],
      ingredients: [paper],
    });
    expect(learned.ready).toBe(false);
    expect(learned.actions).toContain("Choose how this document should be received.");
  });

  test("a later tissue delivery reuses the 1000-piece conversion without inheriting settlement", () => {
    const result = evaluateInvoiceReadiness({
      invoice: { supplier_id: "ecowhiz", receiving_treatment: null },
      lines: [{
        id: "next-tissue",
        active: true,
        supplier_sku: "2030912",
        original_description: "Nac Printed Wet Tissue 1000 Pcs",
        original_quantity: 3,
        canonical_received_quantity: 3000,
        canonical_unit: "each",
        conversion_factor: 1000,
        pack_status: "verified",
        learnedPack: true,
        review_status: "verified",
        ingredient_id: "tissue",
        unit_price: null,
        line_total: null,
      }],
      ingredients: [tissue],
    });
    expect(result.lineState[0].ready).toBe(true);
    expect(result.ready).toBe(false);
    expect(result.actions).toEqual(["Choose how this document should be received."]);
  });
});
