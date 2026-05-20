/** Map get_review_events_summary RPC → Review Intelligence UI shapes */

const BRANCH_ORDER = ["khobar", "riyadh", "jeddah"];

export function kpisFromReviewSummary(summary) {
  if (!summary) return null;
  return {
    qr_scans: Number(summary.qr_scans) || 0,
    reviews_generated: Number(summary.reviews_generated) || 0,
    google_redirects: Number(summary.google_redirects) || 0,
    review_page_opens: Number(summary.review_page_opens) || 0,
    unique_review_visitors: Number(summary.unique_visitors) || 0,
    conversion_pct: Number(summary.conversion_pct) || 0,
    by_event_type: [],
  };
}

export function staffFromReviewSummary(summary) {
  const staff = Array.isArray(summary?.staff) ? summary.staff : [];
  return staff
    .filter((s) => s?.name)
    .map((s) => ({
      name: s.name,
      role: s.role || "",
      scans: Number(s.scans) || 0,
      generated: Number(s.generated) || 0,
      google: Number(s.google) || 0,
      opens: Number(s.scans) || 0,
      conversion_pct: Number(s.conversion_pct) || 0,
    }));
}

export function dailyTrendFromReviewSummary(summary) {
  const trend = Array.isArray(summary?.daily_trend) ? summary.daily_trend : [];
  return trend.map((d) => ({
    date: d.date,
    scans: Number(d.scans) || 0,
  }));
}

export function branchComparisonFromReviewSummary(summary) {
  const byBranch = Array.isArray(summary?.by_branch) ? summary.by_branch : [];
  const map = Object.fromEntries(
    byBranch.map((b) => [(b.branch_id || "").toLowerCase(), b]),
  );
  return BRANCH_ORDER.map((branch_id) => {
    const row = map[branch_id] || {};
    return {
      branch_id,
      qr_scans: Number(row.qr_scans) || 0,
      reviews_generated: Number(row.reviews_generated) || 0,
      google_redirects: Number(row.google_redirects) || 0,
      review_page_opens: Number(row.review_page_opens) || 0,
      unique_visitors: 0,
      conversion_pct: Number(row.conversion_pct) || 0,
    };
  });
}

export function branchScansFromComparison(rows) {
  return (rows || []).map((r) => ({
    branch: r.branch_id,
    scans: r.qr_scans,
  }));
}
