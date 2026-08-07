jest.mock("./supabase", () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
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
import { fetchFoodBibleOverview } from "./inventoryApi";
import { READINESS } from "../inventory/foodBible";

const mockFrom = supabase.from;
const mockRpc = supabase.rpc;

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
    mockFrom.mockImplementation(() => emptyQuery());
    mockRpc.mockResolvedValue({
      data: { summary: {}, products: [], recipes: [], ingredientsMissingOrStaleCost: [] },
      error: null,
    });
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

    expect(fetchMenuCatalogueForBranch).toHaveBeenCalledWith({ branchId: "khobar" });
    expect(overview.summary.totalMenuItems).toBe(2);
    expect(overview.summary.missing).toBe(2);
    expect(overview.summary.coveragePct).toBe(0);
    expect(overview.rows.filter((row) => row.kind === "menu_item")).toHaveLength(2);
    expect(overview.rows.every((row) => row.readiness === READINESS.MISSING)).toBe(true);
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

    expect(menuRows).toHaveLength(3);
    expect(menuRows.find((row) => row.identityKey === "group-1")?.placements).toHaveLength(2);
    expect(menuRows.filter((row) => row.displayName === "Latte")).toHaveLength(2);
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
});
