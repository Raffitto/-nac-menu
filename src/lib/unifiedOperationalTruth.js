/**
 * Single source of operational truth for all NAC OS intelligence surfaces.
 * All session/engagement/funnel/hourly metrics must derive from this module.
 */

import { hourInRiyadh } from "../dashboard/utils/hourlyBucketLabels";
import { formatHourLabel } from "../dashboard/utils/formatters";
import { rangeToHours } from "../dashboard/utils/rangeState";
import {
  fetchUnifiedOperationalAnalytics,
  resolveOperationalTrust,
  OPERATIONAL_TRUST,
} from "./analyticsUnifiedAdapter";
import {
  canonicalAddonInteractionCount,
  canonicalCategoryOpenCount,
} from "./menuEventTypes";
import {
  mergeCategoriesById,
  mergeTopItemsByName,
  normalizeAddonPairs,
} from "../platform/engines/menuAggregationEngine";

export { OPERATIONAL_TRUST, resolveOperationalTrust };

/** Executive-facing trust labels (compact, non-technical). */
export const TRUST_DISPLAY = {
  [OPERATIONAL_TRUST.LIVE_VERIFIED]: "LIVE VERIFIED",
  [OPERATIONAL_TRUST.PARTIAL_LIVE]: "PARTIAL LIVE DATA",
  [OPERATIONAL_TRUST.ROLLUP_RECOVERED]: "ROLLUP RECOVERED",
  [OPERATIONAL_TRUST.STALE_DETECTED]: "STALE SNAPSHOT",
};

/**
 * Canonical visibility score (Menu / Restaurant / Overview / AI / Operations).
 */
export function visibilityEngagementScore(item = {}) {
  const impressions = Number(item.impressions) || 0;
  const opens = Number(item.opens ?? item.modal_opens ?? item.item_opens) || 0;
  const dwellSec = Math.min((Number(item.avg_visible_duration_ms) || 0) / 1000, 120);
  const repeatOpens = opens > 1 ? opens - 1 : 0;
  return (
    impressions * 0.35 + opens * 1.0 + dwellSec * 0.5 + repeatOpens * 0.25
  );
}

function sortTopItems(items = []) {
  return [...items]
    .map((t) => ({
      ...t,
      visibility_score: visibilityEngagementScore(t),
    }))
    .sort((a, b) => b.visibility_score - a.visibility_score);
}

/** Peak hour from hourly buckets — Asia/Riyadh, matches chart labels. */
export function computePeakHourFromByHour(byHour = []) {
  if (!Array.isArray(byHour) || !byHour.length) {
    return { hour: null, label: null, count: 0 };
  }

  const peak = byHour.reduce((best, row) => {
    const c = Number(row.count) || 0;
    const bc = Number(best?.count) || 0;
    return c >= bc ? row : best;
  }, byHour[0]);

  const bucket = peak.hour ?? peak.bucket;
  const riyadhH = hourInRiyadh(bucket);
  const label =
    peak.label ||
    (riyadhH != null && Number.isFinite(riyadhH)
      ? formatHourLabel(riyadhH, peak.granularity || "hour")
      : null);

  return {
    hour: riyadhH != null ? riyadhH : bucket,
    label,
    count: Number(peak.count) || 0,
    bucket,
  };
}

/**
 * QR Scan = funnel entry (unique sessions). Session = unique session_id count.
 */
export function reconcileSessionCounts(payload = {}) {
  const sessions = Number(payload.total_sessions) || 0;
  const funnelIn = payload.funnel && typeof payload.funnel === "object" ? payload.funnel : {};
  const funnelEntry = Number(funnelIn.qr_scans) || 0;
  const qrScans = sessions > 0 ? Math.max(sessions, funnelEntry) : funnelEntry;

  return {
    sessions,
    qrScans,
    uniqueVisitors: Number(payload.today_unique_sessions) || sessions,
    funnel: {
      ...funnelIn,
      qr_scans: qrScans,
      total_sessions: sessions,
    },
  };
}

function sumCategoryOpens(categories = []) {
  return categories.reduce((s, c) => s + (Number(c.opens) || 0), 0);
}

/**
 * Align category rows with funnel / canonical event totals (fixes stale rollup slices).
 */
