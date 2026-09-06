import { buildStaffPerformanceReport, averageCheckFromNetSales, AVG_CHECK_FORMULA } from "./staffPerformance";
import { staffPerformancePdfPageCount, buildStaffPerformancePdfBytes } from "./staffPerformancePdf";
import { matchTrackedUpsell, trackedUpsellDisplayNames } from "./trackedUpsellCatalog";
import { isEligibleStaff } from "./staffEligibility";
import {
  AUGUST_RANGE,
  AUGUST_CREATOR_ROWS,
  AUGUST_REVIEW_STATS,
  AUGUST_MATRIX,
  augustProductRows,
} from "./fixtures/august2026StaffPerformance";

const CATALOGUE_NOISE = [
  { waiter_name: "Abu Sofian", raw_item_name: "Cookies", quantity_sold: 40, gross_sales: 400 },
  { waiter_name: "Kayum", raw_item_name: "Iced Americano", quantity_sold: 30, gross_sales: 300 },
  { waiter_name: "Rabbi", raw_item_name: "Americano", quantity_sold: 20, gross_sales: 200 },
  { waiter_name: "Ronald", raw_item_name: "Fries", quantity_sold: 50, gross_sales: 500 },
  { waiter_name: "Azhar", raw_item_name: "Rigatoni", quantity_sold: 25, gross_sales: 250 },
  { waiter_name: "Rana", raw_item_name: "Coca Cola", quantity_sold: 18, gross_sales: 180 },
  { waiter_name: "Kayum", raw_item_name: "Flat White", quantity_sold: 12, gross_sales: 120 },
  { waiter_name: "Sujan", raw_item_name: "Water", quantity_sold: 11, gross_sales: 55 },
  { waiter_name: "Boyboy", raw_item_name: "Chocolate Brownie", quantity_sold: 1, gross_sales: 39 },
  { waiter_name: "Raffi", raw_item_name: "Water", quantity_sold: 9, gross_sales: 45 },
];

function augustReport() {
  return buildStaffPerformanceReport({
    ...AUGUST_RANGE,
    creatorRows: AUGUST_CREATOR_ROWS,
    productRows: augustProductRows({ extraStaff: CATALOGUE_NOISE }),
    reviewStats: AUGUST_REVIEW_STATS,
  });
}

describe("tracked upsell mapping", () => {
  test("maps management names and rejects catalogue noise / collisions", () => {
    expect(matchTrackedUpsell("Water").displayName).toBe("Water");
    expect(matchTrackedUpsell("Sparkling Water").displayName).toBe("Sparkling Water - Big");
    expect(matchTrackedUpsell("Sparkling Water - Small").displayName).toBe("Sparkling Water - Small");
    expect(matchTrackedUpsell("Halloumi Fries").status).toBe("unmapped");
    expect(matchTrackedUpsell("Cookies").status).toBe("unmapped");
    expect(matchTrackedUpsell("Iced Americano").status).toBe("unmapped");
    expect(matchTrackedUpsell("Watermelon, Mint & Lemon").displayName).toBe("Mocktail - Watermelon & Mint, Lemon");
    expect(matchTrackedUpsell("Watermelon & Feta Salad").displayName).toBe("Watermelon & Feta Salad");
    expect(matchTrackedUpsell("Virgin Passion Fruit Mojito").displayName).toBe("Mocktail - Passionfruit Mojito");
    expect(matchTrackedUpsell("Virgin Mojito").displayName).toBe("Mocktail - Classic Mojito");
  });

  test("ambiguous steak-like names fail closed", () => {
    const hit = matchTrackedUpsell("Steak Sandwich");
    expect(hit.status).toBe("unmapped");
  });
});

