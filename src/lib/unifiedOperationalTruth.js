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
import { canonicalAddonInteractionCount } from "./menuEventTypes";
import {
  getMetricLabel,
  getMetricWarning,
  METRIC_IDS,
} from "../intelligence/metrics/metricDefinitions";
import {
  mergeCategoriesById,
  mergeTopItemsByName,
  normalizeAddonPairs,
} from "../platform/engines/menuAggregationEngine";
import { filterRankedTopItems } from "./operationalMetricsIntegrity";
import {
  filterCustomerFacingCategories,
  resolveCanonicalMenuSessions,
  reconcileRollupFunnelWithSessions,
} from "./customerFacingAnalytics";

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
 * Sessions and Menu QR Scans share one canonical count: distinct sessions with qr_session_start.
 */
export function reconcileSessionCounts(payload = {}) {
  const canon = resolveCanonicalMenuSessions(payload);
  const funnelIn = payload.funnel && typeof payload.funnel === "object" ? payload.funnel : {};

  const funnel = reconcileRollupFunnelWithSessions(
    { ...funnelIn, qr_scans: canon.menuQrScans },
    canon.menuSessions,
    { sessionFunnel: payload._sessionFunnel },
  );

  return {
    sessions: canon.menuSessions,
    qrScans: canon.menuQrScans,
    allSessionIdsWithEvents: canon.allSessionIdsWithEvents,
    uniqueVisitors:
      Number(payload.today_unique_sessions) || canon.menuSessions,
    funnel: {
      ...funnel,
      qr_scans: canon.menuQrScans,
      total_sessions: canon.menuSessions,
    },
  };
}

/** Customer-facing category rows only — no synthetic aggregate placeholders. */
export function reconcileTopCategories(bi = {}) {
  const cats = mergeCategoriesById(
    (bi.top_categories || []).map((c) => ({
      id: c.id || c.category_id || "",
      opens: Number(c.opens) || 0,
      impressions: Number(c.impressions) || 0,
    })),
  );
  return filterCustomerFacingCategories(cats);
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
  const top_items = filterRankedTopItems(
    mergeTopItemsByName(bi.top_items || []).map((t) => ({
      ...t,
      visibility_score: visibilityEngagementScore(t),
    })),
    { limit: 10 },
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
  const sessionLabel = getMetricLabel(METRIC_IDS.SESSION);
  const scopeLabels = [
    `${(t?.sessions || 0).toLocaleString()} ${sessionLabel.toLowerCase()} · canonical operational truth`,
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
    const partialCopy = getMetricWarning(METRIC_IDS.PARTIAL_LIVE, {
      partial: true,
      operationalTrust,
    });
    scopeLabels.push(partialCopy || "Partial live data — some tiles may use recovered rollup");
  }
  if (operationalTrust?.liveFallback) {
    scopeLabels.push(
      "Live recompute active for recent range — totals may differ from rollup until refresh",
    );
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

  const scanChart = bi.scan_chart;
  const peakFromChart =
    scanChart?.usesQrEventsOnly && Array.isArray(scanChart.rows) && scanChart.rows.length
      ? computePeakHourFromByHour(scanChart.rows)
      : null;
  const peak = peakFromChart?.count > 0 ? peakFromChart : computePeakHourFromByHour(bi.by_hour || []);

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

const inflightUnifiedTruth = new Map();

function unifiedTruthCacheKey(filters = {}) {
  const hours = filters.timeRangeHours ?? rangeToHours(filters.selectedRange || "today");
  return [
    filters.branch ?? "all",
    hours,
    filters.selectedRange || "today",
    filters.language || "all",
    filters.shift || "all",
    filters.eventType || "all",
    filters.dayType || "all",
    filters.role || "all",
  ].join("|");
}

/**
 * Canonical fetch — all dashboards must use this (not raw BI RPC paths).
 * Dedupes concurrent identical loads (RBAC profile settle used to double-fire Overview).
 */
export async function fetchUnifiedOperationalTruth(supabase, filters = {}, options = {}) {
  const hours = filters.timeRangeHours ?? rangeToHours(filters.selectedRange || "today");
  const key = unifiedTruthCacheKey({ ...filters, timeRangeHours: hours });
  const existing = inflightUnifiedTruth.get(key);
  if (existing) {
    if (typeof options.onTier1Partial === "function") {
      existing.partialListeners.add(options.onTier1Partial);
    }
    return existing.promise;
  }

  const partialListeners = new Set();
  if (typeof options.onTier1Partial === "function") {
    partialListeners.add(options.onTier1Partial);
  }

  const multicastPartial = (partial) => {
    partialListeners.forEach((fn) => {
      try {
        fn(partial);
      } catch {
        /* ignore listener errors */
      }
    });
  };

  const promise = (async () => {
    const raw = await fetchUnifiedOperationalAnalytics(supabase, filters, {
      ...options,
      onTier1Partial: multicastPartial,
    });
    const data = applyTruthToBiPayload(raw.data, { hours });
    const truth = data._truth || buildOperationalTruth(data, { hours });

    return {
      ...raw,
      data,
      truth,
      operationalTrust: formatTrustForDisplay(raw.operationalTrust),
    };
  })();

  inflightUnifiedTruth.set(key, { promise, partialListeners });
  try {
    return await promise;
  } finally {
    inflightUnifiedTruth.delete(key);
  }
}
