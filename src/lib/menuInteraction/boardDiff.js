import { buildItemOrderUpdates, findItemLocation } from "../menuManagerOrdering";

/** Compute section_id moves + sort_order updates between two board snapshots. */
export function diffBoardPlacements(beforeSections, afterSections) {
  const moves = [];
  const sectionIds = new Set();

  (afterSections || []).forEach((section) => {
    sectionIds.add(section.id);
    (section.items || []).forEach((item) => {
      const prior = findItemLocation(beforeSections, item.id);
      if (!prior) return;
      if (prior.sectionId !== section.id) {
        moves.push({ itemId: item.id, sectionId: section.id });
      }
    });
  });

  (beforeSections || []).forEach((section) => sectionIds.add(section.id));

  return {
    moves,
    orderUpdates: buildItemOrderUpdates(afterSections, [...sectionIds]),
  };
}

export function findItemInBoard(sections, itemId) {
  return findItemLocation(sections, itemId)?.item || null;
}
