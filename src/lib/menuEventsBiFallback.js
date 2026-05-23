/**
 * Client-side menu_events aggregation when RPC / rollup returns false zeros or missing item detail.
 */

import { queryMenuEvents, MENU_EVENTS_EXTENDED_SELECT } from "./menuEventsQuery";
import { getBusinessDayRange, getBusinessDayKey } from "../dashboard/utils/businessDay";
import { hoursToRange, rangeToSince } from "../dashboard/utils/rangeState";
import { devLog } from "./devLog";
import { isBiTotalsEmpty } from "./biDashboardNormalize";

const ROW_LIMIT = 12000;

export function normalizeBranchForRpc(branch) {
  if (branch == null || branch === "" || branch === "all" || branch === "All") return null;
  const b = String(branch).trim().toLowerCase();
  return b === "all" ? null : b;
}

export function hoursToFilterRange(hours) {
  const h = Number(hours) || 24;
  return hoursToRange(h);
}

export { isBiTotalsEmpty } from "./biDashboardNormalize";

/** Rollup path omits item-level arrays even when session totals exist. */
export function biNeedsItemDetail(payload) {
  if (!payload || isBiTotalsEmpty(payload)) return false;
  const items = payload.top_items;
  if (Array.isArray(items) && items.length > 0) return false;
  const byType = payload.by_event_type || {};
  return (
    Number(byType.item_open) > 0 ||
    Number(byType.item_impression) > 0 ||
    Number(byType.category_open) > 0
  );
}

function logMenuEventsDiagnostics(ctx) {
  devLog("[menu_events BI]", ctx);
}

function sessionKey(row) {
  const id = (row.session_id || "").trim();
  return id || null;
}

