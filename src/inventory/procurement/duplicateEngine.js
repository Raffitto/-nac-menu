import { normalizeText } from "../inventoryIntelligence";
import { DUPLICATE_STATE } from "./contracts";

export function invoiceFingerprint({
  supplierId = null,
  invoiceNumber = null,
  invoiceDate = null,
  total = null,
  branchId = null,
  fileHash = null,
  qrIdentifier = null,
} = {}) {
  return [
    normalizeText(supplierId || ""),
    normalizeText(invoiceNumber || ""),
    String(invoiceDate || "").slice(0, 10),
    String(total ?? ""),
    normalizeText(branchId || ""),
    normalizeText(fileHash || ""),
    normalizeText(qrIdentifier || ""),
  ].join("|");
}

export function classifyInvoiceDuplicate({ candidate, existing = [] } = {}) {
  if (candidate?.fileHash) {
    const fileHit = existing.find((row) => row.fileHash && row.fileHash === candidate.fileHash);
    if (fileHit) {
      return {
        state: fileHit.status === "posted" ? DUPLICATE_STATE.CONFIRMED_DUPLICATE : DUPLICATE_STATE.POSSIBLE_DUPLICATE,
        matchId: fileHit.id,
        reason: "Identical file hash",
        mayPost: false,
      };
    }
  }

  const sameNumber = existing.filter((row) => (
    row.supplierId && row.supplierId === candidate.supplierId
    && normalizeText(row.invoiceNumber) === normalizeText(candidate.invoiceNumber)
    && row.invoiceNumber
  ));
  if (sameNumber.length) {
    const posted = sameNumber.find((row) => row.status === "posted");
    return {
      state: posted ? DUPLICATE_STATE.CONFIRMED_DUPLICATE : DUPLICATE_STATE.POSSIBLE_DUPLICATE,
      matchId: (posted || sameNumber[0]).id,
      reason: "Same supplier and invoice number",
      mayPost: false,
    };
  }

  const soft = existing.find((row) => (
    row.supplierId === candidate.supplierId
    && String(row.invoiceDate || "").slice(0, 10) === String(candidate.invoiceDate || "").slice(0, 10)
    && String(row.total) === String(candidate.total)
    && candidate.total != null
  ));
  if (soft) {
    return {
      state: DUPLICATE_STATE.POSSIBLE_DUPLICATE,
      matchId: soft.id,
      reason: "Same supplier, date, and total",
      mayPost: false,
    };
  }

  return { state: DUPLICATE_STATE.NEW, matchId: null, reason: null, mayPost: true };
}
