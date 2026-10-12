/**
 * Canonical receiving document. Stages are not interchangeable.
 * This module never posts stock and never writes a receipt.
 * Foodics purchase-order APIs are not connected. A purchase order is not a delivery.
 * An invoice is not a confirmed receipt. Document 18426 is a historical proof, not a template to repost.
 */

export const RECEIVING_STAGE = Object.freeze({
  ORDERED: "ORDERED",
  RECEIVED: "RECEIVED",
  INVOICED: "INVOICED",
  POSTED: "POSTED",
});

const CONFIRMED_RECEIPT_STAGES = new Set([RECEIVING_STAGE.RECEIVED, RECEIVING_STAGE.POSTED]);

export function receivingIdempotencyKey(line) {
  return [
    line.branchId,
    line.supplierId,
    line.deliveryReference,
    line.ingredientId,
    line.unit,
  ].join("|");
}

export function assessReceivingLine(line, { allowedBranchId, existingKeys = [] } = {}) {
  const missing = ["branchId", "supplierId", "deliveryReference", "ingredientId", "unit", "stage"]
    .filter((field) => line?.[field] == null || line[field] === "");
  if (missing.length) {
    return { ok: false, postsStock: false, reason: `Missing ${missing.join(", ")}.`, duplicate: false };
  }
  if (line.branchId !== allowedBranchId) {
    return { ok: false, postsStock: false, reason: "This delivery is for another branch.", duplicate: false, wrongBranch: true };
  }
  const key = receivingIdempotencyKey(line);
  if (existingKeys.includes(key)) {
    return { ok: false, postsStock: false, reason: "This delivery line was already recorded.", duplicate: true, key };
  }
  const ordered = line.orderedQuantity == null ? null : String(line.orderedQuantity);
  const received = line.receivedQuantity == null ? null : String(line.receivedQuantity);
  const partial = ordered != null && received != null && Number(received) < Number(ordered);
  return {
    ok: true,
    postsStock: false,
    duplicate: false,
    key,
    stage: line.stage,
    countsAsReceipt: CONFIRMED_RECEIPT_STAGES.has(line.stage),
    partial,
    reason: partial ? "Received quantity is less than the ordered quantity." : null,
  };
}

export function confirmedReceiptQuantity(lines) {
  return lines
    .filter((line) => CONFIRMED_RECEIPT_STAGES.has(line.stage))
    .reduce((sum, line) => sum + Number(line.receivedQuantity || 0), 0);
}
