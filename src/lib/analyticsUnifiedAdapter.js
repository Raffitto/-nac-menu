/**
 * Canonical operational analytics — Session Analytics is the engagement master;
 * BI dashboard supplements item/category depth. All intelligence modules should consume this path.
 */

import { rangeToHours } from "../dashboard/utils/rangeState";
import { normalizeHourlyForRange } from "../dashboard/utils/hourlyPipeline";
import {
  normalizeBiDashboardPayload,
  isBiTotalsEmpty,
} from "./biDashboardNormalize";
import { fetchBiDashboard } from "./intelligenceQueryApi";
import { fetchSessionAnalytics } from "./sessionAnalyticsApi";
import { appendOpsNote } from "./biOpsNotes";
import { enrichByEventTypeCanonical, canonicalAddonInteractionCount } from "./menuEventTypes";
import { biEngagementDetailNeedsRefresh } from "./biDashboardNormalize";
import { fetchBiItemDetailFromMenuEvents } from "./menuEventsBiFallback";

export const OPERATIONAL_TRUST = {
  LIVE_VERIFIED: "live_verified",
  PARTIAL_LIVE: "partial_live",
  ROLLUP_RECOVERED: "rollup_recovered",
  STALE_DETECTED: "stale_detected",
};

export const OPERATIONAL_TRUST_LABELS = {
  [OPERATIONAL_TRUST.LIVE_VERIFIED]: "Live verified",
  [OPERATIONAL_TRUST.PARTIAL_LIVE]: "Partial live data",
  [OPERATIONAL_TRUST.ROLLUP_RECOVERED]: "Rollup recovered",
  [OPERATIONAL_TRUST.STALE_DETECTED]: "Stale data detected",
};

function pickMaster(sessionVal, biVal) {
  const s = Number(sessionVal) || 0;
  const b = Number(biVal) || 0;
  if (s <= 0) return b;
  if (b <= 0) return s;
  return s >= b ? s : b;
}

/** Session chart rows → BI by_hour buckets (filled via shared hourly pipeline). */
export function hourlyBucketsFromSessionAggregates(aggregates, hours = 24) {
  const raw = (aggregates?.by_hour || []).map((row) => ({
    hour: row.hour ?? row.bucket,
    count: Number(row.count) || 0,
    granularity: row.granularity,
    label: row.label,
  }));
  if (!raw.length) return [];
  return normalizeHourlyForRange(raw, hours);
}

function sumCategoryOpens(cats = []) {
  return (cats || []).reduce((s, c) => s + (Number(c.opens) || 0), 0);
}

function sumAddonClicks(pairs = []) {
  return (pairs || []).reduce((s, p) => s + (Number(p.clicks) || 0), 0);
}

function topItemSignal(items = []) {
  return (items || []).reduce(
    (s, t) => s + (Number(t.opens) || 0) + (Number(t.impressions) || 0),
    0,
  );
}

function pickRicherTopCategories(biCats, aggCats, funnel = {}) {
  const target = Number(funnel.category_opens) || 0;
  const biSum = sumCategoryOpens(biCats);
  const aggSum = sumCategoryOpens(aggCats);
  if (target > 0) {
    if (aggSum >= biSum && aggSum >= target * 0.45 && (aggCats || []).length) {
      return aggCats;
    }
    if (biSum >= target * 0.45 && (biCats || []).length) return biCats;
    return (aggCats || []).length ? aggCats : biCats;
  }
  return (biCats || []).length ? biCats : aggCats || [];
}

function pickRicherAddonPairs(biPairs, aggPairs, funnel = {}, byType = {}) {
  const target = Math.max(
    Number(funnel.addon_clicks) || 0,
    canonicalAddonInteractionCount(byType),
  );
  const biSum = sumAddonClicks(biPairs);
  const aggSum = sumAddonClicks(aggPairs);
  if (target > 0) {
    if ((aggPairs || []).length && aggSum >= biSum) return aggPairs;
    if ((biPairs || []).length) return biPairs;
    return aggPairs || [];
  }
  return (biPairs || []).length ? biPairs : aggPairs || [];
}

function pickRicherTopItems(biItems, aggItems, funnel = {}) {
  const target = Math.max(
    Number(funnel.item_opens) || 0,
    Number(funnel.item_impressions) || 0,
  );
  const biSig = topItemSignal(biItems);
  const aggSig = topItemSignal(aggItems);
  if (target > 0) {
    if (aggSig >= biSig && (aggItems || []).length) return aggItems;
    if (biSig > 0 && (biItems || []).length) return biItems;
    return aggItems || biItems || [];
  }
  return (biItems || []).length >= (aggItems || []).length
    ? biItems
    : aggItems || biItems || [];
}

