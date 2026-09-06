import { buildStaffPerformanceReport } from "./staffPerformance";
import { isEligibleStaff, isRankedUpsellStaff } from "./staffEligibility";
import {
  AUGUST_RANGE,
  AUGUST_CREATOR_ROWS,
  AUGUST_REVIEW_STATS,
  augustProductRows,
} from "./fixtures/august2026StaffPerformance";

const SAIFUL_CREATOR = { waiter_name: "Saiful", net_sales: 4771, quantity_sold: 28, category: "guests:70" };
const SAIFUL_UPSELL = [
  { waiter_name: "Saiful", raw_item_name: "Water", quantity_sold: 5, gross_sales: 120 },
  { waiter_name: "Saiful", raw_item_name: "Chocolate Brownie", quantity_sold: 1, gross_sales: 39 },
  { waiter_name: "Saiful", raw_item_name: "Big NAC New", quantity_sold: 1, gross_sales: 69 },
];

describe("Top 3 upsell share uses the ranked-period population", () => {
  test("August ranked six-waiter population yields 26.2 / 21.6 / 14.6 while Saiful remains elsewhere", () => {
    const report = buildStaffPerformanceReport({
      ...AUGUST_RANGE,
      creatorRows: [...AUGUST_CREATOR_ROWS, SAIFUL_CREATOR],
      productRows: augustProductRows({ extraStaff: SAIFUL_UPSELL }),
      reviewStats: AUGUST_REVIEW_STATS,
    });

    expect(report.topUpsellers.map((r) => [r.staff, r.qty, r.share])).toEqual([
      ["Abu Sofian", 691, 26.2],
      ["Kayum", 569, 21.6],
      ["Rabbi", 385, 14.6],
    ]);
    expect(report.averageCheck.some((r) => r.staff === "Saiful")).toBe(true);
    expect(report.staffNames).toContain("Saiful");
    expect(report.matrix.find((r) => r.item === "Water").Saiful).toBe(5);
    expect(report.matrix.find((r) => r.item === "Chocolate Brownie").Saiful).toBe(1);
    expect(isEligibleStaff("Saiful", { ...AUGUST_RANGE, scope: "sales_ranking" })).toBe(true);
    expect(isRankedUpsellStaff("Saiful", AUGUST_RANGE)).toBe(false);
  });

  test("September uses its own ranked eligibility, so Saiful enters the share denominator", () => {
    const september = { from: "2026-09-01", to: "2026-09-07", branch: "khobar" };
    expect(isRankedUpsellStaff("Saiful", september)).toBe(true);

    const report = buildStaffPerformanceReport({
      ...september,
      creatorRows: [
        { waiter_name: "Abu Sofian", net_sales: 2000, quantity_sold: 10, category: "guests:20" },
        { waiter_name: "Kayum", net_sales: 1800, quantity_sold: 9, category: "guests:18" },
        { waiter_name: "Rabbi", net_sales: 1600, quantity_sold: 8, category: "guests:16" },
        SAIFUL_CREATOR,
      ],
      productRows: [
        { waiter_name: "Abu Sofian", raw_item_name: "Water", quantity_sold: 691, gross_sales: 100 },
        { waiter_name: "Kayum", raw_item_name: "Water", quantity_sold: 569, gross_sales: 100 },
        { waiter_name: "Rabbi", raw_item_name: "Water", quantity_sold: 385, gross_sales: 100 },
        { waiter_name: "Saiful", raw_item_name: "Water", quantity_sold: 20, gross_sales: 100 },
      ],
      reviewStats: [],
    });

    const rankedQty = 691 + 569 + 385 + 20;
    expect(report.topUpsellers[0]).toEqual(expect.objectContaining({
      staff: "Abu Sofian",
      qty: 691,
      share: Math.round((691 / rankedQty) * 1000) / 10,
    }));
    expect(report.topUpsellers[0].share).not.toBe(26.2);
    expect(report.averageCheck.some((r) => r.staff === "Saiful")).toBe(true);
  });
});
