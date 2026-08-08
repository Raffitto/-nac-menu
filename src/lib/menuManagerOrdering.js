/** Pure Menu Manager ordering helpers for drag-and-drop and up/down fallbacks. */

export function sectionDndId(sectionId) {
  return `section:${sectionId}`;
}

export function containerDndId(sectionId) {
  return `container:${sectionId}`;
}

export function itemDndId(itemId) {
  return `item:${itemId}`;
}

export function parseSectionDndId(id) {
  const value = String(id || "");
  return value.startsWith("section:") ? value.slice("section:".length) : null;
}

export function parseContainerDndId(id) {
  const value = String(id || "");
  return value.startsWith("container:") ? value.slice("container:".length) : null;
}

export function parseItemDndId(id) {
  const value = String(id || "");
  return value.startsWith("item:") ? value.slice("item:".length) : null;
}

export function cloneSections(sections = []) {
  return (sections || []).map((section) => ({
    ...section,
    items: [...(section.items || [])],
  }));
}

export function findItemLocation(sections, itemId) {
  for (let sectionIndex = 0; sectionIndex < (sections || []).length; sectionIndex += 1) {
    const items = sections[sectionIndex].items || [];
    const itemIndex = items.findIndex((item) => item.id === itemId);
    if (itemIndex >= 0) {
      return {
        sectionIndex,
        itemIndex,
        sectionId: sections[sectionIndex].id,
        item: items[itemIndex],
      };
    }
  }
  return null;
}

export function reorderArray(list, fromIndex, toIndex) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= list.length ||
    toIndex >= list.length
  ) {
    return list;
  }
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/** Reorder an item inside one section by visual/grid index. */
export function reorderItemWithinSection(sections, sectionId, fromIndex, toIndex) {
  const next = cloneSections(sections);
  const sectionIndex = next.findIndex((section) => section.id === sectionId);
  if (sectionIndex < 0) return sections;
  next[sectionIndex] = {
    ...next[sectionIndex],
    items: reorderArray(next[sectionIndex].items || [], fromIndex, toIndex),
  };
  return next;
}

/** Move item to another section at destination index (append if out of range). */
export function moveItemBetweenSections(
  sections,
  itemId,
  destinationSectionId,
  destinationIndex = null,
) {
  const next = cloneSections(sections);
  const source = findItemLocation(next, itemId);
  if (!source) return { sections, error: "Item not found" };

  const destSectionIndex = next.findIndex((section) => section.id === destinationSectionId);
  if (destSectionIndex < 0) {
    return { sections, error: "Destination section not found" };
  }

  if (source.sectionId === destinationSectionId) {
    const toIndex =
      destinationIndex == null
        ? source.itemIndex
        : Math.max(0, Math.min(destinationIndex, next[source.sectionIndex].items.length - 1));
    return {
      sections: reorderItemWithinSection(next, source.sectionId, source.itemIndex, toIndex),
      error: null,
      sourceSectionId: source.sectionId,
      destinationSectionId,
      item: source.item,
      crossSection: false,
    };
  }

  const [moved] = next[source.sectionIndex].items.splice(source.itemIndex, 1);
  const destItems = next[destSectionIndex].items;
  const insertAt =
    destinationIndex == null
      ? destItems.length
      : Math.max(0, Math.min(destinationIndex, destItems.length));
  destItems.splice(insertAt, 0, { ...moved, section_id: destinationSectionId });
  next[destSectionIndex] = { ...next[destSectionIndex], items: destItems };
  next[source.sectionIndex] = {
    ...next[source.sectionIndex],
    items: next[source.sectionIndex].items,
  };

  return {
    sections: next,
    error: null,
    sourceSectionId: source.sectionId,
    destinationSectionId,
    item: moved,
    crossSection: true,
  };
}

export function reorderSectionsById(sections, activeSectionId, overSectionId) {
  const fromIndex = sections.findIndex((section) => section.id === activeSectionId);
  const toIndex = sections.findIndex((section) => section.id === overSectionId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return sections;
  return reorderArray(cloneSections(sections), fromIndex, toIndex);
}

/**
 * Whether an item can move into a destination section in the current category board.
 * Rejects duplicate placement_group members already living in that section.
 */
export function canMoveItemToSection(sections, itemId, destinationSectionId) {
  const source = findItemLocation(sections, itemId);
  if (!source) return { ok: false, reason: "Item not found" };
  if (!destinationSectionId) return { ok: false, reason: "Destination required" };

  const dest = (sections || []).find((section) => section.id === destinationSectionId);
  if (!dest) return { ok: false, reason: "Destination section not found" };

  if (source.sectionId === destinationSectionId) {
    return { ok: true, reason: null };
  }

  const groupId = source.item.placement_group_id;
  if (groupId) {
    const conflict = (dest.items || []).some(
      (item) => item.id !== itemId && item.placement_group_id === groupId,
    );
    if (conflict) {
      return {
        ok: false,
        reason: "This item already has a linked placement in that section.",
      };
    }
  }

  return { ok: true, reason: null };
}

/** Build deterministic sort_order write payloads from section item arrays. */
export function buildItemOrderUpdates(sections, sectionIds = null) {
  const ids = sectionIds ? new Set(sectionIds) : null;
  const updates = [];
  for (const section of sections || []) {
    if (ids && !ids.has(section.id)) continue;
    (section.items || []).forEach((item, index) => {
      updates.push({ id: item.id, sort_order: index });
    });
  }
  return updates;
}

export function buildSectionOrderUpdates(sections) {
  return (sections || []).map((section, index) => ({
    id: section.id,
    sort_order: index,
  }));
}

/**
 * Resolve drop target for an active item against an over id.
 * Returns destination section + insert index.
 */
export function resolveItemDropTarget(sections, activeItemId, overId) {
  if (!overId) return null;

  const overItemId = parseItemDndId(overId);
  if (overItemId) {
    const overLoc = findItemLocation(sections, overItemId);
    if (!overLoc) return null;
    if (overItemId === activeItemId) {
      return {
        destinationSectionId: overLoc.sectionId,
        destinationIndex: overLoc.itemIndex,
      };
    }
    const activeLoc = findItemLocation(sections, activeItemId);
    let destinationIndex = overLoc.itemIndex;
    if (
      activeLoc &&
      activeLoc.sectionId === overLoc.sectionId &&
      activeLoc.itemIndex < overLoc.itemIndex
    ) {
      destinationIndex = overLoc.itemIndex;
    }
    return {
      destinationSectionId: overLoc.sectionId,
      destinationIndex,
    };
  }

  const overContainerId = parseContainerDndId(overId) || parseSectionDndId(overId);
  if (overContainerId) {
    const dest = (sections || []).find((section) => section.id === overContainerId);
    if (!dest) return null;
    return {
      destinationSectionId: overContainerId,
      destinationIndex: (dest.items || []).length,
    };
  }

  return null;
}
