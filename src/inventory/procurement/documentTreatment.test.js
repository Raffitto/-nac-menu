import { suggestReceivingTreatment, resolvePriceRequirement, RECEIVING_TREATMENT } from "./receivingPolicy";

const unpriced = [
  { active: true, unit_price: null, line_total: null, original_quantity: 250 },
  { active: true, unit_price: null, line_total: null, original_quantity: 4 },
];
const priced = [
  { active: true, unit_price: 12.5, line_total: 25, original_quantity: 2 },
];

describe("Ecowhiz documents do not share one commercial treatment", () => {
  const documentA = suggestReceivingTreatment({
    documentKind: "delivery_note",
    lines: unpriced,
  });

  test("document A, a price-less delivery note, is only a suggestion", () => {
    expect(documentA.treatment).toBe(RECEIVING_TREATMENT.COMPANY_SETTLED_DOCUMENT);
    expect(documentA.confirmed).toBe(false);
    expect(documentA.authoritativeFromHistory).toBe(false);
    expect(documentA.reason).toMatch(/delivery note and contains no prices/);
    const beforeConfirm = resolvePriceRequirement({ treatment: null, line: unpriced[0] });
    expect(beforeConfirm.required).toBe(true);
    expect(beforeConfirm.storedPrice).toBeNull();
    const afterConfirm = resolvePriceRequirement({
      treatment: RECEIVING_TREATMENT.COMPANY_SETTLED_DOCUMENT,
      line: unpriced[0],
    });
    expect(afterConfirm.required).toBe(false);
    expect(afterConfirm.updatesSupplierPriceHistory).toBe(false);
    expect(afterConfirm.updatesWeightedAverage).toBe(false);
    expect(afterConfirm.storedPrice).toBeNull();
  });

  test("document B, a later priced invoice, is a normal invoice even after A was confirmed", () => {
    const suggestion = suggestReceivingTreatment({
      documentKind: "invoice",
      lines: priced,
      priorDecisions: [{ treatment: RECEIVING_TREATMENT.COMPANY_SETTLED_DOCUMENT, confirmed: true }],
    });
    expect(suggestion.treatment).toBe(RECEIVING_TREATMENT.NORMAL);
    expect(suggestion.authoritativeFromHistory).toBe(false);
    const price = resolvePriceRequirement({ treatment: suggestion.treatment, line: priced[0] });
    expect(price.required).toBe(true);
    expect(price.updatesSupplierPriceHistory).toBe(true);
    expect(price.storedPrice).toBe(12.5);
  });

  test("document C, a later price-less delivery note, is suggested again and not inherited", () => {
    const suggestion = suggestReceivingTreatment({
      documentKind: "delivery_note",
      lines: unpriced,
      priorDecisions: [{ treatment: RECEIVING_TREATMENT.COMPANY_SETTLED_DOCUMENT, confirmed: true }],
    });
    expect(suggestion.treatment).toBe(RECEIVING_TREATMENT.COMPANY_SETTLED_DOCUMENT);
    expect(suggestion.confirmed).toBe(false);
    expect(suggestion.authoritativeFromHistory).toBe(false);
    expect(suggestion.reason).toMatch(/does not decide this one/);
    expect(resolvePriceRequirement({ treatment: null, line: unpriced[0] }).required).toBe(true);
  });

  test("an invoice with no prices is not assumed company-settled", () => {
    const suggestion = suggestReceivingTreatment({ documentKind: "invoice", lines: unpriced });
    expect(suggestion.treatment).toBeNull();
    expect(suggestion.reason).toMatch(/not assumed/);
  });
});