describe("August staff performance regression", () => {
  const report = augustReport();

  test("Avg Check uses ex-VAT net sales / orders, not guests", () => {
    expect(AVG_CHECK_FORMULA.id).toBe("net_sales_ex_vat_per_order");
    expect(averageCheckFromNetSales(143733, 696)).toBe(179.58);
    const sofian = report.averageCheck.find((r) => r.staff === "Abu Sofian");
    expect(sofian.avgCheck).toBe(179.58);
    expect(sofian.orders).toBe(696);
    expect(sofian.guests).toBe(1754);
    expect(sofian.netSales).toBe(143733);
  });

  test("Google reviews stay Drive-workbook counts and include Sujan", () => {
    expect(report.reviews.map((r) => [r.staff, r.reviews])).toEqual([
      ["Ronald", 62],
      ["Kayum", 58],
      ["Boyboy", 28],
      ["Azhar", 13],
      ["Abu Sofian", 12],
      ["Rabbi", 12],
      ["Lyn", 11],
      ["Rana", 6],
      ["Sujan", 1],
      ["Marwan", 0],
      ["Saiful", 0],
    ]);
    expect(report.reviewTotal).toBe(203);
  });

  test("managers are excluded from sales and reviews", () => {
    const names = [
      ...report.averageCheck.map((r) => r.staff),
      ...report.reviews.map((r) => r.staff),
      ...report.staffNames,
    ];
    expect(names.some((n) => /raffi|bashar|fady/i.test(n))).toBe(false);
  });

  test("Sujan is period-excluded from August sales ranking but not globally", () => {
    expect(report.averageCheck.some((r) => r.staff === "Sujan")).toBe(false);
    expect(report.staffNames).not.toContain("Sujan");
    expect(isEligibleStaff("Sujan", { from: "2026-09-01", to: "2026-09-07", scope: "sales_ranking" })).toBe(true);
    const september = buildStaffPerformanceReport({
      branch: "khobar",
      from: "2026-09-01",
      to: "2026-09-07",
      creatorRows: [{ waiter_name: "Sujan", net_sales: 1150, quantity_sold: 10, category: "guests:12" }],
      productRows: [],
      reviewStats: [],
    });
    expect(september.averageCheck[0].staff).toBe("Sujan");
  });

  test("Water and Chocolate Brownie tracked-population totals match the reference", () => {
    const water = report.matrix.find((r) => r.item === "Water");
    expect(water["Abu Sofian"]).toBe(185);
    expect(water.Rabbi).toBe(127);
    expect(water.Azhar).toBe(107);
    expect(water.Rana).toBe(74);
    expect(water.Ronald).toBe(116);
    expect(water.Kayum).toBe(159);
    expect(water.total).toBe(768);
    const brownie = report.matrix.find((r) => r.item === "Chocolate Brownie");
    expect(brownie["Abu Sofian"]).toBe(28);
    expect(brownie.Rabbi).toBe(16);
    expect(brownie.Azhar).toBe(15);
    expect(brownie.Rana).toBe(10);
    expect(brownie.Ronald).toBe(14);
    expect(brownie.Kayum).toBe(35);
    expect(brownie.total).toBe(118);
  });

  test("Top 3 upsellers use tracked items only", () => {
    expect(report.topUpsellers.map((r) => [r.staff, r.qty, r.share])).toEqual([
      ["Abu Sofian", 691, 26.2],
      ["Kayum", 569, 21.6],
      ["Rabbi", 385, 14.6],
    ]);
  });

  test("who-sold-what top 3 follows reference ties for Extra Shot", () => {
    const extra = report.whoSoldWhat.find((r) => r.item === "Extra Shot");
    expect(extra.first).toEqual({ staff: "Ronald", qty: 11 });
    expect(extra.second).toEqual({ staff: "Rana", qty: 4 });
    expect(extra.third).toEqual({ staff: "Rabbi", qty: 2 });
  });

  test("pages 2 and 3 contain only the tracked upsell set", () => {
    const tracked = trackedUpsellDisplayNames();
    expect(report.whoSoldWhat.map((r) => r.item)).toEqual(tracked);
    expect(report.matrix.map((r) => r.item)).toEqual(tracked);
    const dumped = ["Cookies", "Iced Americano", "Americano", "Fries", "Rigatoni", "Coca Cola", "Flat White"];
    dumped.forEach((name) => {
      expect(report.whoSoldWhat.some((r) => r.item === name)).toBe(false);
      expect(report.matrix.some((r) => r.item === name)).toBe(false);
    });
    expect(report.matrix).toHaveLength(28);
    expect(report.staffNames).toEqual(["Abu Sofian", "Rabbi", "Azhar", "Rana", "Ronald", "Kayum"]);
  });

  test("PDF is exactly 3 pages and does not dump the catalogue", () => {
    expect(staffPerformancePdfPageCount(report)).toBe(3);
    const bytes = Buffer.from(buildStaffPerformancePdfBytes(report));
    expect(bytes.length).toBeGreaterThan(1000);
    expect(bytes.toString("latin1")).not.toMatch(/Iced Americano|Coca Cola|Flat White|Cookies/);
    const fs = require("fs");
    fs.writeFileSync("/tmp/NAC_khobar_Staff_Performance_2026-08-01_to_2026-08-31.generated.pdf", bytes);
  });

  test("matrix row totals match the reference for several other items", () => {
    const byItem = Object.fromEntries(report.matrix.map((r) => [r.item, r.total]));
    expect(byItem["Sumac Chicken"]).toBe(303);
    expect(byItem["Truffle Risotto"]).toBe(176);
    expect(byItem.Steak).toBe(194);
    expect(byItem["Mocktail - Passionfruit Mojito"]).toBe(135);
    expect(byItem["Morel Pasta, Parmesan"]).toBe(60);
    expect(byItem["King Prawn Rendang"]).toBe(30);
    Object.entries(AUGUST_MATRIX).forEach(([item, byStaff]) => {
      const expected = Object.values(byStaff).reduce((s, n) => s + n, 0);
      expect(byItem[item]).toBe(expected);
    });
  });
});

describe("Reports review source isolation still holds", () => {
  test("Export Center and staff PDF never read review_events", () => {
    const fs = require("fs");
    const path = require("path");
    ["ExportCenter.jsx", "staffPerformance.js", "staffPerformancePdf.js"].forEach((file) => {
      const src = fs.readFileSync(path.join(__dirname, file), "utf8");
      expect(src).not.toMatch(/review_events/);
      expect(src).not.toMatch(/aggregateStaffReviewStats/);
    });
  });
});
