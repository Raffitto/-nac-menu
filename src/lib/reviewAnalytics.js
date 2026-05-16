import { supabase } from "./supabase";
import { getSessionId } from "./analytics";
import { getBusinessDayKey } from "../dashboard/utils/businessDay";
import { tryLinkMenuReviewSession } from "./sessionAttribution";

const REVIEW_SESSION_KEY = "nac_review_session_id";
const DEDUPE_PREFIX = "nac_review_dedupe_";
const DEFAULT_BRANCH =
  process.env.REACT_APP_NAC_BRANCH_ID || "khobar";

const VALID_EVENTS = new Set([
  "review_page_open",
  "review_generate",
  "review_copy",
  "review_google_click",
  "review_regenerate",
  "review_language_change",
]);

const ONCE_PER_SESSION = new Set(["review_page_open"]);

function getDeviceType() {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  if (/tablet|ipad/i.test(ua)) return "tablet";
  if (/mobile|iphone|android.*mobile/i.test(ua)) return "mobile";
  return "desktop";
}

export function getReviewSessionId() {
  try {
    let id = sessionStorage.getItem(REVIEW_SESSION_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `rev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(REVIEW_SESSION_KEY, id);
    }
    return id;
  } catch {
    return `rev-${Date.now()}`;
  }
}

function shouldDedupe(eventType, reviewSessionId) {
  if (!ONCE_PER_SESSION.has(eventType)) return false;
  try {
    const key = `${DEDUPE_PREFIX}${eventType}_${reviewSessionId}`;
    if (sessionStorage.getItem(key)) return true;
    sessionStorage.setItem(key, "1");
    return false;
  } catch {
    return false;
  }
}

/**
 * Fire-and-forget review portal analytics. Never throws.
 */
export function trackReviewEvent({
  event_type,
  branch_id,
  employee_name,
  employee_role,
  language,
  generated_text_length,
  metadata = {},
}) {
  if (!supabase || !event_type || !VALID_EVENTS.has(event_type)) return;

  const review_session_id = getReviewSessionId();
  if (shouldDedupe(event_type, review_session_id)) return;

  const menu_session_id = getSessionId();
  const branch = (branch_id || DEFAULT_BRANCH).toLowerCase();

  void tryLinkMenuReviewSession({
    branch_id: branch,
    menu_session_id,
    review_session_id,
    employee_name,
    employee_role,
  });

  const row = {
    event_type,
    branch_id: branch,
    employee_name: employee_name || null,
    employee_role: employee_role || null,
    review_session_id,
    session_id: menu_session_id,
    language: language || null,
    generated_text_length:
      generated_text_length != null ? Number(generated_text_length) : null,
    device_type: getDeviceType(),
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    source_url: typeof window !== "undefined" ? window.location.href : null,
    business_day_key: getBusinessDayKey(),
    metadata: {
      ...metadata,
      linked_session_id: menu_session_id,
    },
  };

  void supabase
    .from("review_events")
    .insert(row)
    .then(({ error }) => {
      if (error && process.env.NODE_ENV === "development") {
        console.warn("[reviewAnalytics]", error.message);
      }
    })
    .catch(() => {});
}

export function trackReviewPageOpen(ctx = {}) {
  trackReviewEvent({ event_type: "review_page_open", ...ctx });
}

export function trackReviewGenerate(textLength, ctx = {}) {
  trackReviewEvent({
    event_type: "review_generate",
    generated_text_length: textLength,
    ...ctx,
  });
}

export function trackReviewRegenerate(textLength, ctx = {}) {
  trackReviewEvent({
    event_type: "review_regenerate",
    generated_text_length: textLength,
    ...ctx,
  });
}

export function trackReviewCopy(ctx = {}) {
  trackReviewEvent({ event_type: "review_copy", ...ctx });
}

export function trackReviewGoogleClick(ctx = {}) {
  trackReviewEvent({ event_type: "review_google_click", ...ctx });
}

export function trackReviewLanguageChange(language, ctx = {}) {
  trackReviewEvent({ event_type: "review_language_change", language, ...ctx });
}
