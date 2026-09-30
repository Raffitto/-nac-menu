import { classifyInvoiceDuplicate } from "./duplicateEngine";
import { classifySupplierLineMapping } from "./mappingEngine";

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
} = {}) {
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
    if (review === "verified" || review === "auto_matched") {
      return { lineId: line.id, state: "recognized", confidence: Number(line.matching_confidence || line.confidence || 1) };
    }
    const mapping = classifySupplierLineMapping({
      line: {
        supplierSku: line.supplier_sku || line.supplierSku,
        supplierId: invoice.supplier_id || invoice.supplierId,
        originalDescription: line.original_description || line.originalDescription,
      },
      catalogueItems,
      ingredients,
      approvedMappings,
    });
    const recognized = mapping.state === "AUTO_MATCHED" || mapping.state === "APPROVED";
    return {
      lineId: line.id,
      state: recognized ? "recognized" : "needs_confirmation",
      confidence: mapping.confidence || 0,
      mappingState: mapping.state,
    };
  });

  const recognized = assessed.filter((row) => row.state === "recognized").length;
  const missingNumbers = active.some((line) => {
    const qty = line.original_quantity ?? line.quantity;
    const price = line.unit_price ?? line.line_total ?? line.lineTotal;
    return qty == null || qty === "" || price == null || price === "";
  });

  let tone = "ready";
  let label = "Ready to post";
  if (duplicate.mayPost === false) {
    tone = "blocked";
    label = duplicate.reason || "Possible duplicate";
  } else if (!active.length || missingNumbers) {
    tone = "blocked";
    label = !active.length ? "No extracted lines" : "A quantity or price is missing";
  } else if (recognized < active.length) {
    tone = "confirm";
    label = `Confirm ${active.length - recognized} item${active.length - recognized === 1 ? "" : "s"}`;
  }

  return {
    tone,
    label,
    recognized,
    total: active.length,
    duplicate,
    lines: assessed,
    mayPost: tone === "ready",
  };
}
