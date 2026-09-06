import { assessExportCoverage, staffPerformanceReady } from "./coverage";
import { parseCreatorSummaryRows } from "./parseCreatorSummary";
import { findFoodicsHeaderAndData } from "../utils/foodicsParser";
import { createImportBatch } from "../../lib/foodicsApi";

jest.mock("../../lib/supabase", () => {
  const inserted = { batches: [], items: [] };
  const from = jest.fn((table) => ({
    insert: jest.fn((rows) => {
      if (table === "foodics_import_batches") {
        const batch = { id: `batch-${inserted.batches.length + 1}`, ...rows };
        inserted.batches.push(batch);
        return {
          select: () => ({
            single: async () => ({ data: batch, error: null }),
          }),
        };
      }
      inserted.items.push(...(Array.isArray(rows) ? rows : [rows]));
      return Promise.resolve({ error: null });
    }),
    delete: jest.fn(() => ({
      eq: async () => ({ error: null }),
    })),
    upsert: jest.fn(() => ({
      select: () => ({
        single: async () => ({ data: {}, error: null }),
      }),
    })),
    select: jest.fn(() => ({
      eq: async () => ({ data: [], error: null }),
    })),
  }));
  return { supabase: { from } };
});

describe("Reports Foodics import integrity", () => {
  const range = { from: "2026-08-01", to: "2026-08-31" };

  test("covering creator batch + zero rows is not Complete", () => {
    const coverage = assessExportCoverage({
      ...range,
      creatorBatches: [{ period_start: "2026-08-01", period_end: "2026-08-31", usable_row_count: 0 }],
      productByCreatorBatches: [{ period_start: "2026-08-01", period_end: "2026-08-31", usable_row_count: 10 }],
    });
    expect(coverage.salesByCreator.complete).toBe(false);
    expect(coverage.salesByCreator.status).toBe("import_incomplete");
    expect(coverage.salesByCreator.message).toMatch(/Import incomplete/);
    expect(staffPerformanceReady(coverage)).toBe(false);
  });

  test("covering creator batch + usable creator rows is Complete", () => {
    const coverage = assessExportCoverage({
      ...range,
      creatorBatches: [{ period_start: "2026-08-01", period_end: "2026-08-31", usable_row_count: 8 }],
      productByCreatorBatches: [{ period_start: "2026-08-01", period_end: "2026-08-31", usable_row_count: 10 }],
    });
    expect(coverage.salesByCreator.complete).toBe(true);
    expect(staffPerformanceReady(coverage)).toBe(true);
  });

  test("covering grouped-product batch + zero product rows is not Complete", () => {
    const coverage = assessExportCoverage({
      ...range,
      creatorBatches: [{ period_start: "2026-08-01", period_end: "2026-08-31", usable_row_count: 8 }],
      productByCreatorBatches: [{ period_start: "2026-08-01", period_end: "2026-08-31", usable_row_count: 0 }],
    });
    expect(coverage.salesByProductByCreator.complete).toBe(false);
    expect(coverage.salesByProductByCreator.status).toBe("import_incomplete");
    expect(staffPerformanceReady(coverage)).toBe(false);
  });

  test("usable grouped-product rows are Complete", () => {
    const coverage = assessExportCoverage({
      ...range,
      creatorBatches: [{ period_start: "2026-08-01", period_end: "2026-08-31", usable_row_count: 8 }],
      productByCreatorBatches: [{ period_start: "2026-08-01", period_end: "2026-08-31", usable_row_count: 40 }],
    });
    expect(coverage.salesByProductByCreator.complete).toBe(true);
    expect(staffPerformanceReady(coverage)).toBe(true);
  });

  test("bad re-upload does not erase a previously valid usable batch", () => {
    const coverage = assessExportCoverage({
      ...range,
      creatorBatches: [
        { id: "good", period_start: "2026-08-01", period_end: "2026-08-31", usable_row_count: 8 },
        { id: "bad", period_start: "2026-08-01", period_end: "2026-08-31", usable_row_count: 0 },
      ],
      productByCreatorBatches: [{ period_start: "2026-08-01", period_end: "2026-08-31", usable_row_count: 12 }],
    });
    expect(coverage.salesByCreator.complete).toBe(true);
    expect(staffPerformanceReady(coverage)).toBe(true);
  });

  test("duplicate usable re-upload remains Complete", () => {
    const coverage = assessExportCoverage({
      ...range,
      creatorBatches: [
        { id: "first", period_start: "2026-08-01", period_end: "2026-08-31", usable_row_count: 8 },
        { id: "second", period_start: "2026-08-01", period_end: "2026-08-31", usable_row_count: 8 },
      ],
      productByCreatorBatches: [
        { id: "p1", period_start: "2026-08-01", period_end: "2026-08-31", usable_row_count: 12 },
        { id: "p2", period_start: "2026-08-01", period_end: "2026-08-31", usable_row_count: 12 },
      ],
    });
    expect(coverage.salesByCreator.complete).toBe(true);
    expect(coverage.salesByProductByCreator.complete).toBe(true);
  });

  test("empty creator persist does not create a covering batch", async () => {
    await expect(
      createImportBatch(
        {
          branch_id: "khobar",
          import_type: "sales_by_creator",
          period_type: "custom",
          period_start: "2026-08-01",
          period_end: "2026-08-31",
          source_file_name: "empty.xls",
        },
        [{ waiter_name: "Ronald", raw_item_name: "__creator__", quantity_sold: 0, net_sales: null }],
      ),
    ).rejects.toThrow(/no usable creator rows/);
  });

  test("empty grouped-product persist does not create a covering batch", async () => {
    await expect(
      createImportBatch(
        {
          branch_id: "khobar",
          import_type: "waiter_product_sales",
          period_type: "custom",
          period_start: "2026-08-01",
          period_end: "2026-08-31",
          source_file_name: "empty-product.xls",
        },
        [{ waiter_name: "Ronald", raw_item_name: "Water", quantity_sold: 0, net_sales: 0, gross_sales: 0 }],
      ),
    ).rejects.toThrow(/no usable product rows/);
  });

});

describe("Sales by Creator Report-28 header detection", () => {
  const matrix = [
    ["Sales by Creator Report"],
    ["Title", "Value"],
    ["Date Range", "2026-08-01 - 2026-08-31"],
    [],
    ["Creator", "Gross Sales", "(Gross Sales %)", "Net Sales With Tax", "Discount Amount", "Net Sales", "(Net Sales %)", "Order Count", "Average Order", "Guest Count", "Average per Guest", "Customers Count"],
    ["Abu Sofian", 143800, 0.25, 143733, 0, 125000, 0.25, 696, 179, 1754, 80, 0],
    ["Rana", 65130, 0.11, 65130, 0, 56634, 0.11, 318, 178, 636, 89, 0],
  ];

  test("finds the creator summary header instead of the title row", () => {
    const found = findFoodicsHeaderAndData(matrix);
    expect(found.headers).toContain("Creator");
    expect(found.headers).toContain("Net Sales With Tax");
    expect(found.headers).toContain("Order Count");
    expect(found.dataRows).toHaveLength(2);
  });

  test("parses usable creator metrics from the real Foodics layout", () => {
    const parsed = parseCreatorSummaryRows(matrix);
    expect(parsed.error).toBeNull();
    expect(parsed.usableRowCount).toBe(2);
    const sofian = parsed.rows.find((r) => r.waiter_name === "Abu Sofian");
    expect(sofian.net_sales).toBe(143733);
    expect(sofian.quantity_sold).toBe(696);
    expect(sofian.category).toBe("guests:1754");
  });
});
