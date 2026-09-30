import { classifySupplierLineMapping } from "./mappingEngine";
import { classifyInvoiceDuplicate } from "./duplicateEngine";
import { normalizePurchaseCost } from "./costNormalization";
import { nextHumanCode, assertCodeAvailable } from "./humanCodes";
import {
  classifyPurchaseChannel,
  crossSupplierOpportunity,
  sameSupplierPriceChange,
  PURCHASE_CHANNEL,
} from "./purchaseChannel";
import { triageInvoice } from "./inboxTriage";
import { detectProcurementAnomalies } from "./anomalies";
import { PACK_STATUS } from "./contracts";

describe("human inventory codes", () => {
  test("issues the next code and never reuses a retired number", () => {
    expect(nextHumanCode("FOOD", ["F1", "F2"]).code).toBe("F3");
    expect(nextHumanCode("CLEANING", ["C4", "CL2"]).code).toBe("CL3");
    expect(nextHumanCode("BAR", []).code).toBe("B1");
  });

  test("rejects a collision", () => {
    expect(assertCodeAvailable("F2", ["F2"]).ok).toBe(false);
    expect(assertCodeAvailable("F3", ["F2"]).ok).toBe(true);
  });
});

describe("supplier matching and duplicates", () => {
  test("a confirmed supplier SKU auto-matches and a lookalike stays a suggestion", () => {
    const auto = classifySupplierLineMapping({
      line: { supplierSku: "43872", supplierId: "sup-a", originalDescription: "AVO HASS MX 4KG" },
      catalogueItems: [{
        id: "cat-1",
        ingredientId: "ing-avocado",
        supplierSku: "43872",
        verificationState: "verified",
        normalizedProductName: "avocado",
      }],
      ingredients: [{ id: "ing-avocado", canonicalName: "Avocado" }],
    });
    expect(auto.state).toBe("AUTO_MATCHED");
    expect(auto.ingredientId).toBe("ing-avocado");
    expect(auto.canAffectCanonicalCost).toBe(true);

    const fuzzy = classifySupplierLineMapping({
      line: { originalDescription: "AVOCADO 4KG", supplierId: "sup-a" },
      catalogueItems: [],
      ingredients: [{ id: "ing-avocado", canonicalName: "Avocado" }],
    });
    expect(fuzzy.state).not.toBe("AUTO_MATCHED");
    expect(fuzzy.canAffectCanonicalCost).toBe(false);
  });

  test("the same supplier invoice number cannot post twice", () => {
    const result = classifyInvoiceDuplicate({
      candidate: { supplierId: "sup-a", invoiceNumber: "83921", status: "uploaded" },
      existing: [{ id: "old", supplierId: "sup-a", invoiceNumber: "83921", status: "posted" }],
    });
    expect(result.mayPost).toBe(false);
    expect(result.state).toBe("CONFIRMED_DUPLICATE");
  });
});

describe("units, price, and cash market", () => {
  test("missing quantity does not become a zero cost", () => {
    const cost = normalizePurchaseCost({
      exVatLineValue: "82",
      normalizedQuantity: null,
      normalizedUnit: "kilogram",
      packStatus: PACK_STATUS.OK,
    });
    expect(cost.value).toBeNull();
    expect(cost.status).toBe("MISSING_QUANTITY");
  });

  test("same-supplier price change uses the base unit and ignores a cash purchase", () => {
    const credit = sameSupplierPriceChange({
      previous: { supplierId: "a", costPerBase: 8.2, baseUnit: "kilogram", channel: PURCHASE_CHANNEL.SUPPLIER_CREDIT },
      next: { supplierId: "a", costPerBase: 9.1, baseUnit: "kilogram", channel: PURCHASE_CHANNEL.SUPPLIER_CREDIT },
    });
    expect(credit.direction).toBe("increase");
    expect(credit.delta).toBeCloseTo(0.9, 5);

    const cash = sameSupplierPriceChange({
      previous: { supplierId: "a", costPerBase: 8.9, baseUnit: "kilogram" },
      next: { supplierId: "a", costPerBase: 11.3, baseUnit: "kilogram", channel: PURCHASE_CHANNEL.CASH_MARKET },
    });
    expect(cash.comparable).toBe(false);
    expect(classifyPurchaseChannel({ channel: "cash", reason: "supplier_shortage" }).updatesSupplierPriceHistory).toBe(false);
  });

  test("cross-supplier comparison refuses different units", () => {
    const blocked = crossSupplierOpportunity({
      current: { supplierId: "a", costPerBase: 24.5, baseUnit: "kilogram" },
      alternative: { supplierId: "b", costPerBase: 22.8, baseUnit: "each" },
    });
    expect(blocked.comparable).toBe(false);

    const open = crossSupplierOpportunity({
      current: { supplierId: "a", costPerBase: 24.5, baseUnit: "kilogram" },
      alternative: { supplierId: "b", costPerBase: 22.8, baseUnit: "kilogram" },
    });
    expect(open.cheaperSupplierId).toBe("b");
  });
});

describe("inventory inbox", () => {
  test("a missing price blocks posting and a confirmed line can post", () => {
    const blocked = triageInvoice({
      invoice: { id: "new", supplier_id: "a", invoice_number: "1" },
      lines: [{ id: "l1", active: true, review_status: "verified", original_quantity: 2, unit_price: null }],
    });
    expect(blocked.mayPost).toBe(false);
    expect(blocked.tone).toBe("blocked");

    const ready = triageInvoice({
      invoice: { id: "new", supplier_id: "a", invoice_number: "2" },
      lines: [{ id: "l1", active: true, review_status: "verified", original_quantity: 2, unit_price: 9 }],
    });
    expect(ready.mayPost).toBe(true);
    expect(ready.label).toBe("Ready to post");
  });

  test("price spike is a warning, not a posted fact", () => {
    const result = detectProcurementAnomalies({
      line: { unitCost: 11, originalQuantity: 1, unitPrice: 11, lineTotal: 11 },
      previousUnitCost: 8,
      pack: { status: PACK_STATUS.OK },
      mapping: { state: "APPROVED", ingredientId: "ing" },
      duplicate: { state: "NEW", mayPost: true },
    });
    expect(result.warnings.map((row) => row.code)).toContain("PRICE_SPIKE");
  });
});
