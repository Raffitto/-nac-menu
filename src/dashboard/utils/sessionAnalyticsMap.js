/**
 * Maps get_bi_dashboard RPC payload → Session Analytics aggregate shape.
 */

const CATEGORY_NAMES = {
  brunch: "Brunch",
  daytime: "Daytime",
  breakfast: "Breakfast",
  evening: "Evening",
  desserts: "Desserts",
  drinks: "Drinks",
};

export function mapBiToSessionAggregates(bi) {
  if (!bi || typeof bi !== "object") return null;

  const byType = bi.by_event_type || {};
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
    by_hour: (bi.by_hour || []).map((row) => ({
      hour: row.hour,
      count: Number(row.count) || 0,
    })),
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
  };
}