/**
 * Merge session-master engagement into BI payload before normalizeBiDashboardPayload.
 */
export function mergeSessionMasterWithBiRaw(biRaw = {}, aggregates = null, hours = 24) {
  if (!aggregates) return { ...biRaw };

  const funnel = aggregates.funnel || biRaw.funnel || {};
  const mergedByType = enrichByEventTypeCanonical({
    ...(biRaw.by_event_type || {}),
    ...(aggregates.by_event_type || {}),
  });

  const sessionHourly = hourlyBucketsFromSessionAggregates(aggregates, hours);
  const biHourly = Array.isArray(biRaw.by_hour) ? biRaw.by_hour : [];
  const sessionHourlySum = sessionHourly.reduce((s, r) => s + (Number(r.count) || 0), 0);
  const biHourlySum = biHourly.reduce((s, r) => s + (Number(r.count) || 0), 0);

  return {
    ...biRaw,
    total_events: pickMaster(aggregates.total_events, biRaw.total_events),
    total_sessions: pickMaster(aggregates.total_sessions, biRaw.total_sessions),
    by_event_type: mergedByType,
    by_hour: sessionHourlySum >= biHourlySum && sessionHourly.length ? sessionHourly : biHourly,
    by_hour_qr: Array.isArray(biRaw.by_hour_qr) ? biRaw.by_hour_qr : [],
    by_language:
      Object.keys(aggregates.by_language || {}).length > 0
        ? aggregates.by_language
        : biRaw.by_language,
    bounce_sessions: aggregates.bounce_sessions ?? biRaw.bounce_sessions,
    deep_sessions: aggregates.deep_sessions ?? biRaw.deep_sessions,
    avg_time_spent: aggregates.avg_time_spent ?? biRaw.avg_time_spent,
    avg_items_per_session: aggregates.avg_items_per_session ?? biRaw.avg_items_per_session,
    returning_sessions: aggregates.returning_sessions ?? biRaw.returning_sessions,
    session_quality: aggregates.session_quality || biRaw.session_quality,
    session_operational: aggregates.session_operational || biRaw.session_operational,
    funnel: aggregates.funnel || biRaw.funnel,
    session_diagnostics: aggregates.session_diagnostics || biRaw.session_diagnostics,
    today_qr_sessions:
      Number(aggregates.today_qr_sessions) ||
      Number(mergedByType.qr_session_start) ||
      Number(biRaw.today_qr_sessions) ||
      0,
    top_items: pickRicherTopItems(biRaw.top_items, aggregates?.top_items, funnel),
    top_categories: pickRicherTopCategories(
      biRaw.top_categories,
      aggregates?.top_categories,
      funnel,
    ),
    top_addon_pairs: pickRicherAddonPairs(
      biRaw.top_addon_pairs,
      aggregates?.top_addon_pairs,
      funnel,
      mergedByType,
    ),
    data_source: "unified_session_master",
    partial_mode: Boolean(biRaw.partial_mode || aggregates.partial),
    aggregation_note: biRaw.aggregation_note || null,
  };
}

/**
 * Executive trust badge from unified fetch metadata.
 */
export function resolveOperationalTrust({
  sessionPartial = false,
  biPartial = false,
  liveFallback = false,
  dataSource = null,
  note = null,
  menuDataEmpty = false,
  sessionEvents = 0,
  biEvents = 0,
} = {}) {
  const noteText = String(note || "");
  const stale =
    /stale|rollup|refresh_menu_events/i.test(noteText) && !liveFallback;
  const rollupRecovered =
    dataSource === "client_fallback" ||
    (dataSource === "unified_session_master" && /rollup|merged live/i.test(noteText));

  let badge = OPERATIONAL_TRUST.LIVE_VERIFIED;
  if (menuDataEmpty) {
    badge = OPERATIONAL_TRUST.STALE_DETECTED;
  } else if (stale) {
    badge = OPERATIONAL_TRUST.STALE_DETECTED;
  } else if (rollupRecovered) {
    badge = OPERATIONAL_TRUST.ROLLUP_RECOVERED;
  } else if (sessionPartial || biPartial || liveFallback) {
    badge = OPERATIONAL_TRUST.PARTIAL_LIVE;
  }

  const events = Math.max(sessionEvents, biEvents);
  const integrity =
    badge === OPERATIONAL_TRUST.LIVE_VERIFIED
      ? "healthy"
      : badge === OPERATIONAL_TRUST.ROLLUP_RECOVERED
        ? "recovered"
        : "watch";

  return {
    badge,
    label: OPERATIONAL_TRUST_LABELS[badge],
    lastSyncAt: new Date().toISOString(),
    eventCount: events,
    dataSource: dataSource || "unified",
    rollupIntegrity: integrity,
    liveFallback,
    partial: sessionPartial || biPartial,
  };
}

