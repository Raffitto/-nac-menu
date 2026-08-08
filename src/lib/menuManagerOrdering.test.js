import {
  buildItemOrderUpdates,
  buildSectionOrderUpdates,
  canMoveItemToSection,
  findItemLocation,
  itemDndId,
  moveItemBetweenSections,
  reorderItemWithinSection,
  reorderSectionsById,
  resolveItemDropTarget,
  sectionDndId,
} from "./menuManagerOrdering";

function board() {
  return [
    {
      id: "sec-nibbles",
      name_en: "Nibbles",
      items: [
        { id: "a", name_en: "A", section_id: "sec-nibbles", price: "10 SAR", calories: "100", hidden_until: "2026-08-09T00:00:00+03:00", active: true, image: "a.jpg" },
        { id: "b", name_en: "B", section_id: "sec-nibbles", price: "11 SAR", calories: "110", hidden_until: null, active: true },
        { id: "c", name_en: "C", section_id: "sec-nibbles", price: "12 SAR", calories: "120", hidden_until: null, active: true },
        { id: "d", name_en: "D", section_id: "sec-nibbles", price: "13 SAR", calories: "130", hidden_until: null, active: true },
      ],
    },
    {
      id: "sec-plates",
      name_en: "Plates",
      items: [
        { id: "e", name_en: "E", section_id: "sec-plates", placement_group_id: "pg-1" },
      ],
    },
    {
      id: "sec-sweets",
      name_en: "Sweets",
      items: [],
    },
  ];
}

describe("menuManagerOrdering", () => {
  test("reorders item within same section (middle and ends)", () => {
    const base = board();
    const middle = reorderItemWithinSection(base, "sec-nibbles", 3, 1);
    expect(middle[0].items.map((i) => i.id)).toEqual(["a", "d", "b", "c"]);

    const firstToLast = reorderItemWithinSection(base, "sec-nibbles", 0, 3);
    expect(firstToLast[0].items.map((i) => i.id)).toEqual(["b", "c", "d", "a"]);

    const lastToFirst = reorderItemWithinSection(base, "sec-nibbles", 3, 0);
    expect(lastToFirst[0].items.map((i) => i.id)).toEqual(["d", "a", "b", "c"]);
  });

  test("wrapped grid order is still linear index order", () => {
    // Visual:
    // 1 2 3 4
    // 5 6 7 8  → move 8 between 2 and 3 => index 7 to index 2
    const sections = [
      {
        id: "grid",
        items: Array.from({ length: 8 }, (_, i) => ({
          id: String(i + 1),
          section_id: "grid",
        })),
      },
    ];
    const next = reorderItemWithinSection(sections, "grid", 7, 2);
    expect(next[0].items.map((i) => i.id)).toEqual(["1", "2", "8", "3", "4", "5", "6", "7"]);
  });

  test("moves item between sections without duplicating", () => {
    const result = moveItemBetweenSections(board(), "d", "sec-plates", 0);
    expect(result.error).toBeNull();
    expect(result.crossSection).toBe(true);
    expect(result.sections[0].items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(result.sections[1].items.map((i) => i.id)).toEqual(["d", "e"]);
    expect(result.sections[1].items[0].section_id).toBe("sec-plates");
    expect(result.sections.flatMap((s) => s.items).filter((i) => i.id === "d")).toHaveLength(1);
  });

  test("blocks duplicate placement_group in destination section", () => {
    const sections = board();
    sections[0].items[0] = {
      ...sections[0].items[0],
      placement_group_id: "pg-1",
    };
    const gate = canMoveItemToSection(sections, "a", "sec-plates");
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/linked placement/i);
  });

  test("reorders sections and builds deterministic sort payloads", () => {
    const next = reorderSectionsById(board(), "sec-sweets", "sec-nibbles");
    expect(next.map((s) => s.id)).toEqual(["sec-sweets", "sec-nibbles", "sec-plates"]);
    expect(buildSectionOrderUpdates(next)).toEqual([
      { id: "sec-sweets", sort_order: 0 },
      { id: "sec-nibbles", sort_order: 1 },
      { id: "sec-plates", sort_order: 2 },
    ]);
    expect(buildItemOrderUpdates(next, ["sec-nibbles"])).toEqual([
      { id: "a", sort_order: 0 },
      { id: "b", sort_order: 1 },
      { id: "c", sort_order: 2 },
      { id: "d", sort_order: 3 },
    ]);
  });

  test("resolveItemDropTarget supports item and empty section targets", () => {
    const sections = board();
    expect(resolveItemDropTarget(sections, "d", itemDndId("b"))).toEqual({
      destinationSectionId: "sec-nibbles",
      destinationIndex: 1,
    });
    expect(resolveItemDropTarget(sections, "d", sectionDndId("sec-sweets"))).toEqual({
      destinationSectionId: "sec-sweets",
      destinationIndex: 0,
    });
  });

  test("reorder helpers do not mutate commercial fields", () => {
    const before = board();
    const snapshot = JSON.stringify(before[0].items[0]);
    const next = reorderItemWithinSection(before, "sec-nibbles", 0, 2);
    const moved = findItemLocation(next, "a").item;
    expect(moved.price).toBe("10 SAR");
    expect(moved.calories).toBe("100");
    expect(moved.hidden_until).toBe("2026-08-09T00:00:00+03:00");
    expect(moved.image).toBe("a.jpg");
    expect(moved.active).toBe(true);
    expect(JSON.stringify(before[0].items[0])).toBe(snapshot);
  });
});
