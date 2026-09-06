import {
  scanMenuIdentityIssues,
  scanIntegrityBundle,
  summarizeIntegrityIssues,
  INTEGRITY_SEVERITY,
} from "./dataIntegrityScan";

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

  test("recipe graph flags missing ingredient and circular sub-recipe with evidence", () => {
    const result = scanIntegrityBundle({
      menuItems: [{ id: "m1", name_en: "Big NAC", sku: "A", active: true }],
      recipes: [
        { id: "r1", name: "Sauce", menu_item_id: "m1", active: true },
        { id: "r2", name: "Base", active: true },
      ],
      versions: [
        { id: "v1", recipe_id: "r1", status: "active" },
        { id: "v2", recipe_id: "r2", status: "active" },
      ],
      lines: [
        { id: "l1", recipe_version_id: "v1", ingredient_id: "missing-ing", quantity: 1 },
        { id: "l2", recipe_version_id: "v1", sub_recipe_id: "r2", quantity: 1 },
        { id: "l3", recipe_version_id: "v2", sub_recipe_id: "r1", quantity: 1 },
      ],
      ingredients: [],
    });
    expect(result.counts.ERROR).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.code === "missing_ingredient" && i.evidence?.length)).toBe(true);
    expect(result.issues.some((i) => i.code === "circular_sub_recipe")).toBe(true);
    expect(result.capabilityGaps.some((g) => g.code === "inventory_identity_unmapped")).toBe(true);
    expect(result.groups[0].examples.length).toBeGreaterThan(0);
  });
});
