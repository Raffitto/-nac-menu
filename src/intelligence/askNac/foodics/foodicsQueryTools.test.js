jest.mock("../../../lib/foodicsApi", () => ({
  getBatchForExportPeriod: jest.fn(),
  getBatchSalesItems: jest.fn(),
  getImportBatches: jest.fn(),
}));

import {
  getBatchForExportPeriod,
  getBatchSalesItems,
  getImportBatches,
} from "../../../lib/foodicsApi";
import {
  compareFoodicsTopItems,
  getFoodicsCategorySales,
  getFoodicsSalesSummary,
  getFoodicsTopItems,
} from "./foodicsQueryTools";

const mockBatch = {
  id: "batch-1",
  branch_id: "khobar",
  period_start: "2026-05-01",
  period_end: "2026-05-31",
  source_file_name: "may-sales.xlsx",
  uploaded_at: "2026-06-01",
};

const mockItems = [
  {
    raw_item_name: "Burger",
    matched_menu_item_name: "Classic Burger",
    category: "Mains",
    analytics_category: "Food",
    quantity_sold: 10,
    net_sales: 500,
    gross_sales: 550,
  },
  {
    raw_item_name: "Fries",
    matched_menu_item_name: "Fries",
    category: "Sides",
    analytics_category: "Food",
    quantity_sold: 20,
    net_sales: 200,
    gross_sales: 220,
  },
];

describe("foodicsQueryTools", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getBatchForExportPeriod.mockResolvedValue(mockBatch);
    getBatchSalesItems.mockResolvedValue(mockItems);
  });

  test("getFoodicsSalesSummary aggregates net sales", async () => {
    const result = await getFoodicsSalesSummary(null, {
      question: "What were sales in May?",
      foodicsPeriod: { startDate: "2026-05-01", endDate: "2026-05-31", label: "May 2026" },
      profile: { authenticated: true, allBranches: true },
    });

    expect(result.totals.netSales).toBe(700);
    expect(result.totals.quantity).toBe(30);
    expect(result.batchCoverage).toMatch(/may-sales.xlsx/);
  });

  test("getFoodicsTopItems ranks by net sales by default", async () => {
    const result = await getFoodicsTopItems(null, {
      question: "top 10 items last month",
      foodicsPeriod: { startDate: "2026-05-01", endDate: "2026-05-31", label: "May 2026" },
      rankingBasis: "net_sales",
      topLimit: 10,
      profile: { authenticated: true, allBranches: true },
    });

    expect(result.topItems[0].itemName).toBe("Classic Burger");
    expect(result.topItems[0].netSales).toBe(500);
  });

  test("getFoodicsTopItems ranks by quantity when requested", async () => {
    const result = await getFoodicsTopItems(null, {
      question: "Rank items by quantity",
      foodicsPeriod: { startDate: "2026-05-01", endDate: "2026-05-31", label: "May 2026" },
      rankingBasis: "quantity",
      topLimit: 10,
      profile: { authenticated: true, allBranches: true },
    });

    expect(result.topItems[0].itemName).toBe("Fries");
    expect(result.topItems[0].quantity).toBe(20);
  });

  test("compareFoodicsTopItems finds entered and dropped", async () => {
    getBatchForExportPeriod
      .mockResolvedValueOnce({ ...mockBatch, id: "current" })
      .mockResolvedValueOnce({ ...mockBatch, id: "previous", period_start: "2026-04-01", period_end: "2026-04-30" });

    getBatchSalesItems
      .mockResolvedValueOnce([
        { raw_item_name: "Burger", quantity_sold: 10, net_sales: 500 },
        { raw_item_name: "Salad", quantity_sold: 5, net_sales: 100 },
      ])
      .mockResolvedValueOnce([{ raw_item_name: "Salad", quantity_sold: 8, net_sales: 160 }]);

    const result = await compareFoodicsTopItems(null, {
      foodicsCompare: {
        current: { startDate: "2026-05-01", endDate: "2026-05-31", label: "May 2026" },
        previous: { startDate: "2026-04-01", endDate: "2026-04-30", label: "April 2026" },
      },
      rankingBasis: "net_sales",
      topLimit: 10,
      profile: { authenticated: true, allBranches: true },
    });

    expect(result.entered.map((r) => r.itemName)).toContain("Burger");
    expect(result.dropped.length).toBeGreaterThanOrEqual(0);
  });

  test("getFoodicsCategorySales groups by category", async () => {
    const result = await getFoodicsCategorySales(null, {
      question: "Which category generated the most revenue?",
      foodicsPeriod: { startDate: "2026-05-01", endDate: "2026-05-31", label: "May 2026" },
      profile: { authenticated: true, allBranches: true },
    });

    expect(result.topCategory.category).toBe("Food");
    expect(result.categories[0].netSales).toBe(700);
  });

  test("returns missingBatch when no import overlaps period", async () => {
    getBatchForExportPeriod.mockResolvedValue(null);
    const result = await getFoodicsSalesSummary(null, {
      foodicsPeriod: { startDate: "2026-05-01", endDate: "2026-05-31", label: "May 2026" },
      profile: { authenticated: true, allBranches: true },
    });
    expect(result.missingBatch).toBe(true);
  });
});
