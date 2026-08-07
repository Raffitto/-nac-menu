export const PURCHASE_ORDER_ACTIONS = Object.freeze({
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "rejected", "cancelled"],
  approved: ["closed", "cancelled"],
  partially_received: ["closed"],
  received: ["closed"],
  closed: [],
  cancelled: [],
  rejected: [],
});

export function calculateReceiptProgress(orderedQuantity, receipts = []) {
  const ordered = Number(orderedQuantity || 0);
  const received = receipts.reduce((total, quantity) => total + Number(quantity || 0), 0);
  const remaining = Math.max(ordered - received, 0);
  return {
    ordered,
    received,
    remaining,
    overReceived: received > ordered,
    status: received <= 0
      ? "approved"
      : received >= ordered
        ? "received"
        : "partially_received",
  };
}

export function nextPurchaseOrderActions(status) {
  return PURCHASE_ORDER_ACTIONS[status] || [];
}

export function receiptExceptionCount(receipt) {
  return Number(receipt?.inventory_exceptions?.filter(({ status }) => status === "open").length || 0);
}
