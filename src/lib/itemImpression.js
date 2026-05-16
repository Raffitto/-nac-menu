import { trackEvent, getSessionId, makeMenuItemId } from "./analytics";

const IMPRESSED_KEY_PREFIX = "nac_impressed_";
const THRESHOLD = 0.45;
const MIN_VISIBLE_MS = 400;

function getImpressedSet(sessionId) {
  try {
    const raw = sessionStorage.getItem(`${IMPRESSED_KEY_PREFIX}${sessionId}`);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function markImpressed(sessionId, itemId) {
  try {
    const set = getImpressedSet(sessionId);
    set.add(itemId);
    sessionStorage.setItem(`${IMPRESSED_KEY_PREFIX}${sessionId}`, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

function getScrollDepth() {
  if (typeof window === "undefined") return 0;
  const doc = document.documentElement;
  const scrollTop = window.scrollY || doc.scrollTop || 0;
  const max = Math.max(doc.scrollHeight - window.innerHeight, 1);
  return Math.round((scrollTop / max) * 100);
}

function approximatePosition(itemIndex, sectionIndex) {
  const ii = Number(itemIndex) || 0;
  const si = Number(sectionIndex) || 0;
  if (si === 0 && ii < 3) return "top";
  if (ii >= 6 || si >= 2) return "lower";
  if (ii >= 3) return "middle";
  return "top";
}

/**
 * Attach visibility tracking to a menu card element.
 */
export function createItemImpressionRef({
  itemId,
  itemNameEn,
  itemNameAr,
  categoryId,
  sectionId,
  language,
  enabled = true,
  itemIndex = null,
  sectionIndex = null,
}) {
  let observer = null;
  let element = null;
  let visibleSince = null;
  let accumulatedMs = 0;

  const cleanup = () => {
    if (observer && element) {
      observer.unobserve(element);
    }
    observer?.disconnect();
    observer = null;
    element = null;
    visibleSince = null;
  };

  const placementMeta = () => ({
    category_id: categoryId,
    item_index: itemIndex,
    section_index: sectionIndex,
    approximate_position: approximatePosition(itemIndex, sectionIndex),
    viewport_width: typeof window !== "undefined" ? window.innerWidth : null,
    viewport_height: typeof window !== "undefined" ? window.innerHeight : null,
    scroll_depth_at_impression: getScrollDepth(),
  });

  const flushDuration = () => {
    if (!visibleSince || !itemId) return;
    accumulatedMs += Date.now() - visibleSince;
    visibleSince = null;
    if (accumulatedMs >= MIN_VISIBLE_MS) {
      trackEvent({
        event_type: "item_impression_end",
        language,
        category_id: categoryId,
        section_id: sectionId,
        item_id: itemId,
        item_name_en: itemNameEn,
        item_name_ar: itemNameAr,
        metadata: {
          visible_duration_ms: Math.round(accumulatedMs),
          ...placementMeta(),
        },
      });
    }
    accumulatedMs = 0;
  };

  const onIntersect = (entries) => {
    entries.forEach((entry) => {
      if (entry.target !== element) return;
      if (entry.isIntersecting && entry.intersectionRatio >= THRESHOLD) {
        if (!visibleSince) visibleSince = Date.now();
        const sessionId = getSessionId();
        if (itemId && sessionId && !getImpressedSet(sessionId).has(itemId)) {
          markImpressed(sessionId, itemId);
          trackEvent({
            event_type: "item_impression",
            language,
            category_id: categoryId,
            section_id: sectionId,
            item_id: itemId,
            item_name_en: itemNameEn,
            item_name_ar: itemNameAr,
            metadata: {
              intersection_ratio: Math.round(entry.intersectionRatio * 100) / 100,
              ...placementMeta(),
            },
          });
        }
      } else if (visibleSince) {
        flushDuration();
      }
    });
  };

  return (node) => {
    cleanup();
    if (!enabled || !node || !itemId) return;
    element = node;
    if (typeof IntersectionObserver === "undefined") return;
    observer = new IntersectionObserver(onIntersect, {
      threshold: [0, THRESHOLD, 0.6],
      rootMargin: "0px",
    });
    observer.observe(node);
  };
}

export function makeImpressionProps({
  categoryId,
  sectionTitleEn,
  menuItem,
  language,
  enabled,
  itemIndex,
  sectionIndex,
}) {
  const sectionSlug = sectionTitleEn?.toLowerCase?.().replaceAll(" ", "-") ?? null;
  const itemId =
    categoryId && sectionTitleEn && menuItem?.en
      ? makeMenuItemId(categoryId, sectionTitleEn, menuItem.en)
      : null;
  return {
    itemId,
    itemNameEn: menuItem?.en,
    itemNameAr: menuItem?.ar,
    categoryId,
    sectionId: sectionSlug,
    language,
    enabled: Boolean(enabled && itemId),
    itemIndex,
    sectionIndex,
  };
}
