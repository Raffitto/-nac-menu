import { normalizeText } from "../inventoryIntelligence";

const GENERIC_TOKENS = new Set([
  "company", "industries", "industry", "trading", "limited", "establishment", "supplier",
]);

export function digitsOnly(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits || null;
}

export function supplierWordingFromInvoice(invoice = {}) {
  const extracted = invoice.structured_extraction || invoice.structuredExtraction || {};
  const name = String(extracted.supplierName || "").trim();
  return {
    name: name || null,
    vat: digitsOnly(extracted.supplierVatNumber),
  };
}

function candidate(supplier, strength) {
  return {
    id: supplier.id,
    name: supplier.supplier_name || supplier.supplierName,
    vat: digitsOnly(supplier.vat_number || supplier.vatNumber),
    strength,
  };
}

function distinctiveTokens(name) {
  return normalizeText(name).split(" ").filter((token) => token.length >= 6 && !GENERIC_TOKENS.has(token));
}

/**
 * Exact VAT must be used. A similar name is only a candidate.
 * Nothing here creates a supplier.
 */
export function classifySupplierCandidates({ name = "", vat = null, suppliers = [] } = {}) {
  const normalized = normalizeText(name);
  const vatDigits = digitsOnly(vat);
  const vatMatches = vatDigits
    ? suppliers.filter((supplier) => digitsOnly(supplier.vat_number || supplier.vatNumber) === vatDigits)
    : [];
  if (vatMatches.length) {
    return {
      decision: "use_existing",
      allowSeparate: false,
      candidates: vatMatches.map((supplier) => candidate(supplier, "vat")),
    };
  }

  const exactName = suppliers.filter((supplier) => (
    normalizeText(supplier.supplier_name || supplier.supplierName) === normalized
    || normalizeText(supplier.legal_name || supplier.legalName) === normalized
  ));
  const tokens = distinctiveTokens(name);
  const fuzzy = suppliers.filter((supplier) => {
    if (exactName.includes(supplier)) return false;
    const other = normalizeText(`${supplier.supplier_name || ""} ${supplier.legal_name || ""}`);
    return tokens.some((token) => other.includes(token));
  });
  const candidates = [
    ...exactName.map((supplier) => candidate(supplier, "normalized_name")),
    ...fuzzy.map((supplier) => candidate(supplier, "possible_name")),
  ];
  if (!candidates.length) return { decision: "create", allowSeparate: true, candidates: [] };
  return { decision: "choose", allowSeparate: true, candidates };
}

export const RECEIVING_POLICY_CHOICES = Object.freeze([
  {
    id: "normal_supplier_invoice",
    treatment: "normal_supplier_invoice",
    title: "Normal supplier invoice",
    detail: "Prices on this document are required and used for purchasing history.",
  },
  {
    id: "company_settled_document",
    treatment: "company_settled_document",
    title: "Company already settled this delivery",
    detail: "Prices are not required for this document. Quantities will be received without treating them as free stock.",
  },
  {
    id: "cash_market",
    treatment: "cash_market",
    title: "Cash / local market purchase",
    detail: "Enter the amount actually paid.",
  },
]);

export function packCountChoices({ description = "", quantity = null } = {}) {
  const match = String(description).match(/(\d+(?:\.\d+)?)\s*pcs\b/i);
  const qty = Number(quantity);
  if (!match || !Number.isFinite(qty) || qty <= 0) return [];
  const pieces = Number(match[1]);
  if (pieces === qty) return [];
  return [
    {
      id: "packs",
      title: `Track packs. Received ${qty} packs. 1 pack = ${pieces} pieces.`,
      canonicalQuantity: String(qty),
      conversionFactor: "1",
      canonicalUnit: "each",
      piecesPerSupplierUnit: pieces,
      interpretation: "packs",
    },
    {
      id: "pieces",
      title: `Track individual pieces. Received ${qty * pieces} pieces.`,
      canonicalQuantity: String(qty * pieces),
      conversionFactor: String(pieces),
      canonicalUnit: "each",
      piecesPerSupplierUnit: pieces,
      interpretation: "pieces",
    },
  ];
}

export function knowledgeCorrection({ previous, next, reason }) {
  if (!String(reason || "").trim()) {
    throw new Error("A reason is required before learned supplier knowledge can change.");
  }
  return {
    previous,
    next,
    reason: String(reason).trim(),
    rewritesHistoricalReceipts: false,
  };
}
