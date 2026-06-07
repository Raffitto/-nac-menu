/**
 * Customer-facing analytics guards — no synthetic/internal category IDs in UI.
 */

import { MONTH_HOURS } from "../dashboard/utils/rangeState";
import { sessionQualityTierSum } from "./sessionQualityAggregate";

export const SYNTHETIC_CATEGORY_IDS = new Set([
  "__nav_aggregate__",
  "__unknown__",
  "__aggregate__",
  "__internal__",
]);

/** True when a category row must not appear in guest-facing dashboards. */
export function isSyntheticCategoryId(id) {
  const raw = String(id || "")
    .trim()
    .toLowerCase();
  if (!raw) return true;
  if (SYNTHETIC_CATEGORY_IDS.has(raw)) return true;
  return raw.startsWith("__") && raw.endsWith("__");
}

/** Filter and sort category rows for Top Categories / insights / exports. */
export function filterCustomerFacingCategories(categories = []) {
  return (categories || [])
    .filter((c) => !isSyntheticCategoryId(c.id ?? c.category_id))
    .map((c) => ({
      ...c,
      id: c.id ?? c.category_id,
      opens: Number(c.opens) || 0,
      impressions: Number(c.impressions) || 0,
    }))
    .filter((c) => c.opens > 0 || c.impressions > 0)
    .sort((a, b) => b.opens - a.opens || b.impressions - a.impressions);
}

/**
 * Canonical menu session model — one count for Executive Sessions + Menu QR Scans.
 * Uses distinct sessions with qr_session_start (menu QR entry), not all session_ids with any event.
 */
export function resolveCanonicalMenuSessions(payload = {}) {
  const funnel = payload.funnel && typeof payload.funnel === "object" ? payload.funnel : {};
  const sessionFunnel =
    payload._sessionFunnel && typeof payload._sessionFunnel === "object"
      ? payload._sessionFunnel
      : {};
  const byType = payload.by_event_type && typeof payload.by_event_type === "object"
    ? payload.by_event_type
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

  // Legacy SQL / rollup sums count every session_id that emitted any event — often >> QR entry.
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
    allSessionIdsWithEvents:
      allSessionIdsWithEvents > n ? allSessionIdsWithEvents : 0,
  };
}

/** Apply canonical session counts onto a BI payload (mutates derived fields only). */
export function applyCanonicalMenuSessionsToPayload(payload = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const canon = resolveCanonicalMenuSessions(payload);
  const funnel = enforceMenuFunnelIntegrity({
    ...(payload.funnel || {}),
    qr_scans: canon.menuQrScans,
    total_sessions: canon.menuSessions,
  });

  return {
    ...payload,
    total_sessions: canon.menuSessions,
    menu_qr_scans: canon.menuQrScans,
    funnel,
    _canonicalSessions: canon,
  };
}

/**
 * Enforce distinct-session funnel ordering: item_opens ≤ category_opens ≤ qr_scans.
 */
export function enforceMenuFunnelIntegrity(funnel = {}) {
  const base = funnel && typeof funnel === "object" ? { ...funnel } : {};
  let qr = Math.max(0, Number(base.qr_scans) || 0);
  let category = Math.max(0, Number(base.category_opens) || 0);
  let item = Math.max(0, Number(base.item_opens) || 0);
  let addon = Math.max(0, Number(base.addon_clicks) || 0);

  if (qr > 0) {
    category = Math.min(category, qr);
    item = Math.min(item, category);
    addon = Math.min(addon, qr);
  } else if (category > 0) {
    item = Math.min(item, category);
  }

  return {
    ...base,
    qr_scans: qr,
    category_opens: category,
    item_opens: item,
    addon_clicks: addon,
  };
}

/**
 * Rollup funnels often use event_count sums — detect and prefer session-scoped funnel when inflated.
 */
export function reconcileRollupFunnelWithSessions(funnel = {}, totalSessions = 0, options = {}) {
  const canon = resolveCanonicalMenuSessions({
    funnel,
    total_sessions: totalSessions,
    _sessionFunnel: options.sessionFunnel,
  });
  const sessions = canon.menuSessions;
  let normalized = enforceMenuFunnelIntegrity({
    ...funnel,
    qr_scans: canon.menuQrScans,
  });
  const qr = Number(normalized.qr_scans) || 0;

  if (sessions > 0 && qr > sessions * 1.05) {
    const sessionFunnel = options.sessionFunnel || {};
    const sessionQr = Number(sessionFunnel.qr_scans) || 0;
    if (sessionQr > 0 && sessionQr <= sessions) {
      normalized = enforceMenuFunnelIntegrity({ ...normalized, ...sessionFunnel });
    } else {
      normalized = enforceMenuFunnelIntegrity({
        ...normalized,
        qr_scans: sessions,
        category_opens: Math.min(Number(normalized.category_opens) || 0, sessions),
        item_opens: Math.min(Number(normalized.item_opens) || 0, sessions),
      });
    }
  }

  return normalized;
}

/** Session-quality chart denominator and partial-classification flag. */
export function resolveSessionQualityDenominator(sessionQuality = {}, totalSessions = 0) {
  const tierSum = sessionQualityTierSum(sessionQuality);
  const sessions = Math.max(0, Number(totalSessions) || 0);

  if (tierSum <= 0) {
    return { denominator: sessions, classifiedCount: 0, isPartial: false };
  }

  const isPartial = sessions > 0 && tierSum < sessions * 0.95;
  const denominator = isPartial ? tierSum : sessions > 0 ? sessions : tierSum;

  return {
    denominator: Math.max(denominator, tierSum),
    classifiedCount: tierSum,
    isPartial,
  };
}

export const SCAN_CHART_EMPTY_MESSAGE =
  "Hourly scan breakdown isn't available for this period yet.";

export function isMonthRangeHours(hours) {
  const h = Number(hours);
  return h === MONTH_HOURS || h === 720;
}
