import {
  calculateReceiptProgress,
  nextPurchaseOrderActions,
  receiptExceptionCount,
} from "./procurementControls";

describe("procurement controls", () => {
  test("tracks partial and multiple receipts without a parallel stock balance", () => {
    expect(calculateReceiptProgress(10, [3, 2])).toEqual({
      ordered: 10,
      received: 5,
      remaining: 5,
      overReceived: false,
      status: "partially_received",
    });
    expect(calculateReceiptProgress(10, [3, 7]).status).toBe("received");
  });

  test("flags over-receipt while preserving the cumulative quantity", () => {
    expect(calculateReceiptProgress(10, [6, 5])).toEqual({
      ordered: 10,
      received: 11,
      remaining: 0,
      overReceived: true,
      status: "received",
    });
  });

  test("exposes only valid manager lifecycle actions", () => {
    expect(nextPurchaseOrderActions("draft")).toEqual(["submitted", "cancelled"]);
    expect(nextPurchaseOrderActions("submitted")).toEqual(["approved", "rejected", "cancelled"]);
    expect(nextPurchaseOrderActions("partially_received")).toEqual(["closed"]);
    expect(nextPurchaseOrderActions("closed")).toEqual([]);
  });

  test("counts only open transaction exceptions", () => {
    expect(receiptExceptionCount({
      inventory_exceptions: [{ status: "open" }, { status: "resolved" }, { status: "open" }],
    })).toBe(2);
  });
});
