/** Guest-menu featured / recommended highlight helpers. */

import { isPublicMenuItem } from "./menuVisibility";

export function featuredItemDedupeKey(item) {
  return item?.placementGroupId || item?.id || item?.en || "";
}

function itemMatchesSearch(item, search) {
  const term = String(search || "").toLowerCase().trim();
  if (!term) return true;
  const text = `${item.en || ""} ${item.ar || ""} ${item.descEn || ""} ${item.descAr || ""}`.toLowerCase();
  return text.includes(term);
}

/**
 * Collect highlighted guest items across the full menu tree.
 * Items remain in their normal sections; this list powers the top Recommended area.
 */
export function collectHighlightedGuestItems(
  menuData,
  { isAllowed = () => true, search = "" } = {},
) {
  const seen = new Set();
  const items = [];

  for (const [categoryId, sections] of Object.entries(menuData || {})) {
    for (const section of sections || []) {
      for (const item of section.items || []) {
        if (!item?.featured) continue;
        if (!isPublicMenuItem(item)) continue;
        if (!isAllowed(item)) continue;
        if (!itemMatchesSearch(item, search)) continue;

        const key = featuredItemDedupeKey(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        items.push({
          ...item,
          categoryId,
          sectionTitleEn: section.title?.en || "",
        });
      }
    }
  }

  return items;
}

/** Map DB menu item row to guest-menu highlight fields. */
export function mapGuestMenuHighlightFields(itemRow) {
  return {
    featured: Boolean(itemRow?.featured),
    placementGroupId: itemRow?.placement_group_id || null,
  };
}
