import {
  computeConversionMetrics,
  trendPct,
} from "./intelligenceSanity";

export function classifyConversion(row) {
  const views = Number(row.item_views) || 0;
  const orders = Number(row.quantity_sold) || 0;
  const rate = Number(row.menu_conversion_pct ?? row.conversion_rate) || 0;
  const offlineRatio = Number(row.offline_ratio_pct) || 0;

  if (views === 0 && orders > 0) {
    return {
      status: "Offline-driven seller",
      suggestion: "Item sells well offline. Make it more visible in the digital menu.",
    };
  }
  if (orders > views && views > 0) {
    const label =
      offlineRatio >= 50
        ? "Strong waiter-driven demand"
        : "Habit order behavior";
    return {
      status: label,
      suggestion:
        "Orders exceed menu opens — likely waiter-driven, repeat guests, or habitual orders. Increase digital visibility.",
    };
  }
  if (views > 0 && orders === 0) {
    return {
      status: "Interest without conversion",
      suggestion: "Guests view this item but do not order. Review price, photo, and description.",
    };
  }
  if (views >= 20 && rate < 5) {
    return {
      status: "High interest, low orders",
      suggestion: "Improve photo, description, price positioning, or staff recommendation.",
    };
  }
  if (views < 10 && orders >= 15) {
    return {
      status: "Low visibility, high orders",
      suggestion: "Item sells well offline. Feature it higher in the menu and category hero slots.",
    };
  }
  if (rate >= 12) {
    return {
      status: "Strong converter",
      suggestion: "Keep visibility and consider pairing with add-ons or combos.",
    };
  }
  if (views >= 15 && rate >= 5 && rate < 12) {
    return {
      status: "Hidden opportunity",
      suggestion: "Solid conversion with room to grow — test featured placement.",
    };
  }
  return {
    status: "Review presentation",
    suggestion: "Review menu presentation and operational alignment for this item.",
  };
}

/**
 * Merge Foodics sales with menu analytics item opens.
 */
export function buildConversionRows(salesItems = [], topItems = [], previousSales = []) {
  const viewsByName = {};
  (topItems || []).forEach((t) => {
    if (t.name) viewsByName[t.name.toLowerCase()] = Number(t.opens) || 0;
  });

  const prevByName = {};
  (previousSales || []).forEach((p) => {
    const key = (p.matched_menu_item_name || p.raw_item_name || "").toLowerCase();
    if (key) prevByName[key] = Number(p.quantity_sold) || 0;
  });

  const byItem = {};

  (salesItems || []).forEach((s) => {
    const displayName = s.matched_menu_item_name || s.raw_item_name;
    const key = displayName.toLowerCase();
    if (!byItem[key]) {
      byItem[key] = {
        item_name: displayName,
        raw_item_name: s.raw_item_name,
        matched_menu_item_name: s.matched_menu_item_name,
        quantity_sold: 0,
        net_sales: 0,
        gross_sales: 0,
        item_views: viewsByName[key] || viewsByName[(s.matched_menu_item_name || "").toLowerCase()] || 0,
      };
    }
    byItem[key].quantity_sold += Number(s.quantity_sold) || 0;
    byItem[key].net_sales += Number(s.net_sales) || 0;
    byItem[key].gross_sales += Number(s.gross_sales) || 0;
  });

  Object.entries(viewsByName).forEach(([key, views]) => {
    if (!byItem[key] && views > 0) {
      const top = topItems.find((t) => t.name.toLowerCase() === key);
      byItem[key] = {
        item_name: top?.name || key,
        raw_item_name: top?.name,
        matched_menu_item_name: top?.name,
        quantity_sold: 0,
        net_sales: 0,
        gross_sales: 0,
        item_views: views,
      };
    }
  });

  return Object.values(byItem)
    .map((row) => {
      const metrics = computeConversionMetrics({
        views: row.item_views,
        orders: row.quantity_sold,
        impressions: row.item_views,
        netSales: row.net_sales,
      });
      const order_trend_pct = trendPct(row.quantity_sold, prevByName[row.item_name.toLowerCase()] ?? null);
      const classified = classifyConversion({ ...row, ...metrics });
      return {
        ...row,
        ...metrics,
        order_trend_pct,
        status: classified.status,
        suggestion: classified.suggestion,
        conversion_display: metrics.trust_label || `${metrics.menu_conversion_pct ?? 0}%`,
      };
    })
    .sort((a, b) => (b.item_views || 0) - (a.item_views || 0));
}

export function getConversionOpportunities(rows) {
  const menuRows = [...rows];

  return {
    highClicksLowOrders: menuRows
      .filter((r) => r.item_views >= 10 && (r.menu_conversion_pct ?? r.conversion_rate ?? 0) < 5 && !r.offline_driven)
      .sort((a, b) => b.item_views - a.item_views)
      .slice(0, 5),
    highOrdersLowClicks: menuRows
      .filter((r) => r.offline_driven || (r.item_views < 10 && r.quantity_sold >= 5))
      .sort((a, b) => b.quantity_sold - a.quantity_sold)
      .slice(0, 5),
    bestRevenuePerClick: menuRows
      .filter((r) => r.revenue_per_view != null && r.item_views >= 5)
      .sort((a, b) => b.revenue_per_view - a.revenue_per_view)
      .slice(0, 5),
    bestConversion: menuRows
      .filter((r) => r.item_views >= 5 && !r.offline_driven)
      .sort((a, b) => (b.menu_conversion_pct ?? 0) - (a.menu_conversion_pct ?? 0))
      .slice(0, 5),
    worstConversion: menuRows
      .filter((r) => r.item_views >= 10 && !r.offline_driven)
      .sort((a, b) => (a.menu_conversion_pct ?? 0) - (b.menu_conversion_pct ?? 0))
      .slice(0, 5),
  };
}
