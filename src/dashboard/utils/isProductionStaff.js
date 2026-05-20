/**
 * Analytics-layer filters for review staff — does not modify DB rows.
 */

import { staffNameForTracking } from "../../review/reviewGeneratorShared";

const NON_PRODUCTION_STAFF = new Set([
  "test",
  "testing",
  "demo",
  "sample",
  "admin",
  "unknown",
]);

export function isProductionStaff(name = "") {
  const normalized = String(name || "").trim().toLowerCase();
  if (!normalized) return false;
  return !NON_PRODUCTION_STAFF.has(normalized);
}

export function reviewEventStaffName(event) {
  const raw = (event?.employee_name || "").trim();
  if (!raw) return null;
  return staffNameForTracking(raw) || raw;
}

/** Exclude dev/self-test review_events from production analytics. */
export function isProductionReviewEvent(event) {
  if (!event) return false;

  const source = String(event.event_source || event.source || "").trim().toLowerCase();
  if (source === "dev") return false;

  const meta =
    event.metadata && typeof event.metadata === "object" ? event.metadata : {};
  if (meta.self_test === true) return false;
  if (String(meta.env || meta.source || "").trim().toLowerCase() === "dev") return false;

  const sessionId = String(event.review_session_id || "");
  if (sessionId.startsWith("test-")) return false;

  return true;
}

/** Whether a review_events row counts toward KPIs, branches, and staff rollups. */
export function shouldCountReviewEvent(event) {
  if (!isProductionReviewEvent(event)) return false;
  const name = reviewEventStaffName(event);
  if (name && !isProductionStaff(name)) return false;
  return true;
}

export function filterAnalyticsReviewEvents(events = []) {
  return (events || []).filter(shouldCountReviewEvent);
}

/** Filter aggregated staff rows (name or employee_name). */
export function filterProductionStaffList(rows = []) {
  return (rows || []).filter((r) =>
    isProductionStaff(r?.name ?? r?.employee_name),
  );
}

/** @deprecated use filterAnalyticsReviewEvents */
export function filterProductionReviewEvents(events = []) {
  return filterAnalyticsReviewEvents(events);
}
