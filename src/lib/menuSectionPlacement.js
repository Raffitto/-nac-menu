import { formatPlacementLabel } from "./menuPlacements";

/** Stable catalogue key for a logical menu item (linked rows share one key). */
export function catalogueItemKey(row) {
  return row?.placement_group_id || row?.id || "";
}

/** Build section and category lookup maps for catalogue labels. */
export function buildPlacementLookupMaps(sections = [], categories = []) {
  const sectionsById = new Map(sections.map((section) => [section.id, section]));
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  return { sectionsById, categoriesById };
}

/** Collect all section ids currently used by a logical item row set. */
export function collectPlacedSectionIds(rows = []) {
  const sectionIds = new Set();
  rows.forEach((row) => {
    if (row?.section_id) sectionIds.add(row.section_id);
  });
  return sectionIds;
}

/** Build a deduped searchable catalogue from raw branch menu item rows. */
export function buildMenuItemCatalogue(
  rows = [],
  sections = [],
  categories = [],
) {
  const { sectionsById, categoriesById } = buildPlacementLookupMaps(
    sections,
    categories,
  );

  const rowsByKey = new Map();
  rows.forEach((row) => {
    const key = catalogueItemKey(row);
    if (!key) return;
    if (!rowsByKey.has(key)) rowsByKey.set(key, []);
    rowsByKey.get(key).push(row);
  });

  const catalogue = [];
  rowsByKey.forEach((groupRows, key) => {
    const anchor =
      groupRows.find((row) => row.id === key) ||
      groupRows.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0];
    const placedSectionIds = collectPlacedSectionIds(groupRows);
    const primarySection = sectionsById.get(anchor.section_id);
    const primaryCategory = categoriesById.get(primarySection?.category_id);
    const allPlacementLabels = groupRows
      .filter((row) => row.section_id)
      .map((row) => {
        const section = sectionsById.get(row.section_id);
        const category = categoriesById.get(section?.category_id);
        return formatPlacementLabel(
          category?.name_en || category?.slug,
          section?.name_en,
        );
      });
    const isUnplaced = placedSectionIds.size === 0;

    catalogue.push({
      id: anchor.id,
      dedupeKey: key,
      name_en: anchor.name_en || "",
      name_ar: anchor.name_ar || "",
      image: anchor.image || "",
      price: anchor.price || "",
      active: anchor.active !== false,
      sold_out: Boolean(anchor.sold_out),
      placement_group_id: anchor.placement_group_id || null,
      primarySectionId: anchor.section_id || null,
      primaryLocationLabel: isUnplaced
        ? "Unplaced — choose a section"
        : formatPlacementLabel(
            primaryCategory?.name_en || primaryCategory?.slug,
            primarySection?.name_en,
          ),
      allPlacementLabels,
      placedSectionIds: [...placedSectionIds],
      isUnplaced,
      row: anchor,
    });
  });

  return catalogue.sort((a, b) => a.name_en.localeCompare(b.name_en));
}

export function filterCatalogueSearch(catalogue, query = "") {
  const term = String(query || "").trim().toLowerCase();
  if (!term) return catalogue;
  return catalogue.filter((entry) => {
    const haystack = [
      entry.name_en,
      entry.name_ar,
      entry.primaryLocationLabel,
      ...(entry.allPlacementLabels || []),
      entry.price,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });
}

export function isCatalogueItemInDestination(entry, destinationSectionId) {
  if (!entry || !destinationSectionId) return false;
  return entry.placedSectionIds.includes(destinationSectionId);
}

export function partitionCatalogueForDestination(catalogue, destinationSectionId) {
  const available = [];
  const alreadyPlaced = [];
  catalogue.forEach((entry) => {
    if (isCatalogueItemInDestination(entry, destinationSectionId)) {
      alreadyPlaced.push(entry);
    } else {
      available.push(entry);
    }
  });
  return { available, alreadyPlaced };
}

export function buildPlacementAdditionPayload(itemRow, destinationSectionId) {
  return {
    itemId: itemRow.id,
    destinationSectionId,
    primarySectionId: itemRow.section_id,
    placementGroupId: itemRow.placement_group_id || null,
  };
}
