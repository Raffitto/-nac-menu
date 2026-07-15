import {
  normalizePlacements,
  placementKey,
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
});