export function reconcileTopCategories(bi = {}) {
  const funnelOpens = Number(bi.funnel?.category_opens) || 0;
  const byCanon = canonicalCategoryOpenCount(bi.by_event_type || {});
  const targetOpens = Math.max(funnelOpens, byCanon);
  let cats = mergeCategoriesById(
    (bi.top_categories || []).map((c) => ({
      id: c.id || c.category_id || "",
      opens: Number(c.opens) || 0,
      impressions: Number(c.impressions) || 0,
    })),
  );
  const catSum = sumCategoryOpens(cats);

  if (targetOpens > 0 && catSum < targetOpens * 0.5) {
    if (cats.length === 0 || catSum < targetOpens * 0.2) {
      cats = [
        {
          id: "__nav_aggregate__",
          opens: targetOpens,
          impressions: Number(bi.by_event_type?.item_impression) || 0,
        },
      ];
    } else {
      const scale = targetOpens / Math.max(catSum, 1);
      cats = cats.map((c) => ({
        ...c,
        opens: Math.max(1, Math.round((Number(c.opens) || 0) * scale)),
      }));
    }
  }

  return cats.sort((a, b) => b.opens - a.opens);
}

/** Prefer live addon pairs; keep funnel-backed addon totals for empty states. */
export function reconcileTopAddonPairs(bi = {}) {
  const pairs = normalizeAddonPairs(bi.top_addon_pairs || []);
  if (pairs.length > 0) return pairs.sort((a, b) => b.clicks - a.clicks);
  return pairs;
}

/**
 * Full canonical engagement hydration — call after normalizeBiDashboardPayload.
 */
export function hydrateCanonicalBiPayload(bi = {}, options = {}) {
  const truth = buildOperationalTruth(bi, options);
  const top_categories = reconcileTopCategories({
    ...bi,
    funnel: truth.funnel,
  });
  const top_addon_pairs = reconcileTopAddonPairs(bi);
  const top_items = sortTopItems(
    mergeTopItemsByName(bi.top_items || []).map((t) => ({
      ...t,
      visibility_score: visibilityEngagementScore(t),
    })),
  );

  return {
    ...bi,
    total_sessions: truth.sessions,
    funnel: truth.funnel,
    strongest_hour: truth.peakHour ?? bi.strongest_hour,
    strongest_hour_label: truth.peakHourLabel ?? bi.strongest_hour_label,
    top_items,
    top_categories,
    top_addon_pairs,
    _truth: {
      ...truth,
      topItems: top_items,
      topCategories: top_categories,
      topAddonPairs: top_addon_pairs,
    },
  };
}

/** Widget-facing slice — Menu / Restaurant / AI must use this (no local reducers). */
export function getCanonicalMenuSurface(data) {
  if (!data) return null;
  const hydrated = data._truth ? data : hydrateCanonicalBiPayload(data);
  const truth = hydrated._truth || buildOperationalTruth(hydrated);
  return {
    sessions: truth.sessions,
    qrScans: truth.qrScans,
    funnel: truth.funnel,
    categoryOpens: truth.categoryOpens,
    itemOpens: truth.itemOpens,
    addonInteractions: truth.addonInteractions,
    topItems: truth.topItems || hydrated.top_items || [],
    topCategories: truth.topCategories || hydrated.top_categories || [],
    topAddonPairs: truth.topAddonPairs || hydrated.top_addon_pairs || [],
    peakHourLabel: truth.peakHourLabel,
    dataSource: truth.dataSource,
  };
}

/** Global integrity language for analytics surfaces. */
export function buildAnalyticsIntegrityMeta({
  data = null,
  truth = null,
  operationalTrust = null,
  foodics = null,
  surface = "analytics",
} = {}) {
  const t = truth || (data ? buildOperationalTruth(data) : null);
  const scopeLabels = [
    `${(t?.sessions || 0).toLocaleString()} menu sessions · canonical operational truth`,
  ];

  if (t?.categoryOpens > 0) {
    scopeLabels.push(`${t.categoryOpens.toLocaleString()} category opens in funnel`);
  }
  if (t?.addonInteractions > 0) {
    scopeLabels.push(`${t.addonInteractions.toLocaleString()} add-on interactions in period`);
  }

  if (foodics?.hasImports) {
    const rows = foodics.conversionRows || [];
    scopeLabels.push(
      `Foodics-linked subset: ${rows.length} items with POS import comparison (not a separate session count)`,
    );
  }

  if (operationalTrust?.partial) {
    scopeLabels.push("Partial live data — some tiles may use recovered rollup");
  }
  if (operationalTrust?.liveFallback) {
    scopeLabels.push("Live recompute active for recent range");
  }

  return {
    surface,
    sessions: t?.sessions || 0,
    events: t?.totalEvents || 0,
    dataSource: t?.dataSource || operationalTrust?.dataSource || "unified",
    trust: operationalTrust,
    scopeLabels,
    sampleComplete: (t?.sessions || 0) >= 10,
    freshness: operationalTrust?.lastSyncAt || t?.generatedAt,
  };
}

