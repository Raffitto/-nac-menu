import { supabase } from "./supabase";
import { getMenuSessionIdOptional } from "./analytics";
import { getBusinessDayKey } from "../dashboard/utils/businessDay";

const REVIEW_SESSION_KEY = "nac_review_session_id";
const DEDUPE_PREFIX = "nac_review_dedupe_";
const DEFAULT_BRANCH =
  process.env.REACT_APP_NAC_BRANCH_ID || "khobar";

const VALID_EVENTS = new Set([
  "qr_scan",
  "review_page_open",
  "review_open",
  "review_generate",
  "review_regenerate",
  "review_copy",
  "copy_review",
  "review_google_click",
  "google_redirect",
  "review_language_change",
]);

const ONCE_PER_SESSION = new Set([
  "qr_scan",
  "review_page_open",
  "review_open",
]);

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

function resolveBranch(ctx) {
  return (ctx.branch_id || ctx.branch || DEFAULT_BRANCH).toLowerCase();
}

function resolveStaff(ctx) {
  const name =
    ctx.employee_name ||
    ctx.employeeName ||
    null;
  const role =
    ctx.employee_role ||
    ctx.employeeRole ||
    null;
  return {
    employee_name: name && String(name).trim() ? String(name).trim() : null,
    employee_role: role && String(role).trim() ? String(role).trim() : null,
  };
}

/**
 * Fire-and-forget review portal analytics. Never throws.
 */
export function trackReviewEvent(ctx = {}) {
  const event_type = ctx.event_type;
  if (!supabase || !event_type || !VALID_EVENTS.has(event_type)) return;

  const review_session_id = getReviewSessionId();
  if (shouldDedupe(event_type, review_session_id)) return;

  const branch_id = resolveBranch(ctx);
  const { employee_name, employee_role } = resolveStaff(ctx);
  const menu_session_id = getMenuSessionIdOptional();

  const payload = {
    event_type,
    branch_id,
    employee_name,
    employee_role,
    review_session_id,
    session_id: menu_session_id,
    language: ctx.language || null,
    generated_text_length:
      ctx.generated_text_length != null
        ? Number(ctx.generated_text_length)
        : null,
    device_type: getDeviceType(),
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    source_url: typeof window !== "undefined" ? window.location.href : null,
    business_day_key: getBusinessDayKey(),
    metadata: {
      ...(ctx.metadata && typeof ctx.metadata === "object" ? ctx.metadata : {}),
      linked_session_id: menu_session_id,
      store: ctx.storeName || ctx.store || null,
    },
  };

  console.log("REVIEW EVENT INSERT", payload);

  void import("./sessionAttribution")
    .then(({ tryLinkMenuReviewSession }) =>
      tryLinkMenuReviewSession({
        branch_id,
        menu_session_id,
        review_session_id,
        employee_name,
        employee_role,
      }),
    )
    .catch(() => {});

  void supabase
    .from("review_events")
    .insert(payload)
    .then(({ error }) => {
      if (error) {
        console.warn("[reviewAnalytics]", error.message, payload);
      }
    })
    .catch(() => {});
}

export function trackReviewQrScan(ctx = {}) {
  trackReviewEvent({ event_type: "qr_scan", ...ctx });
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
