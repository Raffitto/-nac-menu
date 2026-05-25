/**
 * Guest session duration guardrails — keeps executive metrics operationally believable.
 * Does not delete historical events; caps how duration is counted and reported.
 */

/** Inactivity gap (seconds) — passive/impression bursts do not extend span beyond this. */
export const SESSION_IDLE_GAP_SEC = 90;

/** Max counted guest session duration (seconds) — 20 minutes on-menu. */
export const MAX_GUEST_SESSION_DURATION_SEC = 20 * 60;

/** Max single time_spent event metadata value accepted (seconds). */
export const MAX_TIME_SPENT_EVENT_SEC = 20 * 60;

/** Above this average (seconds), RPC/rollup averages are treated as untrusted. */
export const MAX_CREDIBLE_AVG_TIME_SPENT_SEC = 21 * 60;

/** Passive visibility — must not inflate duration or engagement tiers. */
export const PASSIVE_SESSION_EVENT_TYPES = new Set([
  "item_impression",
  "item_impression_end",
  "scroll_depth",
]);

/** Events that advance the active session timeline (for span + idle close). */
export const ACTIVE_SESSION_EVENT_TYPES = new Set([
  "qr_session_start",
  "category_open",
  "menu_tab_open",
  "section_open",
  "item_open",
  "add_on_click",
  "recommended_addon_click",
  "upsell_click",
  "modifier_click",
  "search_used",
  "search_submit",
  "time_spent",
  "menu_exit",
  "language_change",
]);

export function normalizeSessionDurationSeconds(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.round(n), MAX_GUEST_SESSION_DURATION_SEC);
}

export function normalizeAvgTimeSpent(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > MAX_CREDIBLE_AVG_TIME_SPENT_SEC) return 0;
  return Math.round(n);
}

/** Heuristic: dashboard / internal surfaces should not drive guest session duration. */
export function isInternalMenuSessionRow(row) {
  const meta = row?.metadata;
  if (!meta || typeof meta !== "object") return false;
  const path = String(meta.page_path || meta.path || "").toLowerCase();
  if (!path) return false;
  return (
    path.includes("admin") ||
    path.includes("dashboard") ||
    path.includes("intelligence") ||
    path.includes("reset-password")
  );
}
