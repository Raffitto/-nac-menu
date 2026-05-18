import { supabase } from "./supabase";
import { markMenuActivity } from "./sessionAttribution";

const SESSION_KEY = "nac_menu_session_id";
const SESSION_START_KEY = "nac_menu_session_start";
const SESSION_LOGGED_KEY = "nac_menu_qr_session_logged";
const DEFAULT_BRANCH_ID =
  process.env.REACT_APP_NAC_BRANCH_ID || "khobar";

/** Review QR visits must not create menu_events or menu sessions. */
export function isReviewQrVisit() {
  return typeof window !== "undefined" && window.__NAC_REVIEW_MODE__ === true;
}

/** Existing menu session id only — never creates one (for review portal linking). */
export function getMenuSessionIdOptional() {
  try {
    return localStorage.getItem(SESSION_KEY) || null;
  } catch {
    return null;
  }
}

export function getSessionId() {
  if (isReviewQrVisit()) return getMenuSessionIdOptional();
  return getOrCreateSessionId();
}

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

/**
 * Returns true the first time it's called for a new session (new session_id).
 * Used to fire qr_session_start only once per unique visitor.
 */
export function isNewSession() {
  try {
    return localStorage.getItem(SESSION_LOGGED_KEY) !== "true";
  } catch {
    return false;
  }
}

export function markSessionLogged() {
  try {
    localStorage.setItem(SESSION_LOGGED_KEY, "true");
  } catch {}
}

export function getSessionStartTime() {
  try {
    let t = localStorage.getItem(SESSION_START_KEY);
    if (!t) {
      t = String(Date.now());
      localStorage.setItem(SESSION_START_KEY, t);
    }
    return Number(t);
  } catch {
    return Date.now();
  }
}

export function getSessionDurationSeconds() {
  return Math.round((Date.now() - getSessionStartTime()) / 1000);
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
  if (isReviewQrVisit()) return;

  markMenuActivity();
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

/** Top-level menu tab (Dinner | Desserts | Drinks). */
export function trackMenuTabOpen({ language, hostCategoryId, tabId, sourceCategoryId, menuMode }) {
  trackEvent({
    event_type: "menu_tab_open",
    language,
    category_id: hostCategoryId,
    metadata: {
      tab_id: tabId,
      source_category_id: sourceCategoryId,
      menu_mode: menuMode,
    },
  });
}

/** Section entered via pill navigation. */
export function trackSectionOpen({
  language,
  sourceCategoryId,
  hostCategoryId,
  sectionTitleEn,
  menuTabId,
}) {
  const slug = String(sectionTitleEn || "")
    .toLowerCase()
    .replaceAll(" ", "-");
  trackEvent({
    event_type: "section_open",
    language,
    category_id: sourceCategoryId,
    section_id: slug,
    metadata: {
      host_category_id: hostCategoryId,
      menu_tab_id: menuTabId || sourceCategoryId,
    },
  });
}

/** Add-on opened from item modal. */
export function trackAddOnOpen({ language, categoryId, sectionTitleEn, menuItem, addOn }) {
  trackEvent({
    event_type: "add_on_open",
    language,
    category_id: categoryId,
    item_name_en: menuItem?.en,
    item_name_ar: menuItem?.ar,
    add_on_name: addOn?.en,
    metadata: { add_on_name_ar: addOn?.ar },
  });
}

/** Helper for review button clicks (wire to actual button when it exists). */
export function trackReviewClick(language) {
  trackEvent({
    event_type: "review_click",
    language,
    metadata: { target: "google_review" },
  });
}

/** Helper for reservation button clicks (wire to actual button when it exists). */
export function trackReservationClick(language) {
  trackEvent({
    event_type: "reservation_click",
    language,
    metadata: { target: "reservation_link" },
  });
}

/** Generic external link click (Maps, social, etc.). */
export function trackExternalLinkClick(label, href) {
  trackEvent({
    event_type: "external_link_click",
    metadata: { label, href },
  });
}

/** Track time_spent once on page hide / unload. */
export function trackTimeSpent(language) {
  trackEvent({
    event_type: "time_spent",
    language,
    metadata: {
      duration_seconds: getSessionDurationSeconds(),
    },
  });
}
