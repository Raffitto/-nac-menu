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

export function validatePlacements(primary, extras = []) {
  const normalized = normalizePlacements(primary, extras);
  if (!primary?.section_id) {
    return { ok: false, message: "Primary section is required." };
  }
  if (!primary?.category_id) {
    return { ok: false, message: "Primary category is required." };
  }
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
