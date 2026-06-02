import {
  enforceMenuFunnelIntegrity,
  filterCustomerFacingCategories,
  resolveSessionQualityDenominator,
  isSyntheticCategoryId,
} from "./customerFacingAnalytics";

describe("customerFacingAnalytics", () => {
  it("filters synthetic category ids", () => {
    const rows = filterCustomerFacingCategories([
      { id: "__nav_aggregate__", opens: 200 },
      { id: "evening", opens: 40 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("evening");
    expect(isSyntheticCategoryId("__nav_aggregate__")).toBe(true);
  });

  it("enforces monotonic menu funnel", () => {
    const f = enforceMenuFunnelIntegrity({
      qr_scans: 10,
      category_opens: 50,
      item_opens: 40,
      addon_clicks: 99,
    });
    expect(f.category_opens).toBe(10);
    expect(f.item_opens).toBe(10);
    expect(f.addon_clicks).toBe(10);
  });

  it("uses classified session count as denominator when partial", () => {
    const d = resolveSessionQualityDenominator(
      { casual: 3, engaged: 2, bounce: 0, deep: 0, power: 0 },
      38195,
    );
    expect(d.isPartial).toBe(true);
    expect(d.denominator).toBe(5);
    expect(d.classifiedCount).toBe(5);
  });
});
