import { supabase } from "./supabase";

const SESSION_KEY = "nac_menu_session_id";
const DEFAULT_BRANCH_ID =
  process.env.REACT_APP_NAC_BRANCH_ID || "khobar";

function getOrCreateSessionId() {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `nac-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return `session-${Date.now()}`;
  }
}

function getDeviceType() {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  if (/tablet|ipad|playbook|silk/i.test(ua)) return "tablet";
  if (/mobile|iphone|ipod|android.*mobile|webos|blackberry/i.test(ua))
    return "mobile";
  return "desktop";
}

/**
 * Stable id for analytics (not necessarily unique globally; scoped by category + section).
 */
export function makeMenuItemId(categoryId, sectionTitleEn, itemNameEn) {
  const slug = (s) =>
    String(s)
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\u0600-\u06ff-]/gi, "");
  return [categoryId, slug(sectionTitleEn), slug(itemNameEn)]
    .filter(Boolean)
    .join("::");
}

/**
 * Fire-and-forget Supabase insert. Never throws; failures stay off the critical path.
 */
export function trackEvent(payload) {
  if (!supabase || !payload?.event_type) return;

  const session_id = getOrCreateSessionId();
  const branch_id = payload.branch_id ?? DEFAULT_BRANCH_ID;

  const baseMetadata = {
    page_path:
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search || ""}`
        : null,
    referrer:
      typeof document !== "undefined" ? document.referrer || null : null,
    user_agent:
      typeof navigator !== "undefined" ? navigator.userAgent : null,
    device_type: getDeviceType(),
  };

  const row = {
    event_type: payload.event_type,
    branch_id,
    session_id,
    language: payload.language ?? null,
    category_id: payload.category_id ?? null,
    section_id: payload.section_id ?? null,
    item_id: payload.item_id ?? null,
    item_name_en: payload.item_name_en ?? null,
    item_name_ar: payload.item_name_ar ?? null,
    search_query: payload.search_query ?? null,
    selected_allergens: payload.selected_allergens ?? null,
    add_on_name: payload.add_on_name ?? null,
    metadata: {
      ...baseMetadata,
      ...(payload.metadata && typeof payload.metadata === "object"
        ? payload.metadata
        : {}),
    },
  };

  void supabase
    .from("menu_events")
    .insert(row)
    .then(({ error }) => {
      if (error && process.env.NODE_ENV === "development") {
        console.warn("[analytics]", error.message);
      }
    })
    .catch(() => {});
}

/** Optional helper for future review / Maps / booking links. */
export function trackExternalLinkClick(label, href) {
  trackEvent({
    event_type: "external_link_click",
    metadata: { label, href },
  });
}
