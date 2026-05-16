import { trackEvent, getSessionId, makeMenuItemId } from "./analytics";

const KEY_PREFIX = "nac_img_expand_";

export function trackImageExpand({
  categoryId,
  sectionTitleEn,
  menuItem,
  language,
  visibleDurationMs = null,
}) {
  const itemId =
    categoryId && sectionTitleEn && menuItem?.en
      ? makeMenuItemId(categoryId, sectionTitleEn, menuItem.en)
      : null;
  if (!itemId) return;

  try {
    const sessionId = getSessionId();
    const key = `${KEY_PREFIX}${sessionId}_${itemId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    /* allow if storage unavailable */
  }

  const sectionSlug = sectionTitleEn?.toLowerCase?.().replaceAll(" ", "-") ?? null;
  trackEvent({
    event_type: "image_expand",
    language,
    category_id: categoryId,
    section_id: sectionSlug,
    item_id: itemId,
    item_name_en: menuItem.en,
    item_name_ar: menuItem.ar,
    metadata: {
      visible_duration_ms: visibleDurationMs,
    },
  });
}
