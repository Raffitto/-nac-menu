import { assessReceivingLine, confirmedReceiptQuantity, RECEIVING_STAGE, receivingIdempotencyKey } from "./receivingDocument";

const line = {
  branchId: "khobar",
  supplierId: "ecowhiz",
  deliveryReference: "SYN-DN-1",
  ingredientId: "milk",
  unit: "L",
  orderedQuantity: "10",
  receivedQuantity: "10",
  stage: RECEIVING_STAGE.RECEIVED,
};

test("a repeated delivery line is rejected and nothing is posted", () => {
  const key = receivingIdempotencyKey(line);
  const result = assessReceivingLine(line, { allowedBranchId: "khobar", existingKeys: [key] });
  expect(result.duplicate).toBe(true);
  expect(result.postsStock).toBe(false);
  expect(result.ok).toBe(false);
});

test("a short delivery is partial and still not posted", () => {
  const result = assessReceivingLine(
    { ...line, orderedQuantity: "10", receivedQuantity: "4" },
    { allowedBranchId: "khobar" },
  );
  expect(result.ok).toBe(true);
  expect(result.partial).toBe(true);
  expect(result.postsStock).toBe(false);
});

test("another branch cannot record the delivery", () => {
  const result = assessReceivingLine(line, { allowedBranchId: "riyadh" });
  expect(result.wrongBranch).toBe(true);
  expect(result.postsStock).toBe(false);
});

test("ordered and invoiced lines are not confirmed receipts", () => {
  const qty = confirmedReceiptQuantity([
    { ...line, stage: RECEIVING_STAGE.ORDERED, receivedQuantity: "10" },
    { ...line, stage: RECEIVING_STAGE.INVOICED, receivedQuantity: "10" },
    { ...line, stage: RECEIVING_STAGE.RECEIVED, receivedQuantity: "3" },
  ]);
  expect(qty).toBe(3);
});
