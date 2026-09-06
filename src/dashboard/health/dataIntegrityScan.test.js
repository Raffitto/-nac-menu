import { scanMenuIdentityIssues, summarizeIntegrityIssues, INTEGRITY_SEVERITY } from "./dataIntegrityScan";

describe("data integrity scan", () => {
  test("reused SKU for different names is ERROR", () => {
    const { issues, counts } = summarizeIntegrityIssues(scanMenuIdentityIssues([
      { id: "1", sku: "NAC-1", name_en: "Big NAC" },
      { id: "2", sku: "NAC-1", name_en: "Big NAC New" },
    ]));
    expect(counts.ERROR).toBe(1);
    expect(issues[0].code).toBe("reused_sku");
  });

  test("duplicate same-name SKU is WARNING, missing SKU is INFO", () => {
    const issues = scanMenuIdentityIssues([
      { id: "1", sku: "A", name_en: "Fries" },
      { id: "2", sku: "A", name_en: "Fries" },
      { id: "3", name_en: "Water" },
    ]);
    expect(issues.some((i) => i.severity === INTEGRITY_SEVERITY.WARNING && i.code === "duplicate_sku")).toBe(true);
    expect(issues.some((i) => i.severity === INTEGRITY_SEVERITY.INFO && i.code === "missing_sku")).toBe(true);
  });
});