function aggregateRows(rows, referenceDate = new Date()) {
  const byLanguage = {};
  const byEventType = {};
  const itemImpressions = new Map();
  const itemOpens = new Map();
  const categoryOpens = new Map();
  const addonPairs = new Map();
  const searches = new Map();
  const sessions = new Set();
  const hourly = new Map();

  const todayRange = getBusinessDayRange(referenceDate);

  for (const row of rows) {
    const lang = (row.language || "unknown").toString().slice(0, 2) || "unknown";
    byLanguage[lang] = (byLanguage[lang] || 0) + 1;

    const et = row.event_type || "unknown";
    byEventType[et] = (byEventType[et] || 0) + 1;

    const sk = sessionKey(row);
    if (sk) sessions.add(sk);

    const hourKey = row.created_at
      ? new Date(row.created_at).toISOString().slice(0, 13)
      : "unknown";
    hourly.set(hourKey, (hourly.get(hourKey) || 0) + 1);

    const name = (row.item_name_en || "").trim();
    if (et === "item_impression" && name) {
      const cur = itemImpressions.get(name) || { impressions: 0, impression_sessions: new Set() };
      cur.impressions += 1;
      if (sk) cur.impression_sessions.add(sk);
      itemImpressions.set(name, cur);
    }
    if (et === "item_open" && name) {
      itemOpens.set(name, (itemOpens.get(name) || 0) + 1);
    }
    if (et === "category_open" && row.category_id) {
      const cid = row.category_id;
      categoryOpens.set(cid, (categoryOpens.get(cid) || 0) + 1);
    }
    if (et === "add_on_click" && name && row.add_on_name) {
      const key = `${name}::${row.add_on_name}`;
      addonPairs.set(key, (addonPairs.get(key) || 0) + 1);
    }
    if ((et === "search_used" || et === "search_submit") && row.search_query) {
      const q = row.search_query.trim().toLowerCase();
      if (q) searches.set(q, (searches.get(q) || 0) + 1);
    }
  }

  const allNames = new Set([...itemImpressions.keys(), ...itemOpens.keys()]);
  const top_items = [...allNames]
    .map((name) => {
      const imp = itemImpressions.get(name);
      const impressions = imp?.impressions || 0;
      const opens = itemOpens.get(name) || 0;
      const impression_sessions = imp?.impression_sessions?.size || 0;
      return {
        name,
        impressions,
        opens,
        impression_sessions,
        visible_duration_ms: 0,
        deep_interest_rate:
          impressions > 0 ? Math.round((opens / impressions) * 1000) / 10 : null,
        avg_visible_duration_ms: 0,
      };
    })
    .sort((a, b) => Math.max(b.impressions, b.opens) - Math.max(a.impressions, a.opens))
    .slice(0, 20);

  const top_categories = [...categoryOpens.entries()]
    .map(([id, opens]) => ({ id, opens }))
    .sort((a, b) => b.opens - a.opens)
    .slice(0, 12);

  const top_addon_pairs = [...addonPairs.entries()]
    .map(([key, clicks]) => {
      const [item, addon] = key.split("::");
      return { item, addon, clicks };
    })
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 12);

  const top_searches = [...searches.entries()]
    .map(([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const by_hour = [...hourly.entries()]
    .map(([hour, count]) => ({ hour, count }))
    .sort((a, b) => a.hour.localeCompare(b.hour));

  let today_qr_sessions = 0;
  let today_unique_sessions = new Set();
  for (const row of rows) {
    const t = row.created_at ? new Date(row.created_at) : null;
    if (!t || t < todayRange.start || t > todayRange.end) continue;
    const sk = sessionKey(row);
    if (sk) today_unique_sessions.add(sk);
    if (row.event_type === "qr_session_start") today_qr_sessions += 1;
  }

  return {
    total_events: rows.length,
    total_sessions: sessions.size,
    by_language: byLanguage,
    by_event_type: byEventType,
    top_items,
    top_categories,
    top_addon_pairs,
    top_searches,
    by_hour,
    dead_zones: [],
    lost_searches: [],
    session_quality: {},
    lang_behavior: {},
    bounce_sessions: 0,
    deep_sessions: 0,
    avg_time_spent: 0,
    avg_items_per_session: 0,
    returning_sessions: 0,
    today_unique_sessions: today_unique_sessions.size,
    today_qr_sessions,
    funnel: {
      qr_scans: Number(byEventType.qr_session_start) || 0,
      category_opens: Number(byEventType.category_open) || 0,
      item_impressions: Number(byEventType.item_impression) || 0,
      item_opens: Number(byEventType.item_open) || 0,
      addon_clicks: Number(byEventType.add_on_click) || 0,
    },
    strongest_hour: (() => {
      if (!by_hour.length) return null;
      const peak = by_hour.reduce((best, h) => (h.count > best.count ? h : best), by_hour[0]);
      const h = parseInt(String(peak.hour).slice(11, 13), 10);
      return Number.isNaN(h) ? null : h;
    })(),
    business_day: {
      key: getBusinessDayKey(referenceDate),
      timezone: "Asia/Riyadh",
      note: "Operational day 03:00 – 02:59",
    },
    partial_mode: true,
    aggregation_note: "Aggregated from menu_events (client fallback)",
  };
}

/**
 * Fetch menu_events in range and build a get_bi_dashboard-shaped payload.
 */
export async function fetchBiFromMenuEvents(supabase, { branch = null, hours = 24 } = {}) {
  if (!supabase) return null;

  const pBranch = normalizeBranchForRpc(branch);
  const range = hoursToFilterRange(hours);
  const since = rangeToSince(range);
  const businessWindow = getBusinessDayRange();

  logMenuEventsDiagnostics({
    phase: "fetch_start",
    branch: pBranch,
    hours,
    range,
    businessDay: businessWindow,
    since,
  });

  let countQuery = supabase
    .from("menu_events")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since)
    .lte("created_at", new Date().toISOString());
  if (pBranch) countQuery = countQuery.eq("branch_id", pBranch);
  const countRes = await countQuery;
  const rowCount = countRes.count ?? 0;

  logMenuEventsDiagnostics({
    phase: "count",
    menu_events_in_range: rowCount,
    count_error: countRes.error?.message || null,
    filters: { branch: pBranch, since, hours, range },
  });

  if (countRes.error || rowCount === 0) {
    return null;
  }

  const { data: rows, error } = await queryMenuEvents(
    supabase,
    MENU_EVENTS_EXTENDED_SELECT,
    (q) => {
      let query = q
        .gte("created_at", since)
        .lte("created_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT);
      if (pBranch) query = query.eq("branch_id", pBranch);
      return query;
    },
  );

  if (error) {
    logMenuEventsDiagnostics({ phase: "query_error", message: error.message });
    return null;
  }

  const list = rows || [];
  logMenuEventsDiagnostics({
    phase: "aggregating",
    fetched_rows: list.length,
    capped: list.length >= ROW_LIMIT,
  });

  if (!list.length) return null;

  return aggregateRows(list);
}

/**
 * Item-level slices only (merge into rollup / partial RPC payloads).
 */
export async function fetchBiItemDetailFromMenuEvents(supabase, { branch = null, hours = 24 } = {}) {
  const full = await fetchBiFromMenuEvents(supabase, { branch, hours });
  if (!full) return null;
  return {
    top_items: full.top_items,
    top_categories: full.top_categories,
    top_addon_pairs: full.top_addon_pairs,
    top_searches: full.top_searches,
    dead_zones: full.dead_zones,
  };
}
