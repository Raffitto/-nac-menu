/** Menu item multi-placement helpers (Option A: cloned rows + placement_group_id). */

export function newPlacementGroupId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `pg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Unique key for category + section pair. */
export function placementKey(categoryId, sectionId) {
  return `${categoryId || ""}:${sectionId || ""}`;
}

/** Human-readable chip label for a category + section pair. */
export function formatPlacementLabel(categoryName, sectionName) {
  const category = categoryName?.trim() || "Category";
  const section = sectionName?.trim() || "Section";
  return `${category} → ${section}`;
}

/** Keys already used by primary and/or additional placements. */
export function collectUsedPlacementKeys(
  primary,
  extras = [],
  { excludeRowKey = null, extrasOnly = false } = {},
) {
  const keys = new Set();
  if (!extrasOnly && primary?.category_id && primary?.section_id) {
    keys.add(placementKey(primary.category_id, primary.section_id));
  }
  extras.forEach((row) => {
    if (excludeRowKey && row.rowKey === excludeRowKey) return;
    if (row.category_id && row.section_id) {
      keys.add(placementKey(row.category_id, row.section_id));
    }
  });
  return keys;
}

/** Reorder additional placement rows without mutating the input array. */
export function reorderPlacementRows(rows, fromIndex, toIndex) {
  if (fromIndex === toIndex) return rows;
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= rows.length ||
    toIndex >= rows.length
  ) {
    return rows;
  }
  const next = [...rows];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/** Backfill category_id on saved rows from the sections catalog. */
export function hydratePlacementCategoryIds(rows = [], sections = []) {
  const sectionsById = new Map(sections.map((section) => [section.id, section]));
  return rows.map((row) => {
    if (row.category_id) return row;
    const section = sectionsById.get(row.section_id);
    return { ...row, category_id: section?.category_id || "" };
  });
}

/** Build additional placement editor rows from linked group members. */
export function buildExtraPlacementsFromMembers(
  members,
  primaryItemId,
  sections = [],
  createRowKey = (itemId) => `saved-${itemId}`,
) {
  const sectionsById = new Map(sections.map((section) => [section.id, section]));
  return (members || [])
    .filter((member) => member.id !== primaryItemId)
    .map((member) => {
      const section = sectionsById.get(member.section_id);
      return {
        itemId: member.id,
        rowKey: createRowKey(member.id),
        category_id: section?.category_id || "",
        section_id: member.section_id,
      };
    })
    .filter((row) => row.section_id);
}

/** Deduplicate placements; primary wins on conflict. */
export function normalizePlacements(primary, extras = []) {
  const seen = new Set();
  const out = [];

  const add = (row, isPrimary) => {
    if (!row?.section_id || !row?.category_id) return;
    const key = placementKey(row.category_id, row.section_id);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...row, isPrimary: Boolean(isPrimary) });
  };

  add(primary, true);
  extras.forEach((row) => add(row, false));
  return out;
}

export function validatePlacements(primary, extras = [], sections = []) {
  if (!primary?.section_id) {
    return { ok: false, message: "Primary section is required." };
  }
  if (!primary?.category_id) {
    return { ok: false, message: "Primary category is required." };
  }
  if (extras.some((row) => !row?.category_id || !row?.section_id)) {
    return {
      ok: false,
      message: "Choose a category and section for every additional placement.",
    };
  }

  if (sections.length > 0) {
    const sectionsById = new Map(sections.map((section) => [section.id, section]));
    const invalid = [primary, ...extras].find((row) => {
      const section = sectionsById.get(row.section_id);
      return !section || section.category_id !== row.category_id;
    });
    if (invalid) {
      return {
        ok: false,
        message: "Each placement section must belong to its selected category.",
      };
    }
  }

  const normalized = normalizePlacements(primary, extras);
  const extraCount = normalized.filter((p) => !p.isPrimary).length;
  if (extraCount !== extras.length) {
    return { ok: false, message: "Duplicate category/section placement." };
  }
  return { ok: true, placements: normalized };
}

/** Build admin badge text for linked copies in other categories. */
export function formatLinkedPlacementBadge(item, selectedCategoryId, groupSummary) {
  if (!item?.placement_group_id || !groupSummary) return null;
  const summary = groupSummary[item.placement_group_id];
  if (!summary || summary.total < 2) return null;

  const otherNames = summary.categories.filter(
    (name, idx) => summary.categoryIds[idx] !== selectedCategoryId,
  );
  if (otherNames.length > 0) {
    return `Also in: ${[...new Set(otherNames)].join(", ")}`;
  }
  return "Linked item";
}

/** Map placement_group_id → { total, categories, categoryIds }. */
export function buildPlacementGroupSummary(members, sectionsById, categoriesById) {
  const summary = {};
  (members || []).forEach((row) => {
    const gid = row.placement_group_id;
    if (!gid) return;
    const sec = sectionsById[row.section_id];
    const catId = sec?.category_id;
    const cat = catId ? categoriesById[catId] : null;
    const catName = cat?.name_en || cat?.slug || "Menu";
    if (!summary[gid]) {
      summary[gid] = { total: 0, categories: [], categoryIds: [] };
    }
    summary[gid].total += 1;
    if (catId && !summary[gid].categoryIds.includes(catId)) {
      summary[gid].categoryIds.push(catId);
      summary[gid].categories.push(catName);
    }
  });
  return summary;
}
