import { reconcileExpectedStock } from "./stockReconciliation";

test("missing opening stock stays incomplete and is not zero", () => {
  const result = reconcileExpectedStock({
    opening: null,
    receipts: "5",
    theoretical: { quantity: "1", lowerBound: false },
    wastage: "0",
    adjustments: "0",
  });
  expect(result.status).toBe("INCOMPLETE");
  expect(result.expectedClosing).toBeNull();
  expect(result.postsStock).toBe(false);
  expect(result.verifiedPhysical).toBe(false);
});

test("variance is physical minus expected and is not called physical stock", () => {
  const result = reconcileExpectedStock({
    opening: "10",
    receipts: "5",
    theoretical: { quantity: "3", lowerBound: false },
    wastage: "1",
    adjustments: "0",
    physical: "12",
  });
  expect(result.status).toBe("COMPUTED");
  expect(result.expectedClosing).toBe("11");
  expect(result.variance).toBe("1");
  expect(result.verifiedPhysical).toBe(false);
});

test("a lower-bound consumption does not produce a verified variance", () => {
  const result = reconcileExpectedStock({
    opening: "10",
    receipts: "0",
    theoretical: { quantity: "2", lowerBound: true },
    wastage: "0",
    adjustments: "0",
    physical: "8",
  });
  expect(result.status).toBe("LOWER_BOUND");
  expect(result.variance).toBeNull();
  expect(result.postsStock).toBe(false);
});
