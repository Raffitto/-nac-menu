/**
 * Menu Intelligence chart rows — canonical visibility score only.
 */

import { normalizeTopItems } from "./topItemsNormalize";
import { visibilityEngagementScore } from "../../lib/unifiedOperationalTruth";

export function buildMenuIntelligenceChartItems(topItems = [], limit = 10) {
  return normalizeTopItems(topItems)
    .map((t) => {
      const opens = Number(t.opens ?? t.modal_opens ?? t.item_opens) || 0;
      const impressions = Number(t.impressions) || 0;
      const chartValue = visibilityEngagementScore(t);
      return {
        name: t.name,
        opens,
        impressions,
        chartValue,
        visibility_score: chartValue,
      };
    })
    .filter((t) => t.chartValue > 0)
    .sort((a, b) => b.chartValue - a.chartValue)
    .slice(0, limit);
}

export function buildMenuIntelligenceLowEngagement(topItems = [], limit = 5) {
  return normalizeTopItems(topItems)
    .map((t) => {
      const opens = Number(t.opens ?? t.modal_opens) || 0;
      const impressions = Number(t.impressions) || 0;
      return {
        name: t.name,
        opens,
        impressions,
        visibility_score: visibilityEngagementScore(t),
      };
    })
    .filter((t) => t.opens > 0 || t.impressions > 0)
    .sort(
      (a, b) =>
        a.visibility_score - b.visibility_score ||
        a.opens - b.opens ||
        a.impressions - b.impressions,
    )
    .slice(0, limit);
}
