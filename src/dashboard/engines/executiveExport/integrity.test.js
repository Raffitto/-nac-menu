import { canonicalStaffName, WAITER_NAME_ALIASES } from "../../config/staffRoles";
import { buildExecutiveUnifiedExportPackage } from "./buildPackage";
import {
  isSymbolOrMaskedItemName,
  isExecutiveEligibleAggregatedItem,
  filterExecutiveAggregatedItems,
} from "./executiveItemIntegrity";
import { mergeWaiterRankingRows, mergeReviewWaiterStats } from "./waiterIdentity";
import { validateExecutiveExportIntegrity } from "./validateIntegrity";
import { buildTopItemsSection } from "./buildSections";

describe("executive export integrity", () => {
  it("maps waiter aliases to canonical names", () => {
    expect(canonicalStaffName("Mohamed Azhar")).toBe("Azhar");
    expect(canonicalStaffName("Saif")).toBe("Saiful");
    expect(WAITER_NAME_ALIASES.azhar).toBe("Azhar");
  });

  it("rejects masked and zero-SAR item names", () => {
    expect(isSymbolOrMaskedItemName("****************************")).toBe(true);
    expect(isSymbolOrMaskedItemName("Truffle Risotto")).toBe(false);
    expect(
      isExecutiveEligibleAggregatedItem({
        item_name: "****************************",
        quantity: 406,
        net_sales: 0,
      }),
    ).toBe(false);
  });

  it("merges split waiter sales before ranking", () => {
    const { rows } = mergeWaiterRankingRows([
      { waiter: "Mohamed Azhar", net_sales: 100, quantity: 5 },
      { waiter: "Azhar", net_sales: 50, quantity: 2 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].waiter).toBe("Azhar");
    expect(rows[0].net_sales).toBe(150);
    expect(rows[0].quantity).toBe(7);
  });

  it("merges Google review stats by canonical waiter", () => {
    const { staff } = mergeReviewWaiterStats([
      { name: "Saif", google: 5, scans: 10 },
      { name: "Saiful", google: 3, scans: 4 },
    ]);
    expect(staff).toHaveLength(1);
    expect(staff[0].name).toBe("Saiful");
    expect(staff[0].google).toBe(8);
    expect(staff[0].scans).toBe(14);
  });

  it("excludes masked rows from top 10 section output", () => {
    const section = buildTopItemsSection({
      rows: [
        { item_name: "****************************", quantity: 406, net_sales: 0 },
        { item_name: "Truffle Risotto", quantity: 40, net_sales: 1200 },
      ],
      coverage: { aligned: true, partial: false },
      integrityOk: true,
    });
    expect(section.rows).toHaveLength(1);
    expect(section.rows[0].item_name).toBe("Truffle Risotto");
  });

  it("validates clean executive package", () => {
    const pkg = buildExecutiveUnifiedExportPackage({
      branchId: "khobar",
      exportRange: {
        startDate: "2026-05-17",
        endDate: "2026-05-24",
        periodLabel: "17 May - 24 May 2026",
      },
      salesBatch: {
        period_start: "2026-05-17",
        period_end: "2026-05-24",
      },
      waiterItems: [
        {
          waiter_name: "Mohamed Azhar",
          raw_item_name: "Truffle Risotto",
          matched_menu_item_name: "Truffle Risotto",
          quantity_sold: 10,
          net_sales: 500,
          foodics_class: "menu_item",
          import_status: "matched",
        },
        {
          waiter_name: "Azhar",
          raw_item_name: "Truffle Risotto",
          matched_menu_item_name: "Truffle Risotto",
          quantity_sold: 5,
          net_sales: 250,
          foodics_class: "menu_item",
          import_status: "matched",
        },
        {
          waiter_name: "Ronald",
          raw_item_name: "****************************",
          quantity_sold: 406,
          net_sales: 0,
          import_status: "corrupt",
        },
      ],
      reviewEvents: [],
      menuSessions: 100,
    });

    expect(pkg.summary.top_seller?.item).toBe("Truffle Risotto");
    expect(filterExecutiveAggregatedItems(pkg.sections.topItems.rows).length).toBe(
      pkg.sections.topItems.rows.length,
    );
    expect(
      pkg.sections.waiterSales.rows.filter((r) => r.waiter === "Azhar"),
    ).toHaveLength(1);
    expect(validateExecutiveExportIntegrity(pkg).valid).toBe(true);
  });
});
