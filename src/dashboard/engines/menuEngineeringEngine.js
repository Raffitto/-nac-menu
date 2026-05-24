/** BCG-style menu engineering: Star, Puzzle, Workhorse, Dog */
import { clampMetric, filterExecutiveRows } from "../utils/intelligenceSanity";

export function classifyMenuItems(funnels = []) {
  const visible = filterExecutiveRows(funnels);
  if (!visible.length) return [];

  const withOrders = visible.filter((f) => f.orders > 0 || f.item_opens > 0);
  const maxViews = Math.max(...withOrders.map((f) => f.item_opens), 1);
  const maxRev = Math.max(...withOrders.map((f) => (f.revenue_per_view || 0) * f.item_opens), 1);
  const convEligible = withOrders.filter((f) => f.conversion_allowed && f.conversion_pct != null);
  const maxConv = Math.max(...convEligible.map((f) => clampMetric(f.conversion_pct, 0, 100)), 1);

  return withOrders.map((f) => {
    const viewScore = (f.item_opens / maxViews) * 100;
    const revScore = (((f.revenue_per_view || 0) * f.item_opens) / maxRev) * 100;
    const convScore =
      f.conversion_allowed && f.conversion_pct != null
        ? ((f.conversion_pct || 0) / maxConv) * 100
        : 0;
    const popularity = viewScore;
    const profitability = revScore * 0.6 + convScore * 0.4;

    let quadrant = "Dog";
    let suggestion = "Consider hiding, bundling, or repositioning.";

    if (popularity >= 50 && profitability >= 50) {
      quadrant = "Star";
      suggestion = "Feature prominently. Protect quality and visibility.";
    } else if (popularity >= 50 && profitability < 50) {
      quadrant = "Puzzle";
      suggestion = "High interest, weak conversion — improve photo, description, or price.";
    } else if (popularity < 50 && profitability >= 50) {
      quadrant = "Workhorse";
      suggestion = "Strong performer with low visibility — promote higher in menu.";
    }

    return {
      item_name: f.item_name,
      quadrant,
      popularity: Math.round(popularity),
      profitability: Math.round(profitability),
      views: f.item_opens,
      orders: f.orders,
      conversion_pct: f.conversion_pct,
      suggestion,
    };
  }).sort((a, b) => b.popularity - a.popularity);
}
