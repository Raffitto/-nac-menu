/** Map get_review_events_summary RPC → Review Intelligence UI shapes */

import { normalizeBranchId, buildCanonicalBranchComparison } from "./branchIdentity";

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
    .map((s) => {
      const branch = normalizeBranchId(s.branch_id ?? s.branch);
      return {
        name: s.name,
        role: s.role || "",
        branch,
        scans: Number(s.scans) || 0,
        generated: Number(s.generated) || 0,
        google: Number(s.google) || 0,
        opens: Number(s.scans) || 0,
        review_opens: Number(s.review_opens) || 0,
        copy: Number(s.copy) || 0,
        conversion_pct: Number(s.conversion_pct) || 0,
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
  const byBranch = Array.isArray(summary?.by_branch) ? summary.by_branch : [];
  return buildCanonicalBranchComparison(
    byBranch.map((b) => ({
      branch_id: normalizeBranchId(b.branch_id) || b.branch_id,
      qr_scans: Number(b.qr_scans) || 0,
      reviews_generated: Number(b.reviews_generated) || 0,
      google_redirects: Number(b.google_redirects) || 0,
      review_page_opens: Number(b.review_page_opens) || 0,
      conversion_pct: Number(b.conversion_pct) || 0,
    })),
    {
      qr_scans: 0,
      reviews_generated: 0,
      google_redirects: 0,
      review_page_opens: 0,
      unique_visitors: 0,
      conversion_pct: 0,
    },
  ).map((row) => ({
    ...row,
    conversion_pct:
      row.qr_scans > 0
        ? Math.round((row.google_redirects / row.qr_scans) * 100)
        : Number(row.conversion_pct) || 0,
  }));
}

export function branchScansFromComparison(rows) {
  return buildCanonicalBranchComparison(rows || [], { qr_scans: 0 }).map((r) => ({
    branch_id: r.branch_id,
    scans: Number(r.qr_scans) || 0,
  }));
}
