import { supabase } from "./supabase";
import { getMenuSessionIdOptional } from "./analytics";
import { getBusinessDayKey } from "../dashboard/utils/businessDay";
import { staffNameForTracking } from "../review/reviewGeneratorShared";

console.log("REVIEW ANALYTICS MODULE LOADED", window.location?.href || "");

const REVIEW_SESSION_KEY = "nac_review_session_id";
const DEDUPE_PREFIX = "nac_review_dedupe_";
const INSERT_TEST_KEY = "nac_review_insert_self_test_done";
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

let supabaseConfigLogged = false;

function logSupabaseConfig() {
  if (supabaseConfigLogged || typeof window === "undefined") return;
  supabaseConfigLogged = true;
  console.log("SUPABASE URL", process.env.REACT_APP_SUPABASE_URL || "(missing)");
  console.log(
    "SUPABASE ANON KEY",
    process.env.REACT_APP_SUPABASE_ANON_KEY ? "set" : "missing",
  );
  console.log("SUPABASE CLIENT", supabase ? "ready" : "NOT CONFIGURED");
}

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

/** One qr_scan / page_open per browser session per branch per staff (not global per session). */
function buildDedupeStorageKey(eventType, reviewSessionId, ctx = {}) {
  const branch = resolveBranch(ctx);
  const { employee_name } = resolveStaff(ctx);
  const staffKey = (employee_name || "_no_staff").toLowerCase();
  return `${DEDUPE_PREFIX}${eventType}_${reviewSessionId}_${branch}_${staffKey}`;
}

function shouldDedupe(eventType, reviewSessionId, ctx = {}) {
  if (!ONCE_PER_SESSION.has(eventType)) return false;
  try {
    const key = buildDedupeStorageKey(eventType, reviewSessionId, ctx);
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
  const rawName = ctx.employee_name ?? ctx.employeeName ?? null;
  const rawRole = ctx.employee_role ?? ctx.employeeRole ?? null;
  const employee_name = staffNameForTracking(rawName);
  const employee_role =
    rawRole && String(rawRole).trim()
      ? String(rawRole).trim().toLowerCase()
      : null;
  return { employee_name, employee_role };
}

function buildReviewEventPayload(ctx = {}) {
  const event_type = ctx.event_type;
  const review_session_id = ctx.review_session_id || getReviewSessionId();
  const branch_id = resolveBranch(ctx);
  const { employee_name, employee_role } = resolveStaff(ctx);
  const menu_session_id = getMenuSessionIdOptional();
  const store_name = ctx.storeName || ctx.store_name || ctx.store || null;

  return {
    event_type,
    branch_id,
    employee_name,
    employee_role,
    store_name:
      store_name && String(store_name).trim()
        ? String(store_name).trim()
        : null,
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
}

/**
 * Insert one review_events row with full console diagnostics (no swallowed errors).
 */
export async function insertReviewEvent(ctx = {}) {
  logSupabaseConfig();

  const event_type = ctx.event_type;
  if (!event_type || !VALID_EVENTS.has(event_type)) {
    console.error("REVIEW EVENT ERROR", "Invalid or missing event_type", event_type);
    return { data: null, error: new Error("invalid event_type") };
  }

  if (!supabase) {
    const err = new Error(
      "Supabase client not configured — check REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY on this deploy",
    );
    console.error("REVIEW EVENT ERROR", err.message);
    return { data: null, error: err };
  }

  const review_session_id = getReviewSessionId();
  if (shouldDedupe(event_type, review_session_id, ctx)) {
    console.log("REVIEW EVENT DEDUPED (skipped insert)", {
      event_type,
      review_session_id,
      dedupe_key: buildDedupeStorageKey(event_type, review_session_id, ctx),
      employee_name: resolveStaff(ctx).employee_name,
      branch_id: resolveBranch(ctx),
    });
    return { data: null, error: null, deduped: true };
  }

  const payload = buildReviewEventPayload({ ...ctx, review_session_id });

  console.log("FINAL REVIEW EVENT PAYLOAD", payload);
  if (event_type === "qr_scan") {
    console.log("QR_SCAN SUPABASE INSERT PAYLOAD", {
      event_type: payload.event_type,
      branch_id: payload.branch_id,
      employee_name: payload.employee_name,
      employee_role: payload.employee_role,
      store_name: payload.store_name,
      review_session_id: payload.review_session_id,
      source_url: payload.source_url,
    });
  }

  const { error } = await supabase.from("review_events").insert(payload);

  console.log("REVIEW EVENT INSERT OK", !error);
  if (error) {
    console.error("REVIEW EVENT ERROR", error);
  }

  if (!error) {
    void import("./sessionAttribution")
      .then(({ tryLinkMenuReviewSession }) =>
        tryLinkMenuReviewSession({
          branch_id: payload.branch_id,
          menu_session_id: payload.session_id,
          review_session_id: payload.review_session_id,
          employee_name: payload.employee_name,
          employee_role: payload.employee_role,
        }),
      )
      .catch((linkErr) => {
        console.error("REVIEW SESSION LINK ERROR", linkErr);
      });
  }

  return { data: null, error };
}

/**
 * One-time manual insert test on review portal load (surfaces RLS / constraint errors).
 */
export async function runReviewEventsInsertSelfTest(branchId = DEFAULT_BRANCH) {
  logSupabaseConfig();

  try {
    if (sessionStorage.getItem(INSERT_TEST_KEY) === "1") {
      console.log("REVIEW INSERT SELF-TEST skipped (already ran this session)");
      return { data: null, error: null, skipped: true };
    }
    sessionStorage.setItem(INSERT_TEST_KEY, "1");
  } catch {
    /* continue */
  }

  const branch_id = (branchId || DEFAULT_BRANCH).toLowerCase();
  const payload = {
    branch_id,
    employee_name: "TEST",
    employee_role: "waiter",
    event_type: "qr_scan",
    review_session_id: `test-${Date.now()}`,
    business_day_key: getBusinessDayKey(),
    metadata: { self_test: true },
  };

  console.log("REVIEW INSERT SELF-TEST starting", payload);

  if (!supabase) {
    console.error("REVIEW EVENT ERROR", "Self-test failed — Supabase not configured");
    return { data: null, error: new Error("supabase not configured") };
  }

  const { error } = await supabase.from("review_events").insert(payload);

  console.log("REVIEW EVENT INSERT OK", !error);
  if (error) {
    console.error("REVIEW EVENT ERROR", error);
  } else {
    console.log("REVIEW INSERT SELF-TEST OK");
  }

  return { data: null, error };
}

export function trackReviewEvent(ctx = {}) {
  void insertReviewEvent(ctx);
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
  trackReviewEvent({ event_type: "copy_review", ...ctx });
}

export function trackReviewGoogleClick(ctx = {}) {
  trackReviewEvent({ event_type: "google_redirect", ...ctx });
}

export function trackReviewLanguageChange(language, ctx = {}) {
  trackReviewEvent({ event_type: "review_language_change", language, ...ctx });
}
