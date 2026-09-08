import { SALES_SOURCE, SALES_SOURCE_STATUS } from "../inventory/truth/salesSource";

jest.mock("./supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { supabase } from "./supabase";
import { fetchInventoryTruthSales } from "./inventoryTruthApi";

function chain(result) {
  const query = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    in: jest.fn(() => query),
    gte: jest.fn(() => query),
    lte: jest.fn(() => query),
    range: jest.fn(async () => result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

describe("fetchInventoryTruthSales source precedence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("uses canonical commerce items and does not add overlapping Foodics quantities", async () => {
    supabase.from.mockImplementation((table) => {
      if (table === "commerce_dataset_freshness") {
        return chain({ data: [{ data_through: "2026-08-08", dataset: "commerce_order_items", branch_id: "khobar" }], error: null });
      }
      if (table === "commerce_ingest_health") {
        return chain({ data: [{ coverage_through: "2026-08-08", branch_id: "khobar" }], error: null });
      }
      if (table === "commerce_order_items") {
        return chain({
          data: [{
            branch_id: "khobar",
            business_date: "2026-08-05",
            canonical_menu_item_id: "menu-steak",
            item_name: "Steak",
            quantity: 4,
            net_amount: 360,
            product_id: "foodics-steak",
            status: "completed",
          }],
          error: null,
        });
      }
      if (table === "foodics_sales_items") {
        return chain({
          data: [{
            matched_menu_item_id: "menu-steak",
            matched_menu_item_name: "Steak",
            quantity_sold: 99,
            net_sales: 900,
            branch_id: "khobar",
            period_start: "2026-08-02",
            period_end: "2026-08-08",
          }],
          error: null,
        });
      }
      return chain({ data: [], error: { code: "PGRST205", message: "does not exist" } });
    });

    const sales = await fetchInventoryTruthSales({
      branchId: "khobar",
      periodStart: "2026-08-02",
      periodEnd: "2026-08-08",
      access: { vaultRole: "super_admin", branchIds: ["khobar"] },
      referenceDate: new Date("2026-09-09T12:00:00+03:00"),
    });
    expect(sales.used).toBe(SALES_SOURCE.CANONICAL_COMMERCE);
    expect(sales.combined).toBe(false);
    expect(sales.rows).toHaveLength(1);
    expect(sales.rows[0].quantity_sold).toBe(4);
    expect(sales.reconciliation.compared).toBe(true);
    expect(sales.reconciliation.quantityMismatches[0]).toMatchObject({
      key: "menu-steak",
      commerceQty: "4",
      foodicsQty: "99",
    });
  });

  test("falls back to manual Foodics when commerce tables are not in schema", async () => {
    supabase.from.mockImplementation((table) => {
      if (table === "foodics_sales_items") {
        return chain({
          data: [{
            matched_menu_item_id: "menu-steak",
            matched_menu_item_name: "Steak",
            quantity_sold: 7,
            branch_id: "khobar",
            period_start: "2026-08-02",
            period_end: "2026-08-08",
          }],
          error: null,
        });
      }
      return chain({ data: null, error: { code: "PGRST205", message: "Could not find the table" } });
    });

    const sales = await fetchInventoryTruthSales({
      branchId: "khobar",
      periodStart: "2026-08-02",
      periodEnd: "2026-08-08",
      access: { vaultRole: "super_admin", branchIds: ["khobar"] },
      referenceDate: new Date("2026-09-09T12:00:00+03:00"),
    });
    expect(sales.commerceStatus).toBe(SALES_SOURCE_STATUS.NOT_IN_SCHEMA);
    expect(sales.used).toBe(SALES_SOURCE.FOODICS_SALES_ITEMS);
    expect(sales.rows[0].quantity_sold).toBe(7);
  });
});
