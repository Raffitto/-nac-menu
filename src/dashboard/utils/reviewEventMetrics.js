/** KPIs and aggregates from review_events only — never menu_events. */

import { filterAnalyticsReviewEvents } from "./isProductionStaff";
import { normalizeReviewBranchId as normalizeBranchId } from "../../review/reviewBranchIdentity";
import { reviewVisitMetrics } from "./reviewVisitMetrics";
import {
  REVIEW_GENERATED_TYPES as GENERATED_TYPES,
  REVIEW_GOOGLE_TYPES as GOOGLE_TYPES,
  REVIEW_PAGE_OPEN_TYPES as PAGE_OPEN_TYPES,
} from "./reviewFunnelMetrics";

export function countByEventType(events = []) {
  const counts = {};
  filterAnalyticsReviewEvents(events).forEach((e) => {
    const t = e.event_type;
    if (!t) return;
    counts[t] = (counts[t] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([event_type, count]) => ({ event_type, count }))
    .sort((a, b) => b.count - a.count);
}

export function computeReviewKpis(events = []) {
  const rows = filterAnalyticsReviewEvents(events);
  const qr_scans = rows.filter((e) => e.event_type === "qr_scan").length;
  const reviews_generated = rows.filter((e) =>
    GENERATED_TYPES.has(e.event_type),
  ).length;
  const google_redirects = rows.filter((e) =>
    GOOGLE_TYPES.has(e.event_type),
  ).length;
  const review_page_opens = rows.filter((e) =>
    PAGE_OPEN_TYPES.has(e.event_type),
  ).length;

  const visitorIds = new Set();
  rows.forEach((e) => {
    const id = e.review_session_id || e.session_id;
    if (id) visitorIds.add(id);
  });

  const visits = reviewVisitMetrics(rows);

  return {
    qr_scans: visits.qr_visits,
    raw_qr_scans: qr_scans,
    reviews_generated,
    google_redirects: visits.converted_visits,
    raw_google_redirects: google_redirects,
    review_page_opens,
    unique_review_visitors: visitorIds.size,
    ...visits,
    by_event_type: countByEventType(rows),
  };
}

/** Branch-level qr_scan totals for comparison table. */
export function buildBranchReviewComparison(allEvents = []) {
  const byBranch = new Map();
  filterAnalyticsReviewEvents(allEvents).forEach(e => {
    const b = normalizeBranchId(e.branch_id);
    if (!b) return;
    if (!byBranch.has(b)) byBranch.set(b, []);
    byBranch.get(b).push(e);
  });
  return [...byBranch].map(([branch_id, rows]) => ({ branch_id, ...computeReviewKpis(rows) }));
}

export function runReviewDataQualityDiagnostics(reviewEvents = [], branchId = "khobar") {
  const reviews = Array.isArray(reviewEvents) ? reviewEvents : [];
  const issues = [];

  const badUrl = reviews.filter(
    (e) => e.source_url && !/^https?:\/\//i.test(e.source_url),
  ).length;
  if (badUrl > 0) {
    issues.push({
      severity: "low",
      code: "malformed_url",
      message: `${badUrl} review events with malformed source_url`,
      count: badUrl,
    });
  }

  const qrWithoutEmployee = reviews.filter(
    (e) => e.event_type === "qr_scan" && !(e.employee_name || "").trim(),
  ).length;
  if (qrWithoutEmployee > 0) {
    issues.push({
      severity: "medium",
      code: "qr_missing_employee",
      message: `${qrWithoutEmployee} qr_scan events missing employee_name`,
      count: qrWithoutEmployee,
    });
  }

  if (reviews.length === 0) {
    issues.push({
      severity: "low",
      code: "no_review_events",
      message: "No review_events in this period — staff QR may not be routing to ReviewPortal",
    });
  }

  return {
    branch_id: branchId,
    checked_at: new Date().toISOString(),
    review_event_count: reviews.length,
    issue_count: issues.length,
    healthy: issues.filter((i) => i.severity === "high").length === 0,
    issues,
  };
}
