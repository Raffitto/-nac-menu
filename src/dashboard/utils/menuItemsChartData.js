/**
 * Menu Intelligence chart rows — real counts, merged duplicates, no flat bars.
 */

import { normalizeTopItems } from "./topItemsNormalize";
import { resolveItemVisibility } from "./intelligenceSanity";

export function buildMenuIntelligenceChartItems(topItems = [], limit = 10) {
  return normalizeTopItems(topItems)
    .map((t) => {
      const vis = resolveItemVisibility(t);
      const chartValue = Math.max(vis.opens, vis.impressions);
      return {
        name: t.name,
        opens: vis.opens,
        impressions: vis.impressions,
        chartValue,
      };
    })
    .filter((t) => t.chartValue > 0)
    .sort((a, b) => b.chartValue - a.chartValue)
    .slice(0, limit);
}

export function buildMenuIntelligenceLowEngagement(topItems = [], limit = 5) {
  return normalizeTopItems(topItems)
    .map((t) => {
      const vis = resolveItemVisibility(t);
      return { name: t.name, opens: vis.opens, impressions: vis.impressions };
    })
    .filter((t) => t.opens > 0 || t.impressions > 0)
    .sort((a, b) => a.opens - b.opens || a.impressions - b.impressions)
    .slice(0, limit);
}
