import {
  computeConversionMetrics,
  computeAttentionScore,
  trendPct,
  buildTopItemVisibilityMap,
  filterExecutiveRows,
  enrichRowWithReportTruth,
  formatExecutiveConversion,
} from "./intelligenceSanity";
import { classifyItemBehavior, BEHAVIOR } from "./itemBehaviorEngine";

export function classifyConversion(row) {
  const c = classifyItemBehavior(row);
  return { status: c.status, suggestion: c.suggestion };
}

/**
 * Merge Foodics sales with menu visibility (impressions) + deep interest (opens).
 */
export function buildConversionRows(salesItems = [], topItems = [], previousSales = [], options = {}) {
  const { totalSessions = 0, importIntegrity = null } = options;
  const visibilityMap = buildTopItemVisibilityMap(topItems);

  const prevByName = {};
  (previousSales || []).forEach((p) => {
    const key = (p.matched_menu_item_name || p.raw_item_name || "").toLowerCase();
    if (key) prevByName[key] = Number(p.quantity_sold) || 0;
  });

  const byItem = {};

  (salesItems || []).forEach((s) => {
    const displayName = s.matched_menu_item_name || s.raw_item_name;
    const key = displayName.toLowerCase();
    const vis = visibilityMap[key] || visibilityMap[(s.matched_menu_item_name || "").toLowerCase()] || {};
    if (!byItem[key]) {
      byItem[key] = {
        item_name: displayName,
        raw_item_name: s.raw_item_name,
        matched_menu_item_name: s.matched_menu_item_name,
        quantity_sold: 0,
        net_sales: 0,
        gross_sales: 0,
        item_impressions: vis.impressions || 0,
        item_modal_opens: vis.opens || 0,
        item_views: vis.visibility || 0,
        impression_sessions: vis.impression_sessions || 0,
        visible_duration_ms: vis.visible_duration_ms || 0,
      };
    }
    byItem[key].quantity_sold += Number(s.quantity_sold) || 0;
    byItem[key].net_sales += Number(s.net_sales) || 0;
    byItem[key].gross_sales += Number(s.gross_sales) || 0;
  });

  Object.entries(visibilityMap).forEach(([key, vis]) => {
    if (!byItem[key] && vis.visibility > 0) {
      const top = topItems.find((t) => t.name?.toLowerCase() === key);
      byItem[key] = {
        item_name: top?.name || key,
        raw_item_name: top?.name,
        matched_menu_item_name: top?.name,
        quantity_sold: 0,
        net_sales: 0,
        gross_sales: 0,
        item_impressions: vis.impressions,
        item_modal_opens: vis.opens,
        item_views: vis.visibility,
        impression_sessions: vis.impression_sessions,
        visible_duration_ms: vis.visible_duration_ms,
      };
    }
  });

  const mapped = Object.values(byItem)
    .map((row) => {
      const metrics = computeConversionMetrics({
        impressions: row.item_impressions,
        modalOpens: row.item_modal_opens,
        orders: row.quantity_sold,
        netSales: row.net_sales,
        visibleDurationMs: row.visible_duration_ms,
        sessions: row.impression_sessions || totalSessions,
      });
      const behavior = classifyItemBehavior({ ...row, ...metrics });
      const attention = computeAttentionScore({
        impressions: metrics.item_impressions,
        modalOpens: metrics.item_modal_opens,
        orders: row.quantity_sold,
        visibleDurationMs: row.visible_duration_ms,
        impressionSessions: row.impression_sessions,
        avgVisibleDurationMs: row.avg_visible_duration_ms,
        netSales: row.net_sales,
      });
      const order_trend_pct = trendPct(row.quantity_sold, prevByName[row.item_name.toLowerCase()] ?? null);

      return enrichRowWithReportTruth(
        {
          ...row,
          ...metrics,
          ...behavior,
          attention_score: attention.score,
          attention_subscores: attention,
          order_trend_pct,
          conversion_display: formatExecutiveConversion({ ...row, ...metrics }),
          integrity_failure: importIntegrity?.integrity_failure,
        },
        { importIntegrity },
      );
    })
    .sort((a, b) => (b.item_impressions || b.item_views || 0) - (a.item_impressions || a.item_views || 0));

  return filterExecutiveRows(mapped);
}

export function getConversionOpportunities(rows) {
  const menuRows = [...rows];
  const byType = (t) => menuRows.filter((r) => r.behavior_type === t);

  return {
    highVisibilityLowOrders: menuRows
      .filter(
        (r) =>
          (r.item_impressions || 0) >= 15 &&
          r.conversion_allowed &&
          (r.impression_conversion_pct ?? 0) < 5 &&
          r.behavior_type === BEHAVIOR.MENU_TRAP,
      )
      .sort((a, b) => (b.item_impressions || 0) - (a.item_impressions || 0))
      .slice(0, 5),
    highOrdersLowVisibility: menuRows
      .filter((r) =>
        [BEHAVIOR.HIDDEN_OPPORTUNITY, BEHAVIOR.WAITER_DRIVEN, BEHAVIOR.HABIT_ORDER].includes(r.behavior_type),
      )
      .sort((a, b) => b.quantity_sold - a.quantity_sold)
      .slice(0, 5),
    visualSellers: byType(BEHAVIOR.VISUAL_SELLER).slice(0, 5),
    discoverySellers: byType(BEHAVIOR.DISCOVERY_SELLER).slice(0, 5),
    bestRevenuePerImpression: menuRows
      .filter((r) => r.revenue_per_view != null && (r.item_impressions || r.item_views) >= 5)
      .sort((a, b) => b.revenue_per_view - a.revenue_per_view)
      .slice(0, 5),
    bestConversion: menuRows
      .filter(
        (r) =>
          r.conversion_allowed &&
          r.impression_conversion_pct != null &&
          r.behavior_type !== BEHAVIOR.MENU_TRAP,
      )
      .sort((a, b) => (b.impression_conversion_pct ?? 0) - (a.impression_conversion_pct ?? 0))
      .slice(0, 5),
    worstConversion: menuRows
      .filter(
        (r) =>
          r.conversion_allowed &&
          (r.item_impressions || 0) >= 15 &&
          r.behavior_type === BEHAVIOR.MENU_TRAP,
      )
      .sort((a, b) => (a.impression_conversion_pct ?? 0) - (b.impression_conversion_pct ?? 0))
      .slice(0, 5),
    // legacy keys
    highClicksLowOrders: menuRows
      .filter((r) => (r.item_impressions || 0) >= 15 && (r.impression_conversion_pct ?? 0) < 5)
      .slice(0, 5),
    highOrdersLowClicks: menuRows.filter((r) =>
      [BEHAVIOR.HIDDEN_OPPORTUNITY, BEHAVIOR.WAITER_DRIVEN].includes(r.behavior_type),
    ).slice(0, 5),
    bestRevenuePerClick: menuRows
      .filter((r) => r.revenue_per_view != null)
      .sort((a, b) => b.revenue_per_view - a.revenue_per_view)
      .slice(0, 5),
    visualConfidence: byType(BEHAVIOR.VISUAL_SELLER).slice(0, 5),
  };
}
