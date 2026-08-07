import {
  buildMenuItemCatalogue,
  filterCatalogueSearch,
  isCatalogueItemInDestination,
  partitionCatalogueForDestination,
} from "./menuSectionPlacement";

const sections = [
  { id: "breakfast-eggs", name_en: "Eggs", category_id: "breakfast" },
  { id: "daytime-eggs", name_en: "Eggs", category_id: "daytime" },
  { id: "daytime-mains", name_en: "Mains", category_id: "daytime" },
];

const categories = [
  { id: "breakfast", name_en: "Breakfast", slug: "breakfast" },
  { id: "daytime", name_en: "Daytime", slug: "daytime" },
];

const rows = [
  {
    id: "item-a",
    name_en: "Shakshuka",
    price: "42 SAR",
    section_id: "breakfast-eggs",
    placement_group_id: "group-1",
    active: true,
    sold_out: false,
  },
  {
    id: "item-b",
    name_en: "Shakshuka",
    price: "42 SAR",
    section_id: "daytime-mains",
    placement_group_id: "group-1",
    active: true,
    sold_out: false,
  },
  {
    id: "item-c",
    name_en: "Avocado Toast",
    price: "36 SAR",
    section_id: "breakfast-eggs",
    placement_group_id: null,
    active: true,
    sold_out: true,
  },
];

describe("menuSectionPlacement", () => {
  test("builds a deduped catalogue with primary location labels", () => {
    const catalogue = buildMenuItemCatalogue(rows, sections, categories);
    expect(catalogue).toHaveLength(2);
    expect(catalogue[0].name_en).toBe("Avocado Toast");
    expect(catalogue[1]).toMatchObject({
      name_en: "Shakshuka",
      primaryLocationLabel: "Breakfast → Eggs",
      placedSectionIds: ["breakfast-eggs", "daytime-mains"],
    });
  });

  test("keeps inactive unplaced items searchable in the manager catalogue", () => {
    const unplaced = {
      id: "seasonal-prawn",
      name_en: "King Prawn Rendang",
      name_ar: "روبيان الملك برندانغ",
      price: "62",
      section_id: null,
      active: false,
      sold_out: false,
    };

    const catalogue = buildMenuItemCatalogue(
      [...rows, unplaced],
      sections,
      categories,
    );
    const staged = catalogue.find((entry) => entry.id === unplaced.id);

    expect(staged).toMatchObject({
      active: false,
      isUnplaced: true,
      primarySectionId: null,
      primaryLocationLabel: "Unplaced — choose a section",
      placedSectionIds: [],
    });
    expect(filterCatalogueSearch(catalogue, "rendang")).toContain(staged);
  });

  test("filters catalogue rows by search term", () => {
    const catalogue = buildMenuItemCatalogue(rows, sections, categories);
    expect(filterCatalogueSearch(catalogue, "avocado")).toHaveLength(1);
    expect(filterCatalogueSearch(catalogue, "daytime")).toHaveLength(1);
  });

  test("marks items already placed in the destination section", () => {
    const catalogue = buildMenuItemCatalogue(rows, sections, categories);
    const shakshuka = catalogue.find((entry) => entry.name_en === "Shakshuka");
    expect(isCatalogueItemInDestination(shakshuka, "daytime-mains")).toBe(true);
    expect(isCatalogueItemInDestination(shakshuka, "daytime-eggs")).toBe(false);
  });

  test("partitions available and already placed rows for the destination", () => {
    const catalogue = buildMenuItemCatalogue(rows, sections, categories);
    const { available, alreadyPlaced } = partitionCatalogueForDestination(
      catalogue,
      "daytime-eggs",
    );
    expect(available.map((entry) => entry.name_en).sort()).toEqual([
      "Avocado Toast",
      "Shakshuka",
    ]);
    expect(alreadyPlaced).toHaveLength(0);

    const daytimeMains = partitionCatalogueForDestination(catalogue, "daytime-mains");
    expect(daytimeMains.available.map((entry) => entry.name_en)).toEqual(["Avocado Toast"]);
    expect(daytimeMains.alreadyPlaced[0].name_en).toBe("Shakshuka");
  });
});
