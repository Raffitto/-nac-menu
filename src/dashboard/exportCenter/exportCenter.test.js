import { FOODICS_SOURCE_GUIDE, formatExportDateRange } from "./foodicsSourceGuide";
import { assessExportCoverage, staffPerformanceReady } from "./coverage";
import { validateUploadForNeed } from "./detectFoodicsReport";
import { IMPORT_TYPE } from "../config/foodicsImportTypes";
import { buildAverageCheckRows, buildReviewRanking, buildUpsellModel } from "./staffPerformance";
import { resolveRbacProfile, canAccessNav, allowedBranchIds, resolveEffectiveBranch } from "../config/rbac";
import { zipStoreFiles } from "./zipStore";

describe("Foodics source guide", () => {
  test("uses the real Foodics UI names and paths", () => {
    expect(FOODICS_SOURCE_GUIDE.sales_by_creator.label).toBe("Sales by Creator");
    expect(FOODICS_SOURCE_GUIDE.sales_by_creator.foodicsPath).toBe(
      "Reports → Sales Reports → Sales by Branch → Creator",
    );
    expect(FOODICS_SOURCE_GUIDE.waiter_product_sales.label).toBe("Sales by Creator — Grouped by Product");
    expect(FOODICS_SOURCE_GUIDE.waiter_product_sales.foodicsPath).toBe(
      "Reports → Sales Reports → Sales by Creator → Group By → Product",
    );
    expect(formatExportDateRange("2026-09-01", "2026-09-03")).toBe("01 Sep 2026 → 03 Sep 2026");
  });
});

describe("export center coverage", () => {
  test("blocks staff performance when product-by-creator dates are missing", () => {
    const coverage = assessExportCoverage({
      from: "2026-09-01",
      to: "2026-09-03",
      cashUpDates: ["2026-09-01", "2026-09-02", "2026-09-03"],
      reviewAvailable: true,
      creatorBatches: [{ period_start: "2026-09-01", period_end: "2026-09-03" }],
      productByCreatorBatches: [{ period_start: "2026-09-01", period_end: "2026-09-01" }],
    });
    expect(coverage.salesByProductByCreator.complete).toBe(false);
    expect(coverage.salesByProductByCreator.missing).toEqual(["2026-09-02", "2026-09-03"]);
    expect(staffPerformanceReady(coverage)).toBe(false);
  });

  test("marks range ready when one batch covers the whole period", () => {
    const coverage = assessExportCoverage({
      from: "2026-08-01",
      to: "2026-08-31",
      cashUpDates: Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}`),
      reviewAvailable: true,
      creatorBatches: [{ period_start: "2026-08-01", period_end: "2026-08-31" }],
      productByCreatorBatches: [{ period_start: "2026-08-01", period_end: "2026-08-31" }],
    });
    expect(coverage.cashUp.complete).toBe(true);
    expect(coverage.salesByCreator.complete).toBe(true);
    expect(staffPerformanceReady(coverage)).toBe(true);
  });
});

describe("export center upload detection", () => {
  test("rejects creator-only file when product-by-creator is required", () => {
    const result = validateUploadForNeed(["Creator", "Guests", "Orders", "Net Sales"], IMPORT_TYPE.WAITER_PRODUCT_SALES);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Sales by Creator — Grouped by Product is required/);
  });

  test("accepts product-by-creator headers", () => {
    const result = validateUploadForNeed(
      ["Creator", "Product", "Gross Sales", "Net Quantity"],
      IMPORT_TYPE.WAITER_PRODUCT_SALES,
    );
    expect(result.ok).toBe(true);
    expect(result.detected).toBe(IMPORT_TYPE.WAITER_PRODUCT_SALES);
  });
});

describe("August staff performance oracle", () => {
  test("average check uses net sales and guests when present", () => {
    const rows = buildAverageCheckRows([
      {
        waiter_name: "Abu Sofian",
        net_sales: 143733,
        quantity_sold: 696,
        category: "guests:1754",
      },
    ]);
    expect(rows[0].staff).toBe("Abu Sofian");
    expect(rows[0].orders).toBe(696);
    expect(rows[0].guests).toBe(1754);
    expect(rows[0].netSales).toBe(143733);
    expect(rows[0].avgCheck).toBe(81.95);
    // August PDF printed 179.58 — that is not net_sales / guests (143733 / 1754 = 81.95).
  });

  test("review ranking matches supplied August counts", () => {
    const ranks = buildReviewRanking([
      { name: "Ronald", google: 62 },
      { name: "Kayum", google: 58 },
      { name: "Boyboy", google: 28 },
    ]);
    expect(ranks.map((r) => [r.staff, r.reviews])).toEqual([
      ["Ronald", 62],
      ["Kayum", 58],
      ["Boyboy", 28],
    ]);
  });

  test("upsell qty, share, and item leaders match supplied August rows", () => {
    const productRows = [
      { waiter_name: "Abu Sofian", raw_item_name: "Water", quantity_sold: 185, gross_sales: 1850 },
      { waiter_name: "Kayum", raw_item_name: "Water", quantity_sold: 159, gross_sales: 1590 },
      { waiter_name: "Rabbi", raw_item_name: "Water", quantity_sold: 127, gross_sales: 1270 },
      { waiter_name: "Other", raw_item_name: "Water", quantity_sold: 297, gross_sales: 2970 },
      { waiter_name: "Kayum", raw_item_name: "Chocolate Brownie", quantity_sold: 35, gross_sales: 1750 },
      { waiter_name: "Abu Sofian", raw_item_name: "Chocolate Brownie", quantity_sold: 28, gross_sales: 1400 },
      { waiter_name: "Rabbi", raw_item_name: "Chocolate Brownie", quantity_sold: 16, gross_sales: 800 },
      { waiter_name: "Other", raw_item_name: "Chocolate Brownie", quantity_sold: 39, gross_sales: 1950 },
    ];
    const model = buildUpsellModel(productRows);
    const sofian = model.topUpsellers.find((s) => s.staff === "Abu Sofian");
    expect(sofian.qty).toBe(213);
    const water = model.matrix.find((r) => r.item === "Water");
    expect(water["Abu Sofian"]).toBe(185);
    expect(water.Kayum).toBe(159);
    expect(water.Rabbi).toBe(127);
    expect(water.total).toBe(768);
    const brownie = model.matrix.find((r) => r.item === "Chocolate Brownie");
    expect(brownie.Kayum).toBe(35);
    expect(brownie["Abu Sofian"]).toBe(28);
    expect(brownie.Rabbi).toBe(16);
    expect(brownie.total).toBe(118);
  });
});

describe("Fady reports RBAC", () => {
  const fady = resolveRbacProfile({ user: { email: "fady@nac.com" } });

  test("can open Reports and is clamped to Khobar", () => {
    expect(canAccessNav(fady, "reports")).toBe(true);
    expect(allowedBranchIds(fady)).toEqual(["khobar"]);
    expect(resolveEffectiveBranch(fady, "riyadh")).toBe("khobar");
  });
});

describe("zip store", () => {
  test("builds a downloadable zip with a named file", () => {
    const bytes = zipStoreFiles([{ name: "a.txt", data: new TextEncoder().encode("ok") }]);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes.length).toBeGreaterThan(30);
  });
});
