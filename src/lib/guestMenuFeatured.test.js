import {
  collectHighlightedGuestItems,
  featuredItemDedupeKey,
  mapGuestMenuHighlightFields,
} from "./guestMenuFeatured";

const menuData = {
  breakfast: [
    {
      title: { en: "Eggs", ar: "بيض" },
      items: [
        {
          id: "eggs-1",
          en: "Shakshuka",
          ar: "شكشوكة",
          featured: true,
          soldOut: false,
          allergens: [],
          tags: [],
        },
        {
          id: "eggs-2",
          en: "Inactive Highlight",
          ar: "غير نشط",
          featured: true,
          active: false,
          soldOut: false,
          allergens: [],
          tags: [],
        },
      ],
    },
  ],
  daytime: [
    {
      title: { en: "Mains", ar: "أطباق رئيسية" },
      items: [
        {
          id: "main-1",
          en: "Sumac Chicken",
          ar: "دجاج سماق",
          featured: true,
          placementGroupId: "group-1",
          soldOut: true,
          allergens: [],
          tags: [],
        },
        {
          id: "main-1-copy",
          en: "Sumac Chicken",
          ar: "دجاج سماق",
          featured: true,
          placementGroupId: "group-1",
          soldOut: true,
          allergens: [],
          tags: [],
        },
        {
          id: "main-2",
          en: "Salad Bowl",
          ar: "سلطة",
          featured: false,
          soldOut: false,
          allergens: [],
          tags: ["vegan"],
        },
      ],
    },
  ],
};

describe("guestMenuFeatured", () => {
  test("maps database featured state onto guest menu items", () => {
    expect(
      mapGuestMenuHighlightFields({
        featured: true,
        placement_group_id: "group-1",
      }),
    ).toEqual({
      featured: true,
      placementGroupId: "group-1",
    });
  });

  test("collects multiple highlighted items and dedupes linked placements", () => {
    const items = collectHighlightedGuestItems(menuData);
    expect(items.map((item) => item.en)).toEqual(["Shakshuka", "Sumac Chicken"]);
    expect(items[1].soldOut).toBe(true);
  });

  test("never includes inactive highlighted items because they are absent from public menu data", () => {
    const publicMenuData = {
      breakfast: [
        {
          title: { en: "Eggs", ar: "بيض" },
          items: menuData.breakfast[0].items.filter((item) => item.active !== false),
        },
      ],
    };
    const items = collectHighlightedGuestItems(publicMenuData);
    expect(items.some((item) => item.en === "Inactive Highlight")).toBe(false);
  });

  test("respects allergen and diet filters", () => {
    const items = collectHighlightedGuestItems(menuData, {
      isAllowed: (item) => item.tags?.includes("vegan"),
    });
    expect(items).toHaveLength(0);
  });

  test("respects search filters", () => {
    const items = collectHighlightedGuestItems(menuData, { search: "sumac" });
    expect(items).toHaveLength(1);
    expect(items[0].en).toBe("Sumac Chicken");
  });

  test("returns an empty list when no highlighted items remain", () => {
    const items = collectHighlightedGuestItems({
      daytime: [
        {
          title: { en: "Mains", ar: "أطباق" },
          items: [
            {
              id: "plain",
              en: "Plain Item",
              featured: false,
              allergens: [],
            },
          ],
        },
      ],
    });
    expect(items).toEqual([]);
  });

  test("dedupe key prefers placement group id", () => {
    expect(
      featuredItemDedupeKey({ id: "a", placementGroupId: "group-1" }),
    ).toBe("group-1");
  });
});
