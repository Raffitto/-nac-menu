jest.mock("./supabase", () => ({
  supabase: {
    from: jest.fn(),
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { user: { id: "test-user" } } },
        error: null,
      }),
    },
  },
}));

import { supabase } from "./supabase";
import { addExistingItemsToSection } from "./menuApi";

const mockFrom = supabase.from;

function relationTable() {
  return {
    delete: jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ data: [], error: null })),
    })),
    insert: jest.fn(() => Promise.resolve({ data: [], error: null })),
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        order: jest.fn(() => Promise.resolve({ data: [], error: null })),
      })),
    })),
  };
}

function menuItemsTable({ members = [], inserts = [] } = {}) {
  return {
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        order: jest.fn(() => Promise.resolve({ data: members, error: null })),
        maybeSingle: jest.fn(() =>
          Promise.resolve({
            data: {
              id: "item-a",
              name_en: "Shakshuka",
              section_id: "breakfast-eggs",
              placement_group_id: "group-1",
            },
            error: null,
          }),
        ),
      })),
    })),
    insert: jest.fn((payload) => {
      inserts.push(payload.section_id);
      return {
        select: jest.fn(() => ({
          single: jest.fn(() =>
            Promise.resolve({
              data: { id: "new-placement", ...payload },
              error: null,
            }),
          ),
        })),
      };
    }),
    update: jest.fn(() => ({
      eq: jest.fn(() => ({
        select: jest.fn(() => ({
          maybeSingle: jest.fn(() =>
            Promise.resolve({
              data: { id: "updated", name_en: "Shakshuka" },
              error: null,
            }),
          ),
        })),
        maybeSingle: jest.fn(() =>
          Promise.resolve({
            data: { id: "updated", name_en: "Shakshuka" },
            error: null,
          }),
        ),
      })),
    })),
  };
}

beforeEach(() => {
  mockFrom.mockReset();
  supabase.auth.getSession.mockResolvedValue({
    data: { session: { user: { id: "test-user" } } },
    error: null,
  });
});

describe("addExistingItemsToSection", () => {
  test("adds linked placements through updateMenuItemPlacements without duplicating content rows manually", async () => {
    const inserts = [];
    mockFrom.mockImplementation((table) => {
      if (table === "item_allergens" || table === "item_addons") return relationTable();
      if (table !== "menu_items") throw new Error(`unexpected table ${table}`);
      return menuItemsTable({
        members: [
          { id: "item-a", section_id: "breakfast-eggs", placement_group_id: "group-1" },
        ],
        inserts,
      });
    });

    const { data, error } = await addExistingItemsToSection({
      items: [
        {
          id: "item-a",
          name_en: "Shakshuka",
          section_id: "breakfast-eggs",
          placement_group_id: "group-1",
          branch_id: "khobar",
        },
      ],
      destinationSectionId: "daytime-eggs",
    });

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(inserts).toEqual(["daytime-eggs"]);
  });

  test("skips items already placed in the destination section", async () => {
    mockFrom.mockImplementation((table) => {
      if (table === "item_allergens" || table === "item_addons") return relationTable();
      if (table !== "menu_items") throw new Error(`unexpected table ${table}`);
      return menuItemsTable({
        members: [
          { id: "item-a", section_id: "daytime-eggs", placement_group_id: "group-1" },
          { id: "item-b", section_id: "breakfast-eggs", placement_group_id: "group-1" },
        ],
      });
    });

    const { data, error } = await addExistingItemsToSection({
      items: [
        {
          id: "item-a",
          name_en: "Shakshuka",
          section_id: "daytime-eggs",
          placement_group_id: "group-1",
        },
      ],
      destinationSectionId: "daytime-eggs",
    });

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
