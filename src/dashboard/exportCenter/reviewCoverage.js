/**
 * Lightweight Google Review Tracking coverage for Reports readiness.
 * Staff rows stay on the download path.
 */

export function reviewDatesFromCoverageRpc(payload) {
  const raw = payload?.dates;
  const list = Array.isArray(raw) ? raw : [];
  return [...new Set(
    list
      .map((d) => String(d || "").slice(0, 10))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
  )].sort();
}

export async function fetchReviewTrackingCoverage(supabase, { branch, from, to }) {
  try {
    const { data, error } = await supabase.rpc("get_google_review_tracking_coverage", {
      p_branch_id: branch,
      p_start_date: from,
      p_end_date: to,
    });
    if (error) {
      return { reviewDates: [], error: error.message || String(error), rpc: null };
    }
    const reviewDates = reviewDatesFromCoverageRpc(data);
    return { reviewDates, error: null, rpc: data };
  } catch (err) {
    return { reviewDates: [], error: err?.message || String(err), rpc: null };
  }
}
