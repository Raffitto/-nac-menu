/**
 * Canonical get_bi_dashboard payload shape for Menu Intelligence + Visual OS (all ranges).
 */

import { parseHourBucket } from "../dashboard/utils/hourlyBucketLabels";
import { sessionQualityIsEmpty } from "./sessionQualityAggregate";

export function isBiTotalsEmpty(payload) {
  if (!payload || typeof payload !== "object") return true;
  const events = Number(payload.total_events) || 0;
  const sessions = Number(payload.total_sessions) || 0;
  const byType = payload.by_event_type || {};
  const typeSum = Object.values(byType).reduce((s, v) => s + (Number(v) || 0), 0);
  return events === 0 && sessions === 0 && typeSum === 0;
}

const EMPTY_FUNNEL = {
  qr_scans: 0,
  category_opens: 0,
  item_impressions: 0,
  item_opens: 0,
  addon_clicks: 0,
  time_spent: 0,
  exits: 0,
};

function mergeTopItemsByName(items) {
  const map = new Map();
  for (const t of items) {
    const name = (t.name || t.item_name_en || t.item_name || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const prev = map.get(key) || {
      name,
      impressions: 0,
      opens: 0,
      impression_sessions: 0,
      visible_duration_ms: 0,
      avg_visible_duration_ms: 0,
    };
    prev.impressions += Number(t.impressions) || 0;
    prev.opens += Number(t.opens ?? t.modal_opens ?? t.item_opens) || 0;
    prev.impression_sessions += Number(t.impression_sessions) || 0;
    prev.visible_duration_ms += Number(t.visible_duration_ms) || 0;
    map.set(key, prev);
  }
  return [...map.values()]
    .map((t) => ({
      ...t,
      deep_interest_rate:
        t.impressions > 0 ? Math.round((t.opens / t.impressions) * 1000) / 10 : null,
      avg_visible_duration_ms:
        t.impression_sessions > 0
          ? Math.round(t.visible_duration_ms / t.impression_sessions)
          : 0,
    }))
    .sort((a, b) => Math.max(b.impressions, b.opens) - Math.max(a.impressions, a.opens));
}

function mergeCategoriesById(items) {
  const map = new Map();
  for (const c of items) {
    const id = (c.id || c.category_id || "").trim();
    if (!id) continue;
    const key = id.toLowerCase();
    const prev = map.get(key) || { id, opens: 0, impressions: 0 };
    prev.opens += Number(c.opens) || 0;
    prev.impressions += Number(c.impressions) || 0;
    map.set(key, prev);
  }
  return [...map.values()].sort((a, b) => b.opens - a.opens || b.impressions - a.impressions);
}

/** Rollup / partial RPC missing session-quality tiers despite sessions. */
export function biSessionQualityNeedsRefresh(payload) {
  return sessionQualityIsEmpty(payload);
}

/** Rollup totals present but item rows missing, flat, or all-zero. */
export function biTopItemsNeedsRefresh(payload) {
  if (!payload || isBiTotalsEmpty(payload)) return false;
  const items = payload.top_items;
  if (!Array.isArray(items) || items.length === 0) {
    const by = payload.by_event_type || {};
    return (
      Number(by.item_open) > 0 ||
      Number(by.item_impression) > 0 ||
      Number(by.category_open) > 0
    );
  }
  const opens = items.map((t) => Number(t.opens ?? t.modal_opens) || 0);
  const impressions = items.map((t) => Number(t.impressions) || 0);
  if (opens.every((o) => o === 0) && impressions.every((i) => i === 0)) return true;
  if (items.length >= 3 && new Set(opens).size === 1 && opens[0] > 0) return true;
  return false;
}

/** Normalize RPC, server fallback, or client aggregation into one stable shape. */
export function normalizeBiDashboardPayload(raw) {
  if (!raw || typeof raw !== "object") {
    return { ...emptyBiShell() };
  }

  const byEvent = raw.by_event_type && typeof raw.by_event_type === "object" ? raw.by_event_type : {};
  const funnelIn = raw.funnel && typeof raw.funnel === "object" ? raw.funnel : {};

  const top_items = mergeTopItemsByName(
    Array.isArray(raw.top_items)
      ? raw.top_items.map((t) => ({
          name: t.name || t.item_name_en || t.item_name || "",
          impressions: Number(t.impressions) || 0,
          opens: Number(t.opens ?? t.modal_opens ?? t.item_opens) || 0,
          impression_sessions: Number(t.impression_sessions) || 0,
          visible_duration_ms: Number(t.visible_duration_ms) || 0,
          deep_interest_rate: t.deep_interest_rate != null ? Number(t.deep_interest_rate) : null,
          avg_visible_duration_ms: Number(t.avg_visible_duration_ms) || 0,
        }))
      : [],
  );

  const top_categories = mergeCategoriesById(
    Array.isArray(raw.top_categories)
      ? raw.top_categories.map((c) => ({
          id: c.id || c.category_id || "",
          opens: Number(c.opens) || 0,
          impressions: Number(c.impressions) || 0,
        }))
      : [],
  );

  const top_addon_pairs = Array.isArray(raw.top_addon_pairs)
    ? raw.top_addon_pairs.map((p) => ({
        item: p.item || p.item_name || "",
        addon: p.addon || p.add_on_name || "",
        clicks: Number(p.clicks) || 0,
      }))
    : [];

  const by_hour = Array.isArray(raw.by_hour)
    ? raw.by_hour.map((row) => {
        const bucket = row.hour ?? row.business_day_key ?? row.day_key;
        const gran = row.granularity || parseHourBucket(bucket).granularity || "hour";
        return {
          hour: bucket,
          count: Number(row.count) || 0,
          granularity: gran,
          business_day_key: row.business_day_key || (gran === "day" ? bucket : null),
        };
      })
    : [];

  return {
    total_events: Number(raw.total_events) || 0,
    total_sessions: Number(raw.total_sessions) || 0,
    by_language: raw.by_language && typeof raw.by_language === "object" ? raw.by_language : {},
    by_event_type: byEvent,
    top_items,
    top_categories,
    top_addon_pairs,
    top_searches: Array.isArray(raw.top_searches) ? raw.top_searches : [],
    by_hour,
    dead_zones: Array.isArray(raw.dead_zones) ? raw.dead_zones : [],
    lost_searches: Array.isArray(raw.lost_searches) ? raw.lost_searches : [],
    session_quality:
      raw.session_quality && typeof raw.session_quality === "object" ? raw.session_quality : {},
    lang_behavior: raw.lang_behavior && typeof raw.lang_behavior === "object" ? raw.lang_behavior : {},
    bounce_sessions: Number(raw.bounce_sessions) || 0,
    deep_sessions: Number(raw.deep_sessions) || 0,
    avg_time_spent: Number(raw.avg_time_spent) || 0,
    avg_items_per_session: Number(raw.avg_items_per_session) || 0,
    returning_sessions: Number(raw.returning_sessions) || 0,
    today_unique_sessions: Number(raw.today_unique_sessions) || 0,
    today_qr_sessions: Number(raw.today_qr_sessions) || 0,
    funnel: {
      ...EMPTY_FUNNEL,
      qr_scans: Number(funnelIn.qr_scans ?? byEvent.qr_session_start) || 0,
      category_opens: Number(funnelIn.category_opens ?? byEvent.category_open) || 0,
      item_impressions: Number(funnelIn.item_impressions ?? byEvent.item_impression) || 0,
      item_opens: Number(funnelIn.item_opens ?? byEvent.item_open) || 0,
      addon_clicks: Number(funnelIn.addon_clicks ?? byEvent.add_on_click) || 0,
      time_spent: Number(funnelIn.time_spent ?? byEvent.time_spent) || 0,
      exits: Number(funnelIn.exits ?? byEvent.menu_exit) || 0,
    },
    strongest_hour: raw.strongest_hour ?? null,
    top_converting_category:
      raw.top_converting_category && typeof raw.top_converting_category === "object"
        ? raw.top_converting_category
        : {},
    placement_stats: Array.isArray(raw.placement_stats) ? raw.placement_stats : [],
    modal_engagement_events:
      Number(raw.modal_engagement_events ?? byEvent.item_open) || 0,
    business_day: raw.business_day || null,
    partial_mode: Boolean(raw.partial_mode),
    aggregation_note: raw.aggregation_note || null,
    drinks_vs_food_pct: Number(raw.drinks_vs_food_pct) || 0,
  };
}

function emptyBiShell() {
  return normalizeBiDashboardPayload({
    total_events: 0,
    total_sessions: 0,
    by_language: {},
    by_event_type: {},
    top_items: [],
    top_categories: [],
    top_addon_pairs: [],
    by_hour: [],
    funnel: EMPTY_FUNNEL,
    partial_mode: true,
  });
}

export function hasMenuBiActivity(data) {
  return !isBiTotalsEmpty(data);
}

export function isBiTopItemsEmpty(data) {
  if (!data) return true;
  const items = data.top_items || [];
  if (items.some((t) => (Number(t.opens) || 0) > 0 || (Number(t.impressions) || 0) > 0)) {
    return false;
  }
  const by = data.by_event_type || {};
  return (Number(by.item_open) || 0) === 0 && (Number(by.item_impression) || 0) === 0;
}

export function isBiCategoriesEmpty(data) {
  if (!data) return true;
  if ((data.top_categories || []).some((c) => (Number(c.opens) || 0) > 0)) return false;
  return (Number(data.by_event_type?.category_open) || 0) === 0;
}

export function isBiAddonsEmpty(data) {
  if (!data) return true;
  if ((data.top_addon_pairs || []).length > 0) return false;
  return (Number(data.by_event_type?.add_on_click) || 0) === 0;
}

/** True only when RPC + all fallbacks produced no menu activity. */
export function isMenuBiFullyEmpty(data) {
  return isBiTotalsEmpty(data);
}

export function shouldShowLiveFallbackBanner(liveFallback) {
  if (!liveFallback) return false;
  if (process.env.NODE_ENV === "development") return true;
  return process.env.REACT_APP_SHOW_BI_FALLBACK_BANNER === "true";
}
