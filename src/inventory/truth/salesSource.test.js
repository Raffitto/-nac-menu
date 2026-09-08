import {
  COMMERCE_CANDIDATE_TABLES,
  SALES_SOURCE,
  SALES_SOURCE_STATUS,
  clipSalesPeriod,
  commerceRowHasContract,
  reconcileSalesSources,
  selectSalesSource,
} from "./salesSource";

describe("canonical sales source contract", () => {
  test("commerce is primary when it has identity, quantity, branch, and date", () => {
    const selected = selectSalesSource({
      commerceProbe: {
        status: SALES_SOURCE_STATUS.AVAILABLE,
        rows: [{
          menu_item_id: "menu-steak",
          menu_item_name: "Steak",
          quantity: 4,
          branch_id: "khobar",
          business_date: "2026-08-05",
          net_sales: 360,
        }],
      },
      foodicsRows: [{
        matched_menu_item_id: "menu-steak",
        matched_menu_item_name: "Steak",
        quantity_sold: 99,
        branch_id: "khobar",
      }],
    });
    expect(selected.used).toBe(SALES_SOURCE.CANONICAL_COMMERCE);
    expect(selected.combined).toBe(false);
    expect(selected.rows[0].quantity_sold).toBe(4);
    expect(selected.rows[0].quantity_sold).not.toBe(103);
  });

  test("manual Foodics import is fallback when commerce is absent from schema", () => {
    const selected = selectSalesSource({
      commerceProbe: { status: SALES_SOURCE_STATUS.NOT_IN_SCHEMA, rows: [] },
      foodicsRows: [{
        matched_menu_item_id: "menu-steak",
        matched_menu_item_name: "Steak",
        quantity_sold: 7,
      }],
    });
    expect(selected.used).toBe(SALES_SOURCE.FOODICS_SALES_ITEMS);
    expect(selected.primary).toBe(SALES_SOURCE.CANONICAL_COMMERCE);
    expect(selected.fallback).toBe(SALES_SOURCE.FOODICS_SALES_ITEMS);
    expect(selected.rows[0].quantity_sold).toBe(7);
  });

  test("does not treat incomplete commerce rows as a usable primary", () => {
    expect(commerceRowHasContract({ quantity: 3, branch_id: "khobar" })).toBe(false);
    const selected = selectSalesSource({
      commerceProbe: {
        status: SALES_SOURCE_STATUS.AVAILABLE,
        rows: [{ quantity: 3, branch_id: "khobar" }],
      },
      foodicsRows: [{ matched_menu_item_name: "Steak", quantity_sold: 2 }],
    });
    expect(selected.used).toBe(SALES_SOURCE.FOODICS_SALES_ITEMS);
  });

  test("clips theoretical period to completed coverage and never claims a later date", () => {
    const clipped = clipSalesPeriod({
      requestedStart: "2026-08-31",
      requestedEnd: "2026-09-12",
      publishedThrough: "2026-09-05",
      referenceDate: new Date("2026-09-09T12:00:00+03:00"),
    });
    expect(clipped.availableEnd).toBe("2026-09-05");
    expect(clipped.availableEnd < clipped.requestedEnd).toBe(true);
    expect(clipped.publishedThrough).toBe("2026-09-05");
    expect(clipped.usable).toBe(true);
  });

  test("empty commerce inside published coverage does not fall back to Foodics", () => {
    const selected = selectSalesSource({
      commerceProbe: { status: SALES_SOURCE_STATUS.EMPTY, rows: [] },
      foodicsRows: [{ matched_menu_item_id: "menu-steak", quantity_sold: 9 }],
      coversRequestedPeriod: true,
    });
    expect(selected.used).toBe(SALES_SOURCE.CANONICAL_COMMERCE);
    expect(selected.rows).toEqual([]);
    expect(selected.combined).toBe(false);
  });

  test("reconciliation reports matches and mismatches without combining sources", () => {
    const report = reconcileSalesSources(
      [{ matched_menu_item_id: "steak", quantity_sold: 10 }, { matched_menu_item_name: "Mystery", quantity_sold: 1 }],
      [{ matched_menu_item_id: "steak", quantity_sold: 8 }, { matched_menu_item_id: "salad", quantity_sold: 3 }],
    );
    expect(report.combined).toBe(false);
    expect(report.quantityMismatches[0]).toMatchObject({ key: "steak", commerceQty: "10", foodicsQty: "8" });
    expect(report.missingOnCommerce.some((row) => row.key === "salad")).toBe(true);
    expect(report.identityMismatches.length).toBeGreaterThan(0);
  });

  test("documents the commerce tables that are probed", () => {
    expect(COMMERCE_CANDIDATE_TABLES.items).toBe("commerce_order_items");
    expect(COMMERCE_CANDIDATE_TABLES.orders).toBe("commerce_orders");
  });
});
