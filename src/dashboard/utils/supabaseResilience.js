/**
 * Graceful Supabase / RPC handling for dashboard and exports.
 */

export function isTimeoutError(error) {
  const msg = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("canceling statement") ||
    msg.includes("statement timeout") ||
    error?.code === "57014"
  );
}

export function isMissingRpcError(error) {
  const msg = `${error?.message || ""}`.toLowerCase();
  return msg.includes("function") && msg.includes("does not exist");
}

/**
 * Run async work; return fallback instead of throwing on timeout / network blips.
 */
export async function withSupabaseFallback(promise, fallback, options = {}) {
  const { onError } = options;
  try {
    const result = await promise;
    return result ?? fallback;
  } catch (err) {
    if (onError) onError(err);
    if (isTimeoutError(err) || isMissingRpcError(err)) return fallback;
    throw err;
  }
}

export const EMPTY_REVIEW_KPIS = {
  qr_scans: 0,
  reviews_generated: 0,
  google_redirects: 0,
  review_page_opens: 0,
  unique_review_visitors: 0,
  conversion_pct: 0,
  by_event_type: [],
};
