/**
 * Deterministic receiving intelligence.
 * OCR supplies fields. Verified supplier policy and mappings decide.
 * Missing price is null, never zero. Nothing here posts stock.
 */

export const SETTLEMENT_MODE = Object.freeze({
  UNKNOWN: "unknown",
  SUPPLIER_CREDIT: "supplier_credit",
  COMPANY_SETTLED: "company_settled",
  CASH_MARKET: "cash_market",
});

export const COST_BASIS = Object.freeze({
  ACTUAL: "actual_document_price",
  COMPANY_SETTLED: "company_settled_price_not_required",
  MISSING_REQUIRED: "price_missing_but_required",
  HISTORICAL_ONLY: "historical_reference_only",
});

export const DOCUMENT_KIND = Object.freeze({
  INVOICE: "invoice",
  DELIVERY_NOTE: "delivery_note",
  CREDIT_NOTE: "credit_note",
  CASH_RECEIPT: "cash_receipt",
  OTHER: "other",
});

const FAMILY_RULES = [
  { family: "CL", label: "Cleaning", pattern: /\b(detergent|sanitiser|sanitizer|bleach|soap|degreaser|disinfectant)\b/i },
  { family: "P", label: "Packaging", pattern: /\b(paper bag|packaging|carton|napkin|cup|lid|container|box|wrapper)\b/i },
  { family: "C", label: "Consumable", pattern: /\b(tissue|glove|foil|cling|towel|wipe|straw|sticker)\b/i },
  { family: "B", label: "Bar", pattern: /\b(syrup|bitters|liqueur|wine|beer|spirit)\b/i },
  { family: "E", label: "Equipment", pattern: /\b(knife|thermometer|scale|blender|machine)\b/i },
  { family: "M", label: "Maintenance", pattern: /\b(filter|bulb|battery|gasket)\b/i },
  { family: "F", label: "Food", pattern: /\b(tomato|chicken|beef|flour|oil|cheese|milk|egg|rice|herb)\b/i },
];

export function priceIsPresent(value) {
  return value != null && value !== "";
}

export function supplierProfileFromRow(row = null) {
  if (!row) {
    return {
      settlementMode: SETTLEMENT_MODE.UNKNOWN,
      priceRequiredOnReceiving: null,
      skuReliability: "unknown",
      confirmed: false,
    };
  }
  return {
    supplierId: row.id,
    supplierName: row.supplier_name || row.supplierName || null,
    settlementMode: row.settlement_mode || row.settlementMode || SETTLEMENT_MODE.UNKNOWN,
    priceRequiredOnReceiving: row.price_required_on_receiving ?? row.priceRequiredOnReceiving ?? null,
    skuReliability: row.sku_reliability || row.skuReliability || "unknown",
    confirmed: Boolean(row.profile_confirmed_at || row.profileConfirmedAt),
    confirmedBy: row.profile_confirmed_by || row.profileConfirmedBy || null,
    confirmedAt: row.profile_confirmed_at || row.profileConfirmedAt || null,
  };
}

export function companySettledPriceNotRequired(profile, channel = "supplier_credit") {
  if (channel === "cash_market") return false;
  return profile?.settlementMode === SETTLEMENT_MODE.COMPANY_SETTLED
    && profile?.priceRequiredOnReceiving === false;
}

/**
 * Whether this receiving event needs a document price.
 * Null stays null. Zero is not used as a stand-in.
 */
export function resolvePriceRequirement({
  profile = null,
  channel = "supplier_credit",
  line = {},
} = {}) {
  const unitPrice = line.unit_price ?? line.unitPrice;
  const lineTotal = line.line_total ?? line.lineTotal;
  const present = priceIsPresent(unitPrice) || priceIsPresent(lineTotal);
  if (channel === "cash_market") {
    return {
      required: true,
      basis: present ? COST_BASIS.ACTUAL : COST_BASIS.MISSING_REQUIRED,
      updatesSupplierPriceHistory: false,
      updatesWeightedAverage: present,
      storedPrice: present ? (unitPrice ?? lineTotal) : null,
    };
  }
  if (companySettledPriceNotRequired(profile, channel)) {
    return {
      required: false,
      basis: COST_BASIS.COMPANY_SETTLED,
      updatesSupplierPriceHistory: false,
      updatesWeightedAverage: false,
      storedPrice: present ? (unitPrice ?? lineTotal) : null,
    };
  }
  return {
    required: true,
    basis: present ? COST_BASIS.ACTUAL : COST_BASIS.MISSING_REQUIRED,
    updatesSupplierPriceHistory: present && channel !== "cash_market",
    updatesWeightedAverage: present,
    storedPrice: present ? (unitPrice ?? lineTotal) : null,
  };
}

export function classifyDocumentKind(text = "") {
  const value = String(text || "").toLowerCase();
  if (!value.trim()) return null;
  if (value.includes("credit note")) return DOCUMENT_KIND.CREDIT_NOTE;
  if (value.includes("delivery note") || value.includes("delivery no")) return DOCUMENT_KIND.DELIVERY_NOTE;
  if (value.includes("cash receipt") || value.includes("paid cash")) return DOCUMENT_KIND.CASH_RECEIPT;
  if (value.includes("tax invoice") || value.includes("invoice")) return DOCUMENT_KIND.INVOICE;
  return null;
}

export function suggestCodeFamily(description = "") {
  const text = String(description || "");
  const match = FAMILY_RULES.find((rule) => rule.pattern.test(text));
  if (!match) {
    return { family: null, label: null, confidence: 0, reason: "No verified wording rule. Choose a family. Food is not the default." };
  }
  return {
    family: match.family,
    label: match.label,
    confidence: 0.7,
    reason: `Wording matches ${match.label.toLowerCase()}. This is a suggestion, not an allocated code.`,
    allocatesCode: false,
  };
}

export function interpretSupplierPack({
  description = "",
  quantity = null,
  learned = null,
} = {}) {
  if (learned?.status === "verified" && learned.conversionFactor > 0) {
    return {
      status: "verified",
      blocksPosting: false,
      conversionFactor: learned.conversionFactor,
      explanation: learned.explanation || "Verified supplier pack conversion.",
      provenance: learned.provenance || null,
    };
  }
  const pack = String(description || "").match(/(\d+(?:\.\d+)?)\s*pcs\b/i);
  if (pack && quantity != null && Number(pack[1]) !== Number(quantity)) {
    return {
      status: "uncertain",
      blocksPosting: true,
      statedPackSize: Number(pack[1]),
      documentQuantity: Number(quantity),
      explanation: `The description says ${pack[1]} pcs and the document quantity is ${quantity}. Confirm whether that quantity is packs before it can affect stock.`,
    };
  }
  return {
    status: "not_applicable",
    blocksPosting: false,
    explanation: "No conflicting pack size is written on this line.",
  };
}

export function commercialPriceComparable(row = null) {
  if (!row) return false;
  if (row.costBasis && row.costBasis !== COST_BASIS.ACTUAL) return false;
  if (!priceIsPresent(row.costPerBase)) return false;
  return true;
}

export function fieldConfidence(fields = {}) {
  return {
    supplier: fields.supplier ?? null,
    documentNumber: fields.documentNumber ?? null,
    date: fields.date ?? null,
    sku: fields.sku ?? null,
    itemMapping: fields.itemMapping ?? null,
    quantity: fields.quantity ?? null,
    unit: fields.unit ?? null,
    packConversion: fields.packConversion ?? null,
    price: fields.price ?? null,
    receivingLocation: fields.receivingLocation ?? null,
    supplierPolicy: fields.supplierPolicy ?? null,
  };
}
