import { buildStaffPerformanceReport } from "./staffPerformance";
import { isEligibleStaff, isRankedUpsellStaff } from "./staffEligibility";
import {
  AUGUST_RANGE,
  AUGUST_CREATOR_ROWS,
  AUGUST_REVIEW_STATS,
  augustProductRows,
} from "./fixtures/august2026StaffPerformance";

const SEPTEMBER = { from: "2026-09-01", to: "2026-09-07" };
const RANKED_SCOPES = ["sales_ranking", "upsell", "upsell_ranking", "matrix"];

const SAIFUL_CREATOR = { waiter_name: "Saiful", net_sales: 4771, quantity_sold: 28, category: "guests:70" };
const SUJAN_UPSELL = { waiter_name: "Sujan", raw_item_name: "Water", quantity_sold: 11, gross_sales: 55 };
const SAIFUL_UPSELL = { waiter_name: "Saiful", raw_item_name: "Water", quantity_sold: 5, gross_sales: 120 };

function augustReportWithVacationRows() {
  return buildStaffPerformanceReport({
    ...AUGUST_RANGE,
    creatorRows: [...AUGUST_CREATOR_ROWS, SAIFUL_CREATOR],
    productRows: augustProductRows({ extraStaff: [SUJAN_UPSELL, SAIFUL_UPSELL] }),
    reviewStats: AUGUST_REVIEW_STATS,
  });
}

describe("August 2026 vacation / partial-month eligibility", () => {
  test("Sujan is out of August ranked sales and upsell, then returns in September", () => {
    RANKED_SCOPES.forEach((scope) => {
      expect(isEligibleStaff("Sujan", { ...AUGUST_RANGE, scope })).toBe(false);
    });
    expect(isRankedUpsellStaff("Sujan", AUGUST_RANGE)).toBe(false);
    expect(isEligibleStaff("Sujan", { ...AUGUST_RANGE, scope: "reviews" })).toBe(true);

    RANKED_SCOPES.forEach((scope) => {
      expect(isEligibleStaff("Sujan", { ...SEPTEMBER, scope })).toBe(true);
    });
    expect(isRankedUpsellStaff("Sujan", SEPTEMBER)).toBe(true);
  });

  test("Saiful is out of the August Top 3 share denominator, then returns in September", () => {
    expect(isRankedUpsellStaff("Saiful", AUGUST_RANGE)).toBe(false);
    expect(isEligibleStaff("Saiful", { ...AUGUST_RANGE, scope: "upsell_ranking" })).toBe(false);
    expect(isEligibleStaff("Saiful", { ...AUGUST_RANGE, scope: "sales_ranking" })).toBe(true);
    expect(isEligibleStaff("Saiful", { ...AUGUST_RANGE, scope: "upsell" })).toBe(true);
    expect(isEligibleStaff("Saiful", { ...AUGUST_RANGE, scope: "reviews" })).toBe(true);

    RANKED_SCOPES.forEach((scope) => {
      expect(isEligibleStaff("Saiful", { ...SEPTEMBER, scope })).toBe(true);
    });
    expect(isRankedUpsellStaff("Saiful", SEPTEMBER)).toBe(true);
  });

  test("August Top 3 qty/share ignore Sujan and Saiful tracked rows", () => {
    const report = augustReportWithVacationRows();
    expect(report.topUpsellers.map((r) => [r.staff, r.qty, r.share])).toEqual([
      ["Abu Sofian", 691, 26.2],
      ["Kayum", 569, 21.6],
      ["Rabbi", 385, 14.6],
    ]);
    expect(report.averageCheck.some((r) => r.staff === "Sujan")).toBe(false);
    expect(report.staffNames).not.toContain("Sujan");
    expect(report.averageCheck.some((r) => r.staff === "Saiful")).toBe(true);
    expect(report.staffNames).toContain("Saiful");
    expect(report.matrix.find((r) => r.item === "Water").Saiful).toBe(5);
  });

  test("September Sujan and Saiful participate in sales ranking and the share denominator", () => {
    const report = buildStaffPerformanceReport({
      branch: "khobar",
      ...SEPTEMBER,
      creatorRows: [
        { waiter_name: "Abu Sofian", net_sales: 2000, quantity_sold: 10, category: "guests:20" },
        { waiter_name: "Sujan", net_sales: 1150, quantity_sold: 10, category: "guests:12" },
        SAIFUL_CREATOR,
      ],
      productRows: [
        { waiter_name: "Abu Sofian", raw_item_name: "Water", quantity_sold: 100, gross_sales: 2400 },
        { waiter_name: "Sujan", raw_item_name: "Water", quantity_sold: 40, gross_sales: 960 },
        { waiter_name: "Saiful", raw_item_name: "Water", quantity_sold: 20, gross_sales: 480 },
      ],
      reviewStats: [],
    });
    expect(report.averageCheck.map((r) => r.staff)).toEqual(expect.arrayContaining(["Abu Sofian", "Sujan", "Saiful"]));
    expect(report.topUpsellers.map((r) => r.staff)).toEqual(["Abu Sofian", "Sujan", "Saiful"]);
    expect(report.topUpsellers[0].share).toBe(Math.round((100 / 160) * 1000) / 10);
    expect(report.topUpsellers[1].share).toBe(Math.round((40 / 160) * 1000) / 10);
    expect(report.topUpsellers[2].share).toBe(Math.round((20 / 160) * 1000) / 10);
  });
});
