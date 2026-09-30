import { classifyInvoiceDuplicate } from "./duplicateEngine";
import { classifySupplierLineMapping } from "./mappingEngine";
import {
  companySettledPriceNotRequired,
  interpretSupplierPack,
  resolvePriceRequirement,
  supplierProfileFromRow,
} from "./receivingPolicy";

/**
 * Inventory Inbox status from structured evidence.
 * Uncertain lines stay in confirmation. Nothing here posts stock.
 */
export function triageInvoice({
  invoice = {},
  lines = [],
  existingInvoices = [],
  catalogueItems = [],
  ingredients = [],
  approvedMappings = [],
  supplierProfile = null,
  learnedPacks = {},
} = {}) {
  const profile = supplierProfile?.settlementMode ? supplierProfile : supplierProfileFromRow(supplierProfile);
  const channel = invoice.purchase_channel || invoice.purchaseChannel || "supplier_credit";
  const duplicate = classifyInvoiceDuplicate({
    candidate: {
      id: invoice.id,
      fileHash: invoice.file_hash || invoice.fileHash,
      supplierId: invoice.supplier_id || invoice.supplierId,
      invoiceNumber: invoice.invoice_number || invoice.invoiceNumber,
      invoiceDate: invoice.invoice_date || invoice.invoiceDate,
      total: invoice.total,
      status: invoice.status,
    },
    existing: existingInvoices,
  });

  const active = (lines || []).filter((line) => line.active !== false);
  const assessed = active.map((line) => {
    const review = line.review_status || line.reviewStatus;
    const sku = line.supplier_sku || line.supplierSku;
    const pack = interpretSupplierPack({
      description: line.original_description || line.originalDescription,
      quantity: line.original_quantity ?? line.quantity,
      learned: learnedPacks[sku] || (
        (line.pack_status || line.packStatus) === "verified"
          ? {
            status: "verified",
            conversionFactor: Number(line.conversion_factor || line.conversionFactor || 1),
            explanation: "Pack conversion verified on this line.",
          }
          : null
      ),
    });
    const price = resolvePriceRequirement({ profile, channel, line });
    if (review === "verified" || review === "auto_matched") {
      return {
        lineId: line.id,
        state: pack.blocksPosting ? "confirm_pack" : "recognized",
        confidence: Number(line.matching_confidence || line.confidence || 1),
        pack,
        price,
      };
    }
    const mapping = classifySupplierLineMapping({
      line: {
        supplierSku: sku,
        supplierId: invoice.supplier_id || invoice.supplierId,
        originalDescription: line.original_description || line.originalDescription,
      },
      catalogueItems,
      ingredients,
      approvedMappings,
    });
    const recognized = (mapping.state === "AUTO_MATCHED" || mapping.state === "APPROVED") && !pack.blocksPosting;
    return {
      lineId: line.id,
      state: pack.blocksPosting ? "confirm_pack" : (recognized ? "recognized" : "needs_confirmation"),
      confidence: mapping.confidence || 0,
      mappingState: mapping.state,
      pack,
      price,
    };
  });

  const recognized = assessed.filter((row) => row.state === "recognized").length;
  const missingQuantity = active.some((line) => {
    const qty = line.original_quantity ?? line.quantity;
    return qty == null || qty === "" || Number(qty) <= 0;
  });
  const priceRequired = assessed.some((row) => row.price?.basis === "price_missing_but_required");
  const packUncertain = assessed.some((row) => row.pack?.blocksPosting);
  const supplierMissing = !(invoice.supplier_id || invoice.supplierId);
  const priceNote = companySettledPriceNotRequired(profile, channel)
    ? "PRICE NOT REQUIRED — COMPANY SETTLED"
    : null;

  let tone = "ready";
  let headline = "READY TO RECEIVE";
  let label = priceNote ? "No pricing required — company settled" : "Ready to receive";
  if (duplicate.mayPost === false) {
    tone = "blocked";
    headline = "POSSIBLE DUPLICATE";
    label = "Possible duplicate document";
  } else if (!active.length) {
    tone = "blocked";
    headline = "BLOCKED";
    label = "No extracted lines";
  } else if (missingQuantity) {
    tone = "blocked";
    headline = "CONFIRM QUANTITY";
    label = "A received quantity is missing";
  } else if (priceRequired) {
    tone = "blocked";
    headline = "PRICE REQUIRED";
    label = "A purchase price is required for this receiving event";
  } else if (packUncertain) {
    tone = "confirm";
    headline = "CONFIRM PACK";
    label = "A pack conversion is not verified";
  } else if (supplierMissing) {
    tone = "confirm";
    headline = "CONFIRM SUPPLIER";
    label = "Confirm which supplier sent this document";
  } else if (recognized < active.length) {
    tone = "confirm";
    headline = "CONFIRM ITEM";
    label = `${active.length - recognized} item${active.length - recognized === 1 ? "" : "s"} need confirmation`;
  }

  return {
    tone,
    headline,
    label,
    priceNote,
    recognized,
    total: active.length,
    duplicate,
    lines: assessed,
    mayPost: tone === "ready",
  };
}
