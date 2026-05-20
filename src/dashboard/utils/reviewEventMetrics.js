/** KPIs and aggregates from review_events only — never menu_events. */

import { filterAnalyticsReviewEvents } from "./isProductionStaff";

const GENERATED_TYPES = new Set(["review_generate", "review_regenerate"]);
const GOOGLE_TYPES = new Set(["google_redirect", "review_google_click"]);
const PAGE_OPEN_TYPES = new Set(["review_page_open", "review_open"]);

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

  const conversion_pct =
    qr_scans > 0 ? Math.round((google_redirects / qr_scans) * 100) : 0;

  return {
    qr_scans,
    reviews_generated,
    google_redirects,
    review_page_opens,
    unique_review_visitors: visitorIds.size,
    conversion_pct,
    by_event_type: countByEventType(rows),
  };
}

/** Branch-level qr_scan totals for comparison table. */
export function buildBranchReviewComparison(allEvents = []) {
  const branches = ["khobar", "riyadh", "jeddah"];
  const byBranch = {};

  branches.forEach((b) => {
    byBranch[b] = {
      branch_id: b,
      qr_scans: 0,
      reviews_generated: 0,
      google_redirects: 0,
      review_page_opens: 0,
      unique_visitors: new Set(),
    };
  });

  filterAnalyticsReviewEvents(allEvents).forEach((e) => {
    const b = (e.branch_id || "").toLowerCase();
    if (!byBranch[b]) return;
    const row = byBranch[b];

    if (e.event_type === "qr_scan") row.qr_scans += 1;
    if (GENERATED_TYPES.has(e.event_type)) row.reviews_generated += 1;
    if (GOOGLE_TYPES.has(e.event_type)) row.google_redirects += 1;
    if (PAGE_OPEN_TYPES.has(e.event_type)) row.review_page_opens += 1;

    const sid = e.review_session_id || e.session_id;
    if (sid) row.unique_visitors.add(sid);
  });

  return branches.map((b) => {
    const row = byBranch[b];
    const qr = row.qr_scans;
    const google = row.google_redirects;
    return {
      branch_id: b,
      qr_scans: qr,
      reviews_generated: row.reviews_generated,
      google_redirects: google,
      review_page_opens: row.review_page_opens,
      unique_visitors: row.unique_visitors.size,
      conversion_pct: qr > 0 ? Math.round((google / qr) * 100) : 0,
    };
  });
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