/**
 * Single fetch for Overview, Menu Intelligence, Restaurant Intelligence, and shared BI context.
 */
export async function fetchUnifiedOperationalAnalytics(supabase, filters = {}) {
  const hours = filters.timeRangeHours ?? rangeToHours(filters.selectedRange || "today");
  const branch = filters.branch ?? null;

  let sessionResult = null;
  let sessionError = null;
  try {
    sessionResult = await fetchSessionAnalytics(supabase, filters);
  } catch (e) {
    sessionError = e;
  }

  const biResult = await fetchBiDashboard(supabase, { branch, hours });
  const aggregates = sessionResult?.aggregates || null;

  const biPayloadRaw = biResult?.data
    ? {
        ...biResult.data,
        by_hour: biResult.data.by_hour,
        partial_mode: biResult.partial,
        aggregation_note: biResult.note,
      }
    : {};

  let mergedRaw = mergeSessionMasterWithBiRaw(
    biPayloadRaw,
    aggregates,
    hours,
  );

  let opsNotes = [...(biResult?.opsNotes || [])];

  if (supabase && biEngagementDetailNeedsRefresh(mergedRaw)) {
    try {
      const detail = await fetchBiItemDetailFromMenuEvents(supabase, { branch, hours });
      if (detail) {
        mergedRaw = {
          ...mergedRaw,
          top_items:
            (detail.top_items || []).length >= (mergedRaw.top_items || []).length
              ? detail.top_items
              : mergedRaw.top_items,
          top_categories:
            (detail.top_categories || []).length > 0
              ? detail.top_categories
              : mergedRaw.top_categories,
          top_addon_pairs:
            (detail.top_addon_pairs || []).length > 0
              ? detail.top_addon_pairs
              : mergedRaw.top_addon_pairs,
        };
        opsNotes = appendOpsNote(
          opsNotes,
          "Menu engagement charts aligned from live menu_events (rollup detail gap).",
        );
      }
    } catch {
      /* keep merged payload */
    }
  }

  if (sessionResult?.note && !mergedRaw.aggregation_note) {
    mergedRaw.aggregation_note = sessionResult.note;
  }
  mergedRaw.partial_mode = Boolean(
    mergedRaw.partial_mode || sessionResult?.partial || biResult?.partial,
  );

  const normalized = normalizeBiDashboardPayload(mergedRaw, { hours });

  opsNotes = [...opsNotes, ...(sessionResult?.opsNotes || [])];
  if (aggregates && !sessionError) {
    opsNotes = appendOpsNote(
      opsNotes,
      "Engagement totals aligned with Session Analytics master pipeline.",
    );
  }
  if (sessionError) {
    opsNotes = appendOpsNote(
      opsNotes,
      "Session master unavailable — showing BI dashboard totals only.",
    );
  }

  const operationalTrust = resolveOperationalTrust({
    sessionPartial: Boolean(sessionResult?.partial),
    biPartial: Boolean(biResult?.partial),
    liveFallback: Boolean(biResult?.liveFallback),
    dataSource: normalized.data_source || biResult?.dataSource,
    note: biResult?.note || sessionResult?.note,
    menuDataEmpty: Boolean(biResult?.menuDataEmpty) && isBiTotalsEmpty(normalized),
    sessionEvents: Number(aggregates?.total_events) || 0,
    biEvents: Number(biPayloadRaw?.total_events) || 0,
  });

  return {
    data: normalized,
    partial: Boolean(biResult?.partial || sessionResult?.partial),
    note: biResult?.note || sessionResult?.note || null,
    opsNotes,
    liveFallback: Boolean(biResult?.liveFallback),
    menuDataEmpty: Boolean(biResult?.menuDataEmpty && isBiTotalsEmpty(normalized)),
    dataSource: normalized.data_source || biResult?.dataSource || "unified",
    sufficiency: biResult?.sufficiency,
    operationalTrust,
    sessionMaster: Boolean(aggregates && !sessionError),
    normalizedSessions: aggregates,
    normalizedEvents: aggregates?.by_event_type || normalized.by_event_type,
    normalizedHourlyBuckets: normalized.by_hour,
    normalizedSessionQuality: normalized.session_quality,
    normalizedTopItems: normalized.top_items,
  };
}
