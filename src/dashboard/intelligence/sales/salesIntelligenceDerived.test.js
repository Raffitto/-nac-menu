import { buildSalesIntelligenceDerived } from "./salesIntelligenceDerived";

describe("salesIntelligenceDerived", () => {
  test("aggregates overview totals and top items", () => {
    const derived = buildSalesIntelligenceDerived({
      batches: [
        {
          id: "b1",
          branch_id: "khobar",
          period_start: "2026-05-01",
          period_end: "2026-05-31",
          source_file_name: "may.xlsx",
          uploaded_at: "2026-06-01",
        },
      ],
      salesBatch: {
        id: "b1",
        branch_id: "khobar",
        period_start: "2026-05-01",
        period_end: "2026-05-31",
      },
      previousBatch: null,
      salesItems: [
        {
          raw_item_name: "Burger",
          matched_menu_item_name: "Burger",
          category: "Mains",
          quantity_sold: 10,
          net_sales: 500,
          gross_sales: 550,
        },
        {
          raw_item_name: "Fries",
          matched_menu_item_name: "Fries",
          category: "Sides",
          quantity_sold: 20,
          net_sales: 200,
          gross_sales: 220,
        },
      ],
      previousSalesItems: [],
      topItems: [],
      totalSessions: 0,
    });

    expect(derived.overview.netSales).toBe(700);
    expect(derived.overview.quantity).toBe(30);
    expect(derived.items.topBySales[0].name).toBe("Burger");
    expect(derived.categories.rows[0].category).toBeTruthy();
  });

  test("detects rank movement between batches", () => {
    const derived = buildSalesIntelligenceDerived({
      batches: [],
      salesBatch: { id: "c", period_start: "2026-05-01", period_end: "2026-05-31" },
      previousBatch: { id: "p", period_start: "2026-04-01", period_end: "2026-04-30" },
      salesItems: [
        { raw_item_name: "Burger", quantity_sold: 10, net_sales: 500 },
        { raw_item_name: "Salad", quantity_sold: 5, net_sales: 100 },
      ],
      previousSalesItems: [{ raw_item_name: "Salad", quantity_sold: 8, net_sales: 160 }],
      topItems: [],
      totalSessions: 0,
    });

    expect(derived.items.rankMoves.entered.some((r) => r.name === "Burger")).toBe(true);
  });
});
