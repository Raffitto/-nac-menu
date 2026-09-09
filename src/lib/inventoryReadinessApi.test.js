import { INVENTORY_READINESS_SELECTS } from "./inventoryReadinessApi";

describe("inventory readiness query contracts", () => {
  test("readiness selects are explicit and never star", () => {
    expect(Object.values(INVENTORY_READINESS_SELECTS).every((value) => !value.includes("*"))).toBe(true);
    expect(INVENTORY_READINESS_SELECTS.VERSION_AUDIT_SELECT).toContain("status");
    expect(INVENTORY_READINESS_SELECTS.RECEIPT_LINE_SELECT).toContain("unit_cost_canonical");
    expect(INVENTORY_READINESS_SELECTS.INVOICE_LINE_SELECT).toContain("conversion_factor");
  });
});
