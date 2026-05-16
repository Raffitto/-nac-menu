/** Lightweight analytics data-quality checks for dashboard diagnostics */

const VALID_CATEGORIES = new Set([
  "breakfast", "brunch", "daytime", "evening", "desserts", "drinks",
]);

export function runDataQualityDiagnostics({
  menuEvents = [],
  reviewEvents = [],
  branchId = "khobar",
} = {}) {
  const issues = [];
  const menu = Array.isArray(menuEvents) ? menuEvents : [];
  const reviews = Array.isArray(reviewEvents) ? reviewEvents : [];

  const sessionMissing = menu.filter((e) => !e.session_id).length;
  if (sessionMissing > 0) {
    issues.push({
      severity: "medium",
      code: "missing_session_id",
      message: `${sessionMissing} menu events missing session_id`,
      count: sessionMissing,
    });
  }

  const dupKeys = new Map();
  menu.forEach((e) => {
    if (e.event_type !== "item_impression" && e.event_type !== "image_expand") return;
    const k = `${e.session_id}|${e.event_type}|${e.item_name_en}|${e.created_at?.slice?.(0, 16)}`;
    dupKeys.set(k, (dupKeys.get(k) || 0) + 1);
  });
  const dupCount = [...dupKeys.values()].filter((n) => n > 3).length;
  if (dupCount > 0) {
    issues.push({
      severity: "low",
      code: "duplicate_events",
      message: `${dupCount} potential duplicate impression/expand bursts`,
      count: dupCount,
    });
  }

  const invalidCat = menu.filter(
    (e) => e.category_id && !VALID_CATEGORIES.has(e.category_id)
  ).length;
  if (invalidCat > 0) {
    issues.push({
      severity: "low",
      code: "invalid_category",
      message: `${invalidCat} events with non-standard category_id`,
      count: invalidCat,
    });
  }

  const badUrl = reviews.filter(
    (e) => e.source_url && !/^https?:\/\//i.test(e.source_url)
  ).length;
  if (badUrl > 0) {
    issues.push({
      severity: "low",
      code: "malformed_url",
      message: `${badUrl} review events with malformed source_url`,
      count: badUrl,
    });
  }

  const noEmployee = reviews.filter(
    (e) =>
      ["review_page_open", "review_generate"].includes(e.event_type) &&
      !e.employee_name
  ).length;
  if (noEmployee > reviews.length * 0.5 && reviews.length > 5) {
    issues.push({
      severity: "medium",
      code: "missing_employee",
      message: "Majority of review events lack employee attribution",
      count: noEmployee,
    });
  }

  const hourBuckets = {};
  menu.forEach((e) => {
    const h = new Date(e.created_at).getHours();
    hourBuckets[h] = (hourBuckets[h] || 0) + 1;
  });
  const maxH = Math.max(...Object.values(hourBuckets), 0);
  const total = menu.length || 1;
  if (maxH / total > 0.6 && menu.length > 100) {
    issues.push({
      severity: "medium",
      code: "suspicious_spike",
      message: "Over 60% of menu events cluster in a single hour — verify tracking loop",
    });
  }

  if (menu.length > 5000) {
    issues.push({
      severity: "high",
      code: "event_flooding",
      message: `High event volume (${menu.length}) in filter window — check dedupe`,
      count: menu.length,
    });
  }

  return {
    branch_id: branchId,
    checked_at: new Date().toISOString(),
    menu_event_count: menu.length,
    review_event_count: reviews.length,
    issue_count: issues.length,
    healthy: issues.filter((i) => i.severity === "high").length === 0,
    issues,
  };
}
