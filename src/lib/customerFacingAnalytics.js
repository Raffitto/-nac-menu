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

const CATEGORY_NAV_TYPES = new Set(["category_open", "menu_tab_open", "section_open"]);

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
  const sessions = Math.max(0, Number(totalSessions) || 0);
  let normalized = enforceMenuFunnelIntegrity(funnel);
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
