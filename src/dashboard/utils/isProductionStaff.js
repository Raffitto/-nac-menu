/**
 * Analytics-layer filters for review staff — does not modify DB rows.
 */

import { staffNameForTracking } from "../../review/reviewGeneratorShared";

export function isProductionStaff(name = "") {
  return Boolean(String(name || "").trim());
}

export function reviewEventStaffName(event) {
  const raw = (event?.employee_name || "").trim();
  if (!raw) return null;
  return staffNameForTracking(raw) || raw;
}

/** Only the explicit self_test marker excludes a historical event from reporting. */
export function isProductionReviewEvent(event) {
  if (!event) return false;
  const meta =
    event.metadata && typeof event.metadata === "object" ? event.metadata : {};
  return meta.self_test !== true && meta.self_test !== "true";
}

/** Whether a review_events row counts toward KPIs, branches, and staff rollups. */
export function shouldCountReviewEvent(event) {
  return isProductionReviewEvent(event);
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
