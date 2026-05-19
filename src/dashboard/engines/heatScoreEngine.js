import { normalizeFoodicsName } from "../utils/foodicsNameNormalize";

/**
 * Unified heat index: views, orders, conversion, revenue, modifier revenue, engagement.
 */
export function buildHeatScores({ funnels = [], salesItems = [], modifierLeaderboard = [] }) {
  const modRevMap = {};
  (modifierLeaderboard || []).forEach((m) => {
    modRevMap[normalizeFoodicsName(m.name)] = m.revenue || 0;
  });

  const items = (funnels || []).map((f) => {
    const views = Number(f.item_opens || f.item_impressions || 0);
    const orders = Number(f.orders || f.quantity_sold || 0);
    const conv = Number(f.conversion_pct || 0);
    const revenue = Number(f.net_sales || 0);
    const modRev = modRevMap[normalizeFoodicsName(f.item_name)] || 0;
    const engagement = Number(f.attention_score || f.deep_interest_rate || 0);

    const viewScore = views;
    const orderScore = orders * 3;
    const convScore = conv * 2;
    const revScore = revenue / 10;
    const modScore = modRev / 5;
    const engScore = engagement;

    const heatIndex = Math.round(viewScore * 0.25 + orderScore * 0.25 + convScore * 0.2 + revScore * 0.15 + modScore * 0.1 + engScore * 0.05);

    let band = "warm";
    if (heatIndex >= 120) band = "hot";
    else if (heatIndex < 40) band = "cold";

    let tag = null;
    if (views >= 20 && orders <= 2) tag = "high_interest_low_sales";
    else if (views < 8 && orders >= 10) tag = "hidden_gem";
    else if (views < 5 && orders < 2) tag = "dead";
    else if (heatIndex >= 100 && conv >= 15) tag = "overperformer";

    return {
      item_name: f.item_name,
      views,
      orders,
      conversion_pct: conv,
      revenue,
      modifier_revenue: modRev,
      heatIndex,
      band,
      tag,
      trend: orders > 0 ? "up" : views > 15 ? "flat" : "down",
    };
  });

  const maxHeat = Math.max(...items.map((i) => i.heatIndex), 1);

  return {
    items: items
      .map((i) => ({ ...i, heatPct: Math.round((i.heatIndex / maxHeat) * 100) }))
      .sort((a, b) => b.heatIndex - a.heatIndex),
    hotNow: items.filter((i) => i.band === "hot").slice(0, 6),
    hiddenGems: items.filter((i) => i.tag === "hidden_gem").slice(0, 6),
    deadItems: items.filter((i) => i.tag === "dead").slice(0, 6),
    highInterestLowSales: items.filter((i) => i.tag === "high_interest_low_sales").slice(0, 6),
  };
}
