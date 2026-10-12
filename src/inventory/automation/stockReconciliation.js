import { addDecimal, subtractDecimal } from "../inventoryIntelligence";

/**
 * Read-only stock reconciliation.
 * Expected closing is not physical stock. Missing inputs stay null and the result is INCOMPLETE.
 */
export function reconcileExpectedStock({
  opening = null,
  receipts = null,
  theoretical = null,
  wastage = null,
  adjustments = null,
  physical = null,
} = {}) {
  const missing = [];
  if (opening == null) missing.push("opening stock");
  if (receipts == null) missing.push("confirmed receipts");
  if (theoretical == null || theoretical.quantity == null) missing.push("theoretical consumption");
  if (wastage == null) missing.push("recorded wastage");
  if (adjustments == null) missing.push("approved adjustments");

  const base = {
    postsStock: false,
    verifiedPhysical: false,
    physicalClosing: physical == null ? null : String(physical),
    variance: null,
  };

  if (missing.length) {
    return {
      ...base,
      status: "INCOMPLETE",
      expectedClosing: null,
      reason: `Missing ${missing.join(", ")}.`,
      lowerBound: Boolean(theoretical?.lowerBound),
    };
  }

  let expected = String(opening);
  expected = addDecimal(expected, String(receipts));
  expected = subtractDecimal(expected, String(theoretical.quantity));
  expected = subtractDecimal(expected, String(wastage));
  expected = addDecimal(expected, String(adjustments));

  const lowerBound = Boolean(theoretical.lowerBound);
  let variance = null;
  if (physical != null && !lowerBound) {
    variance = subtractDecimal(String(physical), expected);
  }

  return {
    ...base,
    status: lowerBound ? "LOWER_BOUND" : "COMPUTED",
    expectedClosing: expected,
    variance,
    lowerBound,
    reason: lowerBound
      ? "Theoretical consumption is a lower bound, so this closing figure is not verified physical stock."
      : "Expected closing from the ledger. This is not a physical count.",
  };
}
