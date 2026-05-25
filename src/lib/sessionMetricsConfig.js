/**
 * Guest session duration guardrails — keeps executive metrics operationally believable.
 * Does not delete historical events; caps how duration is counted and reported.
 */

/** Max idle gap between events before session span stops extending (seconds). */
export const SESSION_IDLE_GAP_SEC = 15 * 60;

/** Max counted guest session duration (seconds) — 20 minutes on-menu. */
export const MAX_GUEST_SESSION_DURATION_SEC = 20 * 60;

/** Max single time_spent event metadata value accepted (seconds). */
export const MAX_TIME_SPENT_EVENT_SEC = 20 * 60;

/** Above this average (seconds), RPC/rollup averages are treated as untrusted. */
export const MAX_CREDIBLE_AVG_TIME_SPENT_SEC = 21 * 60;

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