/**
 * Build canonical operational truth object from normalized BI payload.
 */
export function buildOperationalTruth(normalizedBi = {}, options = {}) {
  const bi = normalizedBi || {};
  const counts = reconcileSessionCounts(bi);
  const byType = bi.by_event_type || {};
  const peak = computePeakHourFromByHour(bi.by_hour || []);
  const funnel = counts.funnel;

  const totalEvents = Number(bi.total_events) || 0;
  const itemOpens =
    Number(funnel.item_opens) ||
    Number(byType.item_open) ||
    0;
  const categoryOpens = Number(funnel.category_opens) || 0;
  const addonInteractions =
    Number(funnel.addon_clicks) ||
    canonicalAddonInteractionCount(byType) ||
    0;

  const totalSessions = counts.sessions;
  const bounceSessions = Number(bi.bounce_sessions) || 0;
  const deepSessions = Number(bi.deep_sessions) || 0;

  return {
    sessions: totalSessions,
    qrScans: counts.qrScans,
    uniqueVisitors: counts.uniqueVisitors,
    totalEvents,
    itemOpens,
    categoryOpens,
    addonInteractions,
    funnel,
    hourly: bi.by_hour || [],
    peakHour: peak.hour,
    peakHourLabel: peak.label,
    peakHourCount: peak.count,
    avgTimeSpent: Number(bi.avg_time_spent) || 0,
    avgItemsPerSession: Number(bi.avg_items_per_session) || 0,
    bounceSessions,
    deepSessions,
    bouncePct:
      totalSessions > 0 ? Math.round((bounceSessions / totalSessions) * 100) : 0,
    deepPct:
      totalSessions > 0 ? Math.round((deepSessions / totalSessions) * 100) : 0,
    returningGuests: Number(bi.returning_sessions) || 0,
    sessionQuality: bi.session_quality || {},
    sessionOperational: bi.session_operational || {},
    sessionDiagnostics: bi.session_diagnostics || null,
    topItems: sortTopItems(mergeTopItemsByName(bi.top_items || [])),
    topCategories: reconcileTopCategories(bi),
    topAddonPairs: reconcileTopAddonPairs(bi),
    topSearches: bi.top_searches || [],
    byLanguage: bi.by_language || {},
    byEventType: byType,
    dataSource: bi.data_source || null,
    hours: options.hours ?? 24,
    generatedAt: new Date().toISOString(),
  };
}

/** Apply truth reconciliation onto BI payload (mutates derived view for UI). */
export function applyTruthToBiPayload(normalizedBi = {}, options = {}) {
  return hydrateCanonicalBiPayload(normalizedBi, options);
}

function formatTrustForDisplay(trust) {
  if (!trust) return null;
  return {
    ...trust,
    label: TRUST_DISPLAY[trust.badge] || trust.label,
    shortLabel: TRUST_DISPLAY[trust.badge] || "STATUS",
  };
}

/**
 * Canonical fetch — all dashboards must use this (not raw BI RPC paths).
 */
export async function fetchUnifiedOperationalTruth(supabase, filters = {}) {
  const hours = filters.timeRangeHours ?? rangeToHours(filters.selectedRange || "today");
  const raw = await fetchUnifiedOperationalAnalytics(supabase, filters);
  const data = applyTruthToBiPayload(raw.data, { hours });
  const truth = data._truth || buildOperationalTruth(data, { hours });

  return {
    ...raw,
    data,
    truth,
    operationalTrust: formatTrustForDisplay(raw.operationalTrust),
  };
}
