import {
  buildExtraPlacementsFromMembers,
  collectUsedPlacementKeys,
  formatPlacementLabel,
  hydratePlacementCategoryIds,
  normalizePlacements,
  placementKey,
  reorderPlacementRows,
  validatePlacements,
} from "./menuPlacements";

const sections = [
  { id: "breakfast-eggs", category_id: "breakfast" },
  { id: "breakfast-bakery", category_id: "breakfast" },
  { id: "daytime-mains", category_id: "daytime" },
  { id: "dinner-mains", category_id: "dinner" },
];

describe("menu placements", () => {
  test("supports any number of distinct additional category and section pairs", () => {
    const primary = {
      category_id: "breakfast",
      section_id: "breakfast-eggs",
    };
    const extras = [
      { category_id: "breakfast", section_id: "breakfast-bakery" },
      { category_id: "daytime", section_id: "daytime-mains" },
      { category_id: "dinner", section_id: "dinner-mains" },
    ];

    const result = validatePlacements(primary, extras, sections);
    expect(result.ok).toBe(true);
    expect(result.placements).toHaveLength(4);
  });

  test("rejects incomplete additional rows with a useful error", () => {
    const result = validatePlacements(
      { category_id: "breakfast", section_id: "breakfast-eggs" },
      [{ category_id: "daytime", section_id: "" }],
      sections,
    );
    expect(result).toEqual({
      ok: false,
      message: "Choose a category and section for every additional placement.",
    });
  });

  test("rejects a section selected from a different category", () => {
    const result = validatePlacements(
      { category_id: "breakfast", section_id: "breakfast-eggs" },
      [{ category_id: "daytime", section_id: "breakfast-bakery" }],
      sections,
    );
    expect(result).toEqual({
      ok: false,
      message: "Each placement section must belong to its selected category.",
    });
  });

  test("rejects exact duplicate category and section pairs", () => {
    const result = validatePlacements(
      { category_id: "breakfast", section_id: "breakfast-eggs" },
      [{ category_id: "breakfast", section_id: "breakfast-eggs" }],
      sections,
    );
    expect(result).toEqual({
      ok: false,
      message: "Duplicate category/section placement.",
    });
  });

  test("deduplicates by exact pair rather than section label", () => {
    const placements = normalizePlacements(
      { category_id: "breakfast", section_id: "breakfast-eggs" },
      [
        { category_id: "daytime", section_id: "daytime-mains" },
        { category_id: "dinner", section_id: "dinner-mains" },
      ],
    );
    expect(placements.map((row) => placementKey(row.category_id, row.section_id))).toEqual([
      "breakfast:breakfast-eggs",
      "daytime:daytime-mains",
      "dinner:dinner-mains",
    ]);
  });

  test("formats placement labels for chip display", () => {
    expect(formatPlacementLabel("Breakfast", "Eggs")).toBe("Breakfast → Eggs");
  });

  test("reorders additional placement rows without mutating the source array", () => {
    const rows = [
      { rowKey: "a", category_id: "daytime", section_id: "daytime-mains" },
      { rowKey: "b", category_id: "daytime", section_id: "daytime-salads" },
    ];
    const reordered = reorderPlacementRows(rows, 0, 1);
    expect(reordered.map((row) => row.rowKey)).toEqual(["b", "a"]);
    expect(rows.map((row) => row.rowKey)).toEqual(["a", "b"]);
  });

  test("hydrates missing category ids from the sections catalog", () => {
    const hydrated = hydratePlacementCategoryIds(
      [{ rowKey: "saved-1", section_id: "daytime-mains" }],
      sections,
    );
    expect(hydrated[0].category_id).toBe("daytime");
  });

  test("builds additional placements from linked group members", () => {
    const extras = buildExtraPlacementsFromMembers(
      [
        { id: "primary", section_id: "breakfast-eggs" },
        { id: "linked-1", section_id: "daytime-mains" },
        { id: "linked-2", section_id: "dinner-mains" },
      ],
      "primary",
      sections,
      (itemId) => `saved-${itemId}`,
    );
    expect(extras).toEqual([
      {
        itemId: "linked-1",
        rowKey: "saved-linked-1",
        category_id: "daytime",
        section_id: "daytime-mains",
      },
      {
        itemId: "linked-2",
        rowKey: "saved-linked-2",
        category_id: "dinner",
        section_id: "dinner-mains",
      },
    ]);
  });

  test("collectUsedPlacementKeys excludes a row under edit", () => {
    const keys = collectUsedPlacementKeys(
      { category_id: "breakfast", section_id: "breakfast-eggs" },
      [{ rowKey: "row-1", category_id: "daytime", section_id: "daytime-mains" }],
      { excludeRowKey: "row-1" },
    );
    expect(keys.has("breakfast:breakfast-eggs")).toBe(true);
    expect(keys.has("daytime:daytime-mains")).toBe(false);
  });
});
