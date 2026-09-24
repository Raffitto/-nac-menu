/** Headline counts. Unavailable is null. A numeric zero is only a verified zero. */

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function executiveHeadline(data) {
  const menuState = data?._availability === "unavailable"
    ? "unavailable"
    : data?._availability === "stale"
      ? "stale"
      : "success";
  const reviewState = data?._reviewAvailability === "stale"
    ? "stale"
    : data?._reviewAvailability === "success"
      ? "success"
      : "unavailable";
  const menuOk = menuState !== "unavailable";
  const reviewOk = reviewState !== "unavailable";
  return {
    menuState,
    reviewState,
    staleAt: menuState === "stale" || reviewState === "stale"
      ? data?._staleAt || data?._loadedAt || null
      : null,
    menuQr: menuOk ? finite(data?.menu_qr_scans ?? data?.funnel?.qr_scans) : null,
    sessions: menuOk ? finite(data?.total_sessions ?? data?.funnel?.qr_scans) : null,
    reviewQr: reviewOk
      ? finite(
          data?.review_kpis?.review_qr_scans
          ?? data?.review_kpis?.qr_scans
          ?? data?.review_qr_scans,
        )
      : null,
    googleRedirects: reviewOk
      ? finite(data?.review_kpis?.google_redirects ?? data?.funnel?.review_redirect)
      : null,
  };
}

export function formatExecutiveCount(value) {
  if (value == null) return "—";
  return value.toLocaleString();
}
