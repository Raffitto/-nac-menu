/**
 * Maps get_bi_dashboard RPC payload → Session Analytics aggregate shape.
 */

import {
  normalizeHourlyForRange,
  resolveChartGranularityForHours,
  dayCountForHours,
} from "./hourlyPipeline";
import { hourlyChartRows } from "./hourlyBucketLabels";
import { rangeToHours } from "./rangeState";
import { enrichByEventTypeCanonical } from "../../lib/menuEventTypes";

const CATEGORY_NAMES = {
  brunch: "Brunch",
  daytime: "Daytime",
  breakfast: "Breakfast",
  evening: "Evening",
  desserts: "Desserts",
  drinks: "Drinks",
};

/** Aggregate top_addon_pairs from get_bi_dashboard → { name, clicks }[] */
export function mapBiTopAddons(bi) {
  const pairs = bi?.top_addon_pairs || [];
  const counts = {};
  for (const p of pairs) {
    const name = (p.addon || p.add_on_name || "Unknown").trim() || "Unknown";
    counts[name] = (counts[name] || 0) + (Number(p.clicks) || 0);
  }
  return Object.entries(counts)
    .map(([name, clicks]) => ({ name, clicks }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 12);
}

export function mapBiToSessionAggregates(bi, options = {}) {
  if (!bi || typeof bi !== "object") return null;

  const hours = options.hours ?? rangeToHours(options.selectedRange || "today");
  const byHourRaw = (bi.by_hour || []).map((row) => ({
    hour: row.hour ?? row.bucket ?? row.business_day_key ?? row.day_key,
    count: Number(row.count) || 0,
    granularity: row.granularity,
  }));
  const normalized = normalizeHourlyForRange(byHourRaw, hours);
  const chartRows = hourlyChartRows(normalized, {
    fillGaps: options.fillGaps !== false,
    granularity: resolveChartGranularityForHours(hours),
    dayCount: dayCountForHours(hours),
  });

  const byType = enrichByEventTypeCanonical(bi.by_event_type || {});
  const topCategories = (bi.top_categories || []).map((c) => ({
    id: c.id ?? c.category_id,
    opens: Number(c.opens) || 0,
    name: CATEGORY_NAMES[c.id] || c.id,
  }));

  return {
    total_events: Number(bi.total_events) || 0,
    total_sessions: Number(bi.total_sessions) || 0,
    by_language: bi.by_language || {},
    by_event_type: byType,
    top_items: bi.top_items || [],
    top_categories: topCategories,
    top_searches: bi.top_searches || [],
    top_sections: bi.top_sections || [],
    menu_tab_engagement: bi.menu_tab_engagement || [],
    by_hour: chartRows.map((row) => ({
      hour: row.bucket ?? row.hour,
      count: row.count,
      granularity: row.granularity,
      label: row.label,
    })),
    by_role: bi.by_role || {},
    by_branch: bi.by_branch || {},
    drinks_vs_food_pct: bi.drinks_vs_food_pct ?? 0,
    scroll_depth_events: Number(byType.scroll_depth) || 0,
    time_spent_events: Number(byType.time_spent) || 0,
    bounce_sessions: Number(bi.bounce_sessions) || 0,
    deep_sessions: Number(bi.deep_sessions) || 0,
    avg_time_spent: Number(bi.avg_time_spent) || 0,
    avg_items_per_session: Number(bi.avg_items_per_session) || 0,
    returning_sessions: Number(bi.returning_sessions) || 0,
    today_qr_sessions: Number(byType.qr_session_start) || 0,
    modal_engagement_events: Number(byType.item_open) || 0,
    funnel: bi.funnel || {},
    session_quality: bi.session_quality || {},
    session_operational: bi.session_operational || {},
  };
}
