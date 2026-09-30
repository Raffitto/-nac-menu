import { DUPLICATE_STATE, INVOICE_WORKFLOW } from "./contracts";

const REVIEW_STATUSES = new Set(["pending", "needs_review"]);

export function classifyInvoiceWorkflow(invoice = {}, lines = []) {
  const status = String(invoice.status || "").toLowerCase();
  if (status === INVOICE_WORKFLOW.POSTED) return { state: INVOICE_WORKFLOW.POSTED, canPost: false, reason: "Already posted" };
  if (status === INVOICE_WORKFLOW.REJECTED) return { state: INVOICE_WORKFLOW.REJECTED, canPost: false };
  if (status === INVOICE_WORKFLOW.DUPLICATE) return { state: INVOICE_WORKFLOW.DUPLICATE, canPost: false };

  const unresolved = (lines || []).filter((line) => {
    const review = String(line.review_status || line.reviewStatus || "pending").toLowerCase();
    const unmapped = !line.ingredient_id && !line.ingredientId;
    return REVIEW_STATUSES.has(review) || unmapped;
  });
  if (unresolved.length) {
    return {
      state: INVOICE_WORKFLOW.NEEDS_REVIEW,
      canPost: false,
      reason: `${unresolved.length} lines still need review`,
    };
  }
  if (["extracted", "needs_review", "uploaded", "ocr_processing"].includes(status) && (lines || []).length) {
    return { state: INVOICE_WORKFLOW.READY_TO_APPROVE, canPost: true };
  }
  if (status === "uploaded") return { state: INVOICE_WORKFLOW.UPLOADED, canPost: false };
  return { state: status || INVOICE_WORKFLOW.UPLOADED, canPost: false };
}

export function postingIdempotence({ previousPost, invoiceId, idempotencyKey }) {
  if (previousPost && previousPost.invoiceId === invoiceId && previousPost.idempotencyKey === idempotencyKey) {
    return { action: "reuse", duplicatePurchase: false, receiptId: previousPost.receiptId };
  }
  return { action: "create", duplicatePurchase: false };
}

export function describeInvoiceCorrection() {
  return {
    allowed: "reverse_movement",
    forbidden: "delete_posted_history",
    note: "Posted purchase evidence is immutable. Correct by reversing the movement/receipt, then posting a new approved invoice.",
  };
}

export function mayPostAgainstDuplicate(duplicate) {
  return duplicate?.state === DUPLICATE_STATE.NEW && duplicate.mayPost !== false;
}
