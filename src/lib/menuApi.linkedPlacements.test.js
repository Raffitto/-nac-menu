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
import {
  patchLinkedPlacementMembers,
  resolveLinkedPlacementTargetIds,
  updateMenuItemPlacements,
} from "./menuApi";

const mockFrom = supabase.from;

function menuItemByIdChain(row) {
  return {
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        maybeSingle: jest.fn(() => Promise.resolve({ data: row, error: null })),
      })),
    })),
  };
}

function menuItemMembersChain(rows) {
  return {
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        order: jest.fn(() => Promise.resolve({ data: rows, error: null })),
      })),
    })),
  };
}

function menuItemUpdateChain(onUpdate) {
  const payloadHolder = { value: null };
  const response = () =>
    Promise.resolve({
      data: { id: "updated", ...payloadHolder.value },
      error: null,
    });
  const eqChain = {
    select: jest.fn(() => ({
      maybeSingle: jest.fn(response),
    })),
    maybeSingle: jest.fn(response),
  };
  const api = {
    update: jest.fn((payload) => {
      payloadHolder.value = payload;
      onUpdate?.(payload);
      return api;
    }),
    eq: jest.fn(() => eqChain),
    select: jest.fn(() => api),
    maybeSingle: jest.fn(response),
  };
  return api;
}

beforeEach(() => {
  mockFrom.mockReset();
  supabase.auth.getSession.mockResolvedValue({
    data: { session: { user: { id: "test-user" } } },
    error: null,
  });
});

describe("linked placement sync", () => {
  test("resolveLinkedPlacementTargetIds returns all group members", async () => {
    let menuItemsCalls = 0;
    mockFrom.mockImplementation((table) => {
      if (table !== "menu_items") throw new Error(`unexpected table ${table}`);
      menuItemsCalls += 1;
      if (menuItemsCalls === 1) {
        return menuItemByIdChain({ id: "a", placement_group_id: "group-1" });
      }
      return menuItemMembersChain([
        { id: "a", section_id: "s1", placement_group_id: "group-1" },
        { id: "b", section_id: "s2", placement_group_id: "group-1" },
      ]);
    });

    const { ids, error } = await resolveLinkedPlacementTargetIds("a");
    expect(error).toBeNull();
    expect(ids.sort()).toEqual(["a", "b"]);
  });

  test("patchLinkedPlacementMembers writes the same patch to every linked row", async () => {
    const updates = [];
    let menuItemsCalls = 0;

    mockFrom.mockImplementation((table) => {
      if (table !== "menu_items") throw new Error(`unexpected table ${table}`);
      menuItemsCalls += 1;
      if (menuItemsCalls === 1) {
        return menuItemByIdChain({ id: "a", placement_group_id: "group-1" });
      }
      if (menuItemsCalls === 2) {
        return menuItemMembersChain([
          { id: "a", section_id: "s1", placement_group_id: "group-1" },
          { id: "b", section_id: "s2", placement_group_id: "group-1" },
        ]);
      }
      return menuItemUpdateChain((payload) => updates.push(payload));
    });

    const result = await patchLinkedPlacementMembers("a", {
      name_en: "Sumac Chicken",
      price: "30 SAR",
      sold_out: true,
    });

    expect(result.error).toBeNull();
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ price: "30 SAR", sold_out: true });
    expect(updates[1]).toMatchObject({ price: "30 SAR", sold_out: true });
  });

  test("updateMenuItemPlacements syncs content when placement_group_id exists", async () => {
    const updates = [];
    let menuItemsCalls = 0;

    mockFrom.mockImplementation((table) => {
      if (table === "item_allergens" || table === "item_addons") {
        return {
          delete: jest.fn(() => ({
            eq: jest.fn(() => Promise.resolve({ data: [], error: null })),
          })),
          insert: jest.fn(() => Promise.resolve({ data: [], error: null })),
          select: jest.fn(() => ({
            eq: jest.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        };
      }
      if (table !== "menu_items") throw new Error(`unexpected table ${table}`);

      menuItemsCalls += 1;
      if (menuItemsCalls === 1) {
        return menuItemMembersChain([
          { id: "a", section_id: "s1", placement_group_id: "group-1" },
          { id: "b", section_id: "s2", placement_group_id: "group-1" },
        ]);
      }
      return menuItemUpdateChain((payload) => updates.push(payload));
    });

    await updateMenuItemPlacements({
      itemId: "a",
      contentPayload: { name_en: "Sumac Chicken", price: "30 SAR", desc_en: "Updated" },
      primarySectionId: "s1",
      placementGroupId: "group-1",
      syncLinked: false,
      allergenIds: [],
      addonIds: [],
    });

    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates.every((p) => p.price === "30 SAR" && p.desc_en === "Updated")).toBe(true);
  });
});
