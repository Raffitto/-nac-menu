/** Headline counts. Unavailable is null. A numeric zero is only a verified zero. */

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function executiveHeadline(data) {
  const menuOk = data?._availability !== "unavailable";
  const reviewOk = data?._reviewAvailability === "success";
  return {
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
