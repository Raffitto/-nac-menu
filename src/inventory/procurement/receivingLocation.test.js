import { resolvePriceRequirement } from "./receivingPolicy";
import { evaluateInvoiceReadiness } from "./receivingReadiness";
import { isOperationalReceivingLocation, resolveReceivingLocation } from "./receivingLocation";

const restaurant = {
  id: "khobar-restaurant",
  branch_id: "khobar",
  name: "NAC Khobar Restaurant",
  active: true,
  is_default_receiving: true,
  location_type: "restaurant",
};
const testLocation = {
  id: "e2e",
  branch_id: "khobar",
  name: "NAC INVENTORY E2E TEST LOCATION",
  active: true,
  is_default_receiving: false,
  location_type: "store",
};
const riyadh = {
  id: "riyadh-restaurant",
  branch_id: "riyadh",
  name: "NAC Riyadh Restaurant",
  active: true,
  is_default_receiving: true,
  location_type: "restaurant",
};

const paper = { id: "paper", canonical_name: "Nac Printed Paper Bag - Each" };
const tissue = { id: "tissue", canonical_name: "Nac Printed Wet Tissue 1000 Pcs" };
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

describe("branch restaurant receiving location", () => {
  test("uses NAC Khobar Restaurant automatically and never the E2E fixture", () => {
    expect(isOperationalReceivingLocation(testLocation)).toBe(false);
    expect(isOperationalReceivingLocation(restaurant)).toBe(true);
    const resolved = resolveReceivingLocation({
      explicitLocationId: null,
      locations: [testLocation, restaurant],
      branchId: "khobar",
    });
    expect(resolved.location.name).toBe("NAC Khobar Restaurant");
    expect(resolved.source).toBe("default");
    expect(resolved.requiresChoice).toBe(false);
    expect(resolved.location.id).not.toBe(testLocation.id);
  });

  test("an explicit operational location wins over the branch default", () => {
    const dock = { ...restaurant, id: "future-dock", name: "Future dock", is_default_receiving: false };
    const resolved = resolveReceivingLocation({
      explicitLocationId: "future-dock",
      locations: [restaurant, dock],
      branchId: "khobar",
    });
    expect(resolved.location.id).toBe("future-dock");
    expect(resolved.source).toBe("explicit");
  });

  test("one operational location is used even when it is not flagged default", () => {
    const only = { ...restaurant, is_default_receiving: false };
    const resolved = resolveReceivingLocation({
      locations: [testLocation, only],
      branchId: "khobar",
    });
    expect(resolved.location.id).toBe(only.id);
    expect(resolved.source).toBe("only");
  });

  test("no operational location is not ready, and several real locations ask for a choice", () => {
    expect(resolveReceivingLocation({ locations: [testLocation], branchId: "khobar" }).source).toBe("missing");
    const second = { ...restaurant, id: "second", name: "Second real location", is_default_receiving: false };
    const many = resolveReceivingLocation({
      locations: [{ ...restaurant, is_default_receiving: false }, second],
      branchId: "khobar",
    });
    expect(many.requiresChoice).toBe(true);
    expect(many.location).toBeNull();
  });

  test("Khobar resolution does not select the Riyadh restaurant", () => {
    const resolved = resolveReceivingLocation({
      locations: [riyadh, restaurant],
      branchId: "khobar",
    });
    expect(resolved.location.branch_id).toBe("khobar");
  });

  test("18426 is ready at the restaurant without a manual location, with quantities and null prices unchanged", () => {
    const resolved = resolveReceivingLocation({
      locations: [testLocation, restaurant],
      branchId: "khobar",
    });
    const readiness = evaluateInvoiceReadiness({
      invoice: {
        supplier_id: "ecowhiz",
        receiving_treatment: "company_settled_document",
        hasReceivingLocation: Boolean(resolved.location),
      },
      lines,
      ingredients: [paper, tissue],
    });
    expect(readiness.ready).toBe(true);
    expect(readiness.priceRequired).toBe(false);
    expect(lines.map((line) => [line.supplier_sku, line.ingredient_id, line.canonical_received_quantity, line.unit_price])).toEqual([
      ["2080534", "paper", 250, null],
      ["2030912", "tissue", 4000, null],
    ]);
    expect(paper.id).not.toBe(tissue.id);
  });

  test("a normal supplier invoice and a cash purchase still require a price", () => {
    const normal = evaluateInvoiceReadiness({
      invoice: {
        supplier_id: "ecowhiz",
        receiving_treatment: "normal_supplier_invoice",
        hasReceivingLocation: true,
      },
      lines: lines.map((line) => ({ ...line, unit_price: null, line_total: null })),
      ingredients: [paper, tissue],
    });
    expect(normal.ready).toBe(false);
    expect(normal.priceRequired).toBe(true);
    expect(resolvePriceRequirement({
      treatment: "cash_market",
      line: { unit_price: null, line_total: null },
    }).required).toBe(true);
  });
});
