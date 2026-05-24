import {
  buildTopItemsSection,
  buildBottomItemsSection,
} from "./buildSections";
import { includeInBottomItemsList } from "./salesRollup";
import { sanitizeTableForPdf } from "../../utils/exportExecutiveVisual";

describe("executive export sections", () => {
  const partialCoverage = {
    aligned: false,
    partial: true,
    warning: "Partial sales coverage: import spans 2026-05-17 to 2026-05-24; report range is 2026-05-14 to 2026-05-24.",
    batchLabel: "2026-05-17 to 2026-05-24",
  };

  const sampleRows = [
    { item_name: "Truffle Risotto", quantity: 120, net_sales: 4500 },
    { item_name: "Popcorn Chicken", quantity: 90, net_sales: 2100 },
    { item_name: "Flat White", quantity: 80, net_sales: 1200 },
  ];

  it("renders top 10 rows under partial sales coverage", () => {
    const section = buildTopItemsSection({
      rows: sampleRows,
      coverage: partialCoverage,
      integrityOk: true,
    });
    expect(section.rows.length).toBeGreaterThan(0);
    expect(section.note).toMatch(/Partial sales coverage/);
    expect(section.subtitle).toMatch(/Sales import window/);
    expect(section.subtitle).not.toMatch(/Partial sales coverage/);
    expect(section.rows[0].rank_label).toBe("Top 1");
  });

  it("excludes zero net sales condiments from least 10 candidates", () => {
    expect(
      includeInBottomItemsList({ item_name: "Ice", quantity: 1, net_sales: 0, foodics_class: "addon" }),
    ).toBe(false);
    expect(
      includeInBottomItemsList({ item_name: "Apple Juice", quantity: 1, net_sales: 13.91, foodics_class: "drink" }),
    ).toBe(true);
  });

  it("builds least 10 from paid items only", () => {
    const section = buildBottomItemsSection({
      rows: [
        { item_name: "Spicy Mayo", quantity: 1, net_sales: 0, foodics_class: "addon" },
        { item_name: "Apple Juice", quantity: 1, net_sales: 13.91, foodics_class: "drink" },
        { item_name: "Extra Patty", quantity: 1, net_sales: 28.7, foodics_class: "addon" },
      ],
      coverage: partialCoverage,
      integrityOk: true,
    });
    expect(section.rows.every((r) => r.net_sales > 0)).toBe(true);
    expect(section.rows.some((r) => r.item_name === "Spicy Mayo")).toBe(false);
  });

  it("sanitizes footer rows as separate cells (not CSV blob)", () => {
    const foot = [["TOTAL", "All waiters", "272,157.39 SAR", "100%", "8,622", "—"]];
    const { body } = sanitizeTableForPdf([], foot);
    expect(body).toHaveLength(1);
    expect(body[0]).toHaveLength(6);
    expect(body[0][0]).toBe("TOTAL");
    expect(body[0][2]).toBe("272,157.39 SAR");
  });
});
