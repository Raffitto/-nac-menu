jest.mock("./supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { supabase } from "./supabase";
import { fetchMenuCatalogueForBranch } from "./menuApi";

const mockFrom = supabase.from;

function branchScopedQuery(rows = []) {
  const chain = {
    eq: jest.fn(() => chain),
    order: jest.fn(() => chain),
    then: (resolve) => resolve({ data: rows, error: null }),
  };
  return {
    select: jest.fn(() => chain),
  };
}

describe("fetchMenuCatalogueForBranch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("requires a branch slug", async () => {
    const result = await fetchMenuCatalogueForBranch({});
    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/branch is required/i);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test("queries raw categories, sections, and menu_items for the branch", async () => {
    const categories = [{ id: "cat-1", name_en: "Breakfast", branch_id: "khobar" }];
    const sections = [{ id: "sec-1", category_id: "cat-1", name_en: "Eggs", branch_id: "khobar" }];
    const items = [
      { id: "item-1", section_id: "sec-1", name_en: "Shakshuka", branch_id: "khobar", active: true },
      { id: "item-2", section_id: "sec-1", name_en: "Hidden Latte", branch_id: "khobar", active: false },
    ];

    mockFrom.mockImplementation((table) => {
      if (table === "categories") return branchScopedQuery(categories);
      if (table === "sections") return branchScopedQuery(sections);
      if (table === "menu_items") return branchScopedQuery(items);
      throw new Error(`unexpected table ${table}`);
    });

    const { data, error } = await fetchMenuCatalogueForBranch({ branchId: "khobar" });
    expect(error).toBeNull();
    expect(data.categories).toEqual(categories);
    expect(data.sections).toEqual(sections);
    expect(data.items).toEqual(items);
    expect(mockFrom).toHaveBeenCalledTimes(3);

    const eqCalls = [];
    for (const call of mockFrom.mock.results) {
      const chain = call.value?.select?.mock?.results?.[0]?.value;
      if (chain?.eq?.mock?.calls) eqCalls.push(...chain.eq.mock.calls);
    }
    expect(eqCalls.filter(([column, value]) => column === "branch_id" && value === "khobar")).toHaveLength(3);
  });

  test("includes inactive and sold-out items without guest-menu filtering", async () => {
    const items = [
      { id: "live", section_id: "sec-1", active: true, sold_out: false, branch_id: "khobar" },
      { id: "hidden", section_id: "sec-1", active: false, sold_out: false, branch_id: "khobar" },
      { id: "sold", section_id: "sec-1", active: true, sold_out: true, branch_id: "khobar" },
    ];
    mockFrom.mockImplementation((table) => {
      if (table === "menu_items") return branchScopedQuery(items);
      return branchScopedQuery([]);
    });

    const { data } = await fetchMenuCatalogueForBranch({ branchId: "khobar" });
    expect(data.items).toHaveLength(3);
  });
});
