/** Pure selection model for Menu Manager boards. */

export function createSelectionState(overrides = {}) {
  return {
    selectedIds: [],
    anchorId: null,
    focusId: null,
    ...overrides,
  };
}

export function flattenVisibleItems(sections = []) {
  const rows = [];
  (sections || []).forEach((section) => {
    (section.items || []).forEach((item, indexInSection) => {
      rows.push({
        itemId: item.id,
        sectionId: section.id,
        indexInSection,
        item,
      });
    });
  });
  return rows;
}

export function toggleIdInList(ids, id) {
  const set = new Set(ids);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return [...set];
}

export function selectSingle(state, itemId) {
  return {
    selectedIds: itemId ? [itemId] : [],
    anchorId: itemId || null,
    focusId: itemId || null,
  };
}

export function toggleSelect(state, itemId) {
  if (!itemId) return state;
  const selectedIds = toggleIdInList(state.selectedIds || [], itemId);
  return {
    selectedIds,
    anchorId: itemId,
    focusId: itemId,
  };
}

/**
 * Shift-range selection stays inside one section (Finder-like predictability).
 * Additive=true keeps prior selection and unions the range.
 */
export function selectRange(state, sections, itemId, { additive = false } = {}) {
  const flat = flattenVisibleItems(sections);
  const target = flat.find((row) => row.itemId === itemId);
  if (!target) return selectSingle(state, itemId);

  const anchorId = state.anchorId && flat.some((r) => r.itemId === state.anchorId)
    ? state.anchorId
    : itemId;
  const anchor = flat.find((row) => row.itemId === anchorId) || target;

  if (anchor.sectionId !== target.sectionId) {
    return selectSingle(state, itemId);
  }

  const sectionRows = flat.filter((row) => row.sectionId === target.sectionId);
  const a = sectionRows.findIndex((row) => row.itemId === anchor.itemId);
  const b = sectionRows.findIndex((row) => row.itemId === target.itemId);
  if (a < 0 || b < 0) return selectSingle(state, itemId);
  const [start, end] = a < b ? [a, b] : [b, a];
  const rangeIds = sectionRows.slice(start, end + 1).map((row) => row.itemId);

  if (!additive) {
    return {
      selectedIds: rangeIds,
      anchorId: anchor.itemId,
      focusId: itemId,
    };
  }

  const merged = new Set([...(state.selectedIds || []), ...rangeIds]);
  return {
    selectedIds: [...merged],
    anchorId: anchor.itemId,
    focusId: itemId,
  };
}

export function selectAllVisible(sections) {
  const ids = flattenVisibleItems(sections).map((row) => row.itemId);
  return {
    selectedIds: ids,
    anchorId: ids[0] || null,
    focusId: ids[ids.length - 1] || null,
  };
}

export function clearSelection() {
  return createSelectionState();
}

export function ensureSelectionIncludes(state, itemId) {
  if (!itemId) return state;
  if ((state.selectedIds || []).includes(itemId)) {
    return { ...state, focusId: itemId };
  }
  return selectSingle(state, itemId);
}

export function selectionCount(state) {
  return (state?.selectedIds || []).length;
}
