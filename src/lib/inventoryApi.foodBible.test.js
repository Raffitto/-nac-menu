jest.mock("./supabase", () => ({
  supabase: {
    from: jest.fn(),
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
    },
  },
}));

jest.mock("./menuApi", () => ({
  fetchMenuCatalogueForBranch: jest.fn(),
}));

import { supabase } from "./supabase";
import { fetchMenuCatalogueForBranch } from "./menuApi";
import { fetchFoodBibleOverview, clearFoodBibleCaches } from "./inventoryApi";
import { READINESS } from "../inventory/foodBible";

const mockFrom = supabase.from;

function emptyQuery() {
  const chain = {
    eq: jest.fn(() => chain),
    or: jest.fn(() => chain),
    order: jest.fn(() => Promise.resolve({ data: [], error: null })),
    in: jest.fn(() => chain),
  };
  return {
    select: jest.fn(() => chain),
    insert: jest.fn(),
    update: jest.fn(),
  };
}

describe("fetchFoodBibleOverview", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearFoodBibleCaches();
    mockFrom.mockImplementation(() => emptyQuery());
  });

  test("lists menu items without recipes and marks them missing", async () => {
    fetchMenuCatalogueForBranch.mockResolvedValue({
      data: {
        categories: [{ id: "cat-1", name_en: "Mains" }],
        sections: [{ id: "sec-1", category_id: "cat-1", name_en: "Plates" }],
        items: [
          { id: "menu-1", section_id: "sec-1", name_en: "Burrata", active: true, sold_out: false },
          { id: "menu-2", section_id: "sec-1", name_en: "Latte", active: false, sold_out: false },
        ],
      },
      error: null,
    });

    const overview = await fetchFoodBibleOverview({ branchId: "khobar" });

    expect(fetchMenuCatalogueForBranch).toHaveBeenCalledWith(expect.objectContaining({ branchId: "khobar" }));
    expect(overview.summary.totalMenuItems).toBe(1);
    expect(overview.summary.liveKitchenItems).toBe(1);
    expect(overview.summary.missing).toBe(1);
    expect(overview.summary.coveragePct).toBe(0);
    expect(overview.rows.filter((row) => row.kind === "menu_item")).toHaveLength(2);
    expect(overview.detailsDeferred).toBe(true);
    expect(overview.meta.requestCount).toBe(7);
    expect(mockFrom).toHaveBeenCalledTimes(4);
  });

  test("deduplicates linked placements and keeps distinct ungrouped items", async () => {
    fetchMenuCatalogueForBranch.mockResolvedValue({
      data: {
        categories: [{ id: "cat-1", name_en: "All day" }],
        sections: [
          { id: "sec-1", category_id: "cat-1", name_en: "Breakfast" },
          { id: "sec-2", category_id: "cat-1", name_en: "Daytime" },
        ],
        items: [
          {
            id: "a",
            placement_group_id: "group-1",
            section_id: "sec-1",
            name_en: "Shakshuka",
            sort_order: 2,
            active: true,
          },
          {
            id: "b",
            placement_group_id: "group-1",
            section_id: "sec-2",
            name_en: "Shakshuka",
            sort_order: 1,
            active: true,
          },
          { id: "c", section_id: "sec-1", name_en: "Latte", sort_order: 1, active: true },
          { id: "d", section_id: "sec-2", name_en: "Latte", sort_order: 1, active: true },
        ],
      },
      error: null,
    });

    const overview = await fetchFoodBibleOverview({ branchId: "khobar" });
    const menuRows = overview.rows.filter((row) => row.kind === "menu_item");

    expect(menuRows).toHaveLength(2);
    expect(menuRows.find((row) => row.identityKey === "pg:group-1")?.placements).toHaveLength(2);
    expect(menuRows.filter((row) => row.displayName === "Latte")).toHaveLength(1);
    expect(menuRows.find((row) => row.displayName === "Latte")?.placements).toHaveLength(2);
  });

  test("returns empty menu summary only when catalogue is genuinely empty", async () => {
    fetchMenuCatalogueForBranch.mockResolvedValue({
      data: { categories: [], sections: [], items: [] },
      error: null,
    });

    const overview = await fetchFoodBibleOverview({ branchId: "khobar" });
    expect(overview.summary.totalMenuItems).toBe(0);
    expect(overview.summary.coveragePct).toBe(0);
    expect(overview.rows.filter((row) => row.kind === "menu_item")).toHaveLength(0);
  });

  test("preserves hidden and sold-out guest status for filters", async () => {
    fetchMenuCatalogueForBranch.mockResolvedValue({
      data: {
        categories: [{ id: "cat-1", name_en: "Drinks" }],
        sections: [{ id: "sec-1", category_id: "cat-1", name_en: "Coffee" }],
        items: [
          { id: "live", section_id: "sec-1", name_en: "Espresso", active: true, sold_out: false },
          { id: "hidden", section_id: "sec-1", name_en: "Seasonal", active: false, sold_out: false },
          { id: "sold", section_id: "sec-1", name_en: "Flat White", active: true, sold_out: true },
        ],
      },
      error: null,
    });

    const overview = await fetchFoodBibleOverview({ branchId: "khobar" });
    const statuses = Object.fromEntries(
      overview.rows.filter((row) => row.kind === "menu_item").map((row) => [row.menuItemId, row.guestStatus]),
    );

    expect(statuses.live).toBe("live");
    expect(statuses.hidden).toBe("hidden");
    expect(statuses.sold).toBe("sold_out");
  });

  test("does not inflate kitchen coverage with duplicate placements or drinks", async () => {
    fetchMenuCatalogueForBranch.mockResolvedValue({
      data: {
        categories: [{ id: "cat-1", name_en: "All day" }],
        sections: [
          { id: "brunch", category_id: "cat-1", name_en: "Brunch" },
          { id: "day", category_id: "cat-1", name_en: "Daytime" },
          { id: "eve", category_id: "cat-1", name_en: "Evening" },
        ],
        items: [
          { id: "1", section_id: "brunch", name_en: "Big NAC", active: true },
          { id: "2", section_id: "day", name_en: "Big NAC", active: true },
          { id: "3", section_id: "eve", name_en: "Big NAC", active: true },
          { id: "4", section_id: "brunch", name_en: "Coca Cola", active: true },
          { id: "5", section_id: "brunch", name_en: "[TEMP VERIFY] Recipe", active: true },
        ],
      },
      error: null,
    });

    const overview = await fetchFoodBibleOverview({ branchId: "khobar" });
    expect(overview.summary.liveKitchenItems).toBe(1);
    expect(overview.summary.drinkCount).toBe(1);
    expect(overview.summary.placementCount).toBe(4);
    expect(overview.summary.uniqueIdentityCount).toBe(2);
    expect(overview.rows.some((row) => /TEMP VERIFY/i.test(row.displayName))).toBe(false);
    expect(overview.rows.find((row) => row.displayName === "Big NAC")?.placementSummary).toMatch(/Brunch/);
  });
});
