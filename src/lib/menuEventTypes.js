/**
 * Canonical menu_events event_type normalization for BI / funnel consistency.
 */

const EVENT_ALIASES = {
  add_on_click: ["addon_click", "add_on_open"],
  qr_session_start: ["session_start", "qr_scan"],
  item_open: ["item_modal_open"],
};

/** Map legacy aliases to canonical event_type strings. */
export function normalizeEventType(eventType) {
  const raw = String(eventType || "")
    .trim()
    .toLowerCase();
  if (!raw) return "unknown";
  for (const [canonical, aliases] of Object.entries(EVENT_ALIASES)) {
    if (raw === canonical || aliases.includes(raw)) return canonical;
  }
  return raw;
}

/** Events that represent category navigation for funnel / top_categories. */
export const CATEGORY_NAV_EVENT_TYPES = [
  "category_open",
  "menu_tab_open",
  "section_open",
];

export function canonicalCategoryOpenCount(byEventType = {}) {
  const b = byEventType && typeof byEventType === "object" ? byEventType : {};
  return CATEGORY_NAV_EVENT_TYPES.reduce(
    (sum, key) => sum + (Number(b[key]) || 0),
    0,
  );
}

/** Merge raw counts with canonical keys (does not remove raw types). */
export function enrichByEventTypeCanonical(byEventType = {}) {
  const out = {};
  for (const [key, value] of Object.entries(byEventType || {})) {
    const canon = normalizeEventType(key);
    out[canon] = (Number(out[canon]) || 0) + (Number(value) || 0);
  }
  out.category_open_canonical = canonicalCategoryOpenCount(out);
  return out;
}

export function isCategoryNavEvent(eventType) {
  return CATEGORY_NAV_EVENT_TYPES.includes(normalizeEventType(eventType));
}
