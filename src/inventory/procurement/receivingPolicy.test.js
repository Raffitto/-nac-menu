import { nextHumanCode } from "./humanCodes";
import { triageInvoice } from "./inboxTriage";
import {
  commercialPriceComparable,
  COST_BASIS,
  interpretSupplierPack,
  resolvePriceRequirement,
  SETTLEMENT_MODE,
  suggestCodeFamily,
} from "./receivingPolicy";

const ECOWHIZ_18426 = {
  supplierWording: "Ecowhiz Industries Company",
  documentNumber: "18426",
  documentDate: "2026-09-27",
  lines: [
    {
      id: "bag",
      sku: "2080534",
      description: "Nac Printed Paper Bag - Each",
      quantity: 250,
      unit: "Each",
      unitPrice: null,
      lineTotal: null,
    },
    {
      id: "tissue",
      sku: "2030912",
      description: "Nac Printed Wet Tissue 1000 Pcs",
      quantity: 4,
      unit: null,
      unitPrice: null,
      lineTotal: null,
    },
  ],
};

const COMPANY_SETTLED = {
  settlementMode: SETTLEMENT_MODE.COMPANY_SETTLED,
  priceRequiredOnReceiving: false,
  confirmed: true,
};

describe("Ecowhiz 18426 receiving understanding", () => {
  test("keeps both extracted lines and does not turn a missing price into zero", () => {
    expect(ECOWHIZ_18426.lines.map((line) => line.unitPrice)).toEqual([null, null]);
    expect(ECOWHIZ_18426.lines.map((line) => line.lineTotal)).toEqual([null, null]);
    for (const line of ECOWHIZ_18426.lines) {
      const decision = resolvePriceRequirement({
        profile: null,
        line: { unit_price: line.unitPrice, line_total: line.lineTotal },
      });
      expect(decision.storedPrice).toBeNull();
      expect(decision.storedPrice).not.toBe(0);
      expect(decision.basis).toBe(COST_BASIS.MISSING_REQUIRED);
    }
  });

  test("unknown supplier policy still requires a price, and a confirmed company-settled profile does not", () => {
    const bag = { unit_price: null, line_total: null, original_quantity: 250 };
    expect(resolvePriceRequirement({ profile: null, line: bag }).required).toBe(true);
    const settled = resolvePriceRequirement({ profile: COMPANY_SETTLED, line: bag });
    expect(settled.required).toBe(false);
    expect(settled.basis).toBe(COST_BASIS.COMPANY_SETTLED);
    expect(settled.updatesSupplierPriceHistory).toBe(false);
    expect(settled.updatesWeightedAverage).toBe(false);
    expect(settled.storedPrice).toBeNull();
  });

  test("cash market and ordinary credit still require an actual price", () => {
    const line = { unit_price: null, line_total: null };
    expect(resolvePriceRequirement({ profile: COMPANY_SETTLED, channel: "cash_market", line }).required).toBe(true);
    expect(resolvePriceRequirement({
      profile: { settlementMode: SETTLEMENT_MODE.SUPPLIER_CREDIT, priceRequiredOnReceiving: true },
      line,
    }).basis).toBe(COST_BASIS.MISSING_REQUIRED);
    expect(resolvePriceRequirement({
      profile: { settlementMode: SETTLEMENT_MODE.SUPPLIER_CREDIT, priceRequiredOnReceiving: true },
      line: { unit_price: 8.2, line_total: 16.4 },
    })).toMatchObject({
      required: true,
      basis: COST_BASIS.ACTUAL,
      updatesSupplierPriceHistory: true,
      storedPrice: 8.2,
    });
  });

  test("wet tissue pack stays uncertain until a verified conversion exists", () => {
    const tissue = ECOWHIZ_18426.lines[1];
    const unknown = interpretSupplierPack({ description: tissue.description, quantity: tissue.quantity });
    expect(unknown.status).toBe("uncertain");
    expect(unknown.blocksPosting).toBe(true);
    expect(unknown.statedPackSize).toBe(1000);
    const learned = interpretSupplierPack({
      description: tissue.description,
      quantity: tissue.quantity,
      learned: {
        status: "verified",
        conversionFactor: 1000,
        explanation: "1 supplier unit = 1000 pcs",
        provenance: "verified supplier SKU 2030912",
      },
    });
    expect(learned.blocksPosting).toBe(false);
    expect(learned.conversionFactor).toBe(1000);
  });

  test("paper bag quantity does not invent a pack conflict", () => {
    const bag = ECOWHIZ_18426.lines[0];
    expect(interpretSupplierPack({ description: bag.description, quantity: bag.quantity }).blocksPosting).toBe(false);
  });

  test("suggests packaging and consumable families without allocating a code or defaulting to food", () => {
    const bag = suggestCodeFamily(ECOWHIZ_18426.lines[0].description);
    const tissue = suggestCodeFamily(ECOWHIZ_18426.lines[1].description);
    expect(bag.family).toBe("P");
    expect(tissue.family).toBe("C");
    expect(bag.allocatesCode).toBe(false);
    expect(tissue.allocatesCode).toBe(false);
    expect(suggestCodeFamily("mystery item").family).toBeNull();
    expect(nextHumanCode(null, []).code).toBeNull();
  });

  test("company-settled quantity evidence cannot be compared as a supplier price", () => {
    expect(commercialPriceComparable({
      costPerBase: null,
      costBasis: COST_BASIS.COMPANY_SETTLED,
      baseUnit: "each",
    })).toBe(false);
    expect(commercialPriceComparable({
      costPerBase: 9.1,
      costBasis: COST_BASIS.ACTUAL,
      baseUnit: "kilogram",
    })).toBe(true);
  });
});

describe("exception inbox for quantity-only receiving", () => {
  const lines = ECOWHIZ_18426.lines.map((line) => ({
    id: line.id,
    active: true,
    supplier_sku: line.sku,
    original_description: line.description,
    original_quantity: line.quantity,
    original_unit: line.unit,
    unit_price: line.unitPrice,
    line_total: line.lineTotal,
    review_status: "needs_review",
  }));

  test("asks for a price until the supplier profile says it is not required", () => {
    const blocked = triageInvoice({
      invoice: { id: "18426", supplier_id: "ecowhiz", invoice_number: "18426" },
      lines,
    });
    expect(blocked.mayPost).toBe(false);
    expect(blocked.headline).toBe("PRICE REQUIRED");

    const settled = triageInvoice({
      invoice: { id: "18426", supplier_id: "ecowhiz", invoice_number: "18426" },
      lines,
      supplierProfile: COMPANY_SETTLED,
    });
    expect(settled.mayPost).toBe(false);
    expect(settled.headline).toBe("CONFIRM PACK");
    expect(settled.priceNote).toBe("PRICE NOT REQUIRED — COMPANY SETTLED");
  });

  test("a verified company-settled document with a learned pack can be ready to receive", () => {
    const ready = triageInvoice({
      invoice: { id: "18427", supplier_id: "ecowhiz", invoice_number: "18427", supplier_id_present: true },
      lines: lines.map((line) => ({ ...line, review_status: "verified" })),
      supplierProfile: COMPANY_SETTLED,
      learnedPacks: {
        2030912: { status: "verified", conversionFactor: 1000 },
      },
    });
    expect(ready.headline).toBe("READY TO RECEIVE");
    expect(ready.mayPost).toBe(true);
    expect(ready.priceNote).toBe("PRICE NOT REQUIRED — COMPANY SETTLED");
  });
});
