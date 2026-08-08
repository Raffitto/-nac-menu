import {
  canMoveItemToSection,
  cloneSections,
  findItemLocation,
} from "../menuManagerOrdering";

/**
 * Move a selected group as a contiguous block while preserving relative order.
 * Rejects the whole operation if any member cannot move to the destination.
 */
export function moveSelectedGroup(sections, selectedIds, destinationSectionId, destinationIndex) {
  const selected = [...new Set(selectedIds || [])];
  if (!selected.length) {
    return { sections, error: "Nothing selected", movedIds: [] };
  }

  for (const itemId of selected) {
    const gate = canMoveItemToSection(sections, itemId, destinationSectionId);
    if (!gate.ok) {
      return { sections, error: gate.reason || "Move not allowed", movedIds: [] };
    }
  }

  const next = cloneSections(sections);
  const picked = [];

  // Pull selected items in current visual order across the board.
  const order = [];
  next.forEach((section) => {
    (section.items || []).forEach((item) => {
      if (selected.includes(item.id)) order.push(item.id);
    });
  });

  for (const itemId of order) {
    const loc = findItemLocation(next, itemId);
    if (!loc) continue;
    const [item] = next[loc.sectionIndex].items.splice(loc.itemIndex, 1);
    picked.push({ ...item, section_id: destinationSectionId });
  }

  const destIndex = next.findIndex((section) => section.id === destinationSectionId);
  if (destIndex < 0) {
    return { sections, error: "Destination section not found", movedIds: [] };
  }

  const destItems = next[destIndex].items;
  const insertAt = Math.max(0, Math.min(destinationIndex ?? destItems.length, destItems.length));
  destItems.splice(insertAt, 0, ...picked);
  next[destIndex] = { ...next[destIndex], items: destItems };

  return {
    sections: next,
    error: null,
    movedIds: picked.map((item) => item.id),
    destinationSectionId,
  };
}

/** Reorder a selected group inside one section as a block. */
export function reorderSelectedGroupInSection(
  sections,
  sectionId,
  selectedIds,
  destinationIndex,
) {
  return moveSelectedGroup(sections, selectedIds, sectionId, destinationIndex);
}

export function shouldConfirmBulk(action, count) {
  if (action === "delete" || action === "archive") return count >= 1;
  if (action === "hide" || action === "show" || action === "availability") return count >= 20;
  if (action === "move") return count >= 25;
  return false;
}
