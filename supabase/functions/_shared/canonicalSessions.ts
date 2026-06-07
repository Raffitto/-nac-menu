/** Canonical menu sessions — keep in sync with src/lib/customerFacingAnalytics.js resolveCanonicalMenuSessions */

export function resolveCanonicalMenuSessions(payload: Record<string, unknown> = {}) {
  const funnel =
    payload.funnel && typeof payload.funnel === "object"
      ? (payload.funnel as Record<string, unknown>)
      : {};
  const sessionFunnel =
    payload._sessionFunnel && typeof payload._sessionFunnel === "object"
      ? (payload._sessionFunnel as Record<string, unknown>)
      : {};
  const byType =
    payload.by_event_type && typeof payload.by_event_type === "object"
      ? (payload.by_event_type as Record<string, unknown>)
      : {};

  let menuQrSessions = Math.max(
    0,
    Number(funnel.qr_scans) || 0,
    Number(payload.menu_qr_scans) || 0,
  );

  if (menuQrSessions === 0) {
    menuQrSessions = Math.max(
      0,
      Number(sessionFunnel.qr_scans) || 0,
      Number(byType.qr_session_start) || 0,
      Number(payload.today_qr_sessions) || 0,
    );
  }

  const allSessionIdsWithEvents = Math.max(0, Number(payload.total_sessions) || 0);

  if (menuQrSessions > 0 && allSessionIdsWithEvents > menuQrSessions) {
    return {
      menuSessions: menuQrSessions,
      menuQrScans: menuQrSessions,
      allSessionIdsWithEvents,
    };
  }

  if (menuQrSessions === 0 && allSessionIdsWithEvents > 0) {
    return {
      menuSessions: 0,
      menuQrScans: 0,
      allSessionIdsWithEvents,
      _missingQrSessionStart: true,
    };
  }

  const n = menuQrSessions || allSessionIdsWithEvents;
  return {
    menuSessions: n,
    menuQrScans: n,
    allSessionIdsWithEvents: allSessionIdsWithEvents > n ? allSessionIdsWithEvents : 0,
  };
}
