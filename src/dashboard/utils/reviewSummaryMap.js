/** Map get_review_events_summary RPC → Review Intelligence UI shapes */

import { normalizeReviewBranchId as normalizeBranchId } from "../../review/reviewBranchIdentity";
import { visitsFromSummary } from "./reviewVisitMetrics";
import { filterProductionStaffList } from "./isProductionStaff";

export function kpisFromReviewSummary(summary) {
  if (!summary) return null;
  return {
    qr_scans: summary.qr_visits ?? null,
    reviews_generated: Number(summary.reviews_generated) || 0,
    google_redirects: summary.converted_visits ?? null,
    review_page_opens: Number(summary.review_page_opens) || 0,
    unique_review_visitors: Number(summary.unique_visitors) || 0,
    ...visitsFromSummary(summary),
    by_event_type: [],
  };
}

export function staffFromReviewSummary(summary) {
  const staff = Array.isArray(summary?.staff) ? summary.staff : [];
  return filterProductionStaffList(staff)
    .map((s) => {
      const branch = normalizeBranchId(s.branch_id ?? s.branch);
      return {
        name: s.name,
        role: s.role || "",
        branch,
        scans: s.qr_visits ?? null,
        generated: Number(s.generated) || 0,
        google: s.converted_visits ?? null,
        opens: s.qr_visits ?? null,
        review_opens: Number(s.review_opens) || 0,
        copy: Number(s.copy) || 0,
        ...visitsFromSummary(s),
      };
    });
}

export function dailyTrendFromReviewSummary(summary) {
  const trend = Array.isArray(summary?.daily_trend) ? summary.daily_trend : [];
  return trend.map((d) => ({
    date: d.date,
    scans: Number(d.scans) || 0,
  }));
}

export function branchComparisonFromReviewSummary(summary) {
  return (summary?.by_branch || []).map(b => ({ ...b,
    branch_id: normalizeBranchId(b.branch_id) || b.branch_id,
    qr_scans: b.qr_visits ?? null, google_redirects: b.converted_visits ?? null,
    ...visitsFromSummary(b),
  }));
}

export function branchScansFromComparison(rows) {
  return (rows || []).map((r) => ({
    branch_id: r.branch_id,
    scans: Number(r.qr_scans) || 0,
  }));
}
