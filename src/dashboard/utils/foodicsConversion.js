function pct(num, den) {
  if (!den || den <= 0) return 0;
  return Math.round((num / den) * 1000) / 10;
}

function trendPct(current, previous) {
  if (previous == null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function classifyConversion(row) {
  const views = Number(row.item_views) || 0;
  const orders = Number(row.quantity_sold) || 0;
  const rate = Number(row.conversion_rate) || 0;

  if (views === 0 && orders > 0) {
    return {
      status: "Offline seller / menu visibility opportunity",
      suggestion: "Item sells well offline. Make it more visible in the digital menu.",
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
      status: "High Interest, Low Orders",
      suggestion: "Improve photo, description, price positioning, or staff recommendation.",
    };
  }
  if (views < 10 && orders >= 15) {
    return {
      status: "Low Interest, High Orders",
      suggestion: "Item sells well offline. Feature it higher in the menu and category hero slots.",
    };
  }
  if (rate >= 12) {
    return {
      status: "Strong Converter",
      suggestion: "Keep visibility and consider pairing with add-ons or combos.",
    };
  }
  if (views >= 15 && rate >= 5 && rate < 12) {
    return {
      status: "Hidden Opportunity",
      suggestion: "Solid conversion with room to grow — test featured placement.",
    };
  }
  return {
    status: "Menu Problem",
    suggestion: "Review menu presentation and operational alignment for this item.",
  };
}

/**
 * Merge Foodics sales with menu analytics item opens.
 * @param {Array} salesItems - foodics_sales_items for batch
 * @param {Array} topItems - { name, opens } from get_bi_dashboard
 * @param {Array} [previousSales] - prior batch aggregated by name
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

  // Items with views but no Foodics sales
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
      const conversion_rate = pct(row.quantity_sold, row.item_views);
      const revenue_per_view =
        row.item_views > 0 ? Math.round((row.net_sales / row.item_views) * 100) / 100 : null;
      const prevOrders = prevByName[row.item_name.toLowerCase()] ?? null;
      const order_trend_pct = trendPct(row.quantity_sold, prevOrders);
      const classified = classifyConversion({ ...row, conversion_rate });
      return {
        ...row,
        conversion_rate,
        revenue_per_view,
        order_trend_pct,
        status: classified.status,
        suggestion: classified.suggestion,
      };
    })
    .sort((a, b) => (b.item_views || 0) - (a.item_views || 0));
}

export function getConversionOpportunities(rows) {
  const sorted = [...rows];
  return {
    highClicksLowOrders: sorted
      .filter((r) => r.item_views >= 10 && r.conversion_rate < 5)
      .sort((a, b) => b.item_views - a.item_views)
      .slice(0, 5),
    highOrdersLowClicks: sorted
      .filter((r) => r.item_views < 10 && r.quantity_sold >= 5)
      .sort((a, b) => b.quantity_sold - a.quantity_sold)
      .slice(0, 5),
    bestRevenuePerClick: sorted
      .filter((r) => r.revenue_per_view != null && r.item_views >= 5)
      .sort((a, b) => b.revenue_per_view - a.revenue_per_view)
      .slice(0, 5),
    bestConversion: sorted
      .filter((r) => r.item_views >= 5)
      .sort((a, b) => b.conversion_rate - a.conversion_rate)
      .slice(0, 5),
    worstConversion: sorted
      .filter((r) => r.item_views >= 10)
      .sort((a, b) => a.conversion_rate - b.conversion_rate)
      .slice(0, 5),
  };
}
