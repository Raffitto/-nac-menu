/** Chart-ready series for Recharts */
import { clampMetric } from "../utils/intelligenceSanity";
import {
  hourlyChartRows,
  detectHourlyGranularity,
} from "../utils/hourlyBucketLabels";
import { hoursToRange } from "../utils/rangeState";

export function hourlyChartSeries(biData, hours = 24) {
  const rangeId = hoursToRange(hours);
  const dayCount = rangeId === "month" ? 31 : rangeId === "7d" ? 7 : undefined;
  const gran = detectHourlyGranularity(biData?.by_hour || []);
  return hourlyChartRows(biData?.by_hour || [], {
    fillGaps: true,
    granularity: gran,
    dayCount,
  });
}

export function categoryChartSeries(categoryHealth = []) {
  return categoryHealth.map((c) => ({
    name: c.category_name,
    opens: c.opens,
    engagement: c.engagement_pct,
    grade: c.grade,
  }));
}

export function conversionChartSeries(funnels = [], limit = 12) {
  return [...funnels]
    .filter((f) => f.item_opens > 0)
    .sort((a, b) => b.conversion_pct - a.conversion_pct)
    .slice(0, limit)
    .map((f) => ({
      name: f.item_name?.length > 18 ? `${f.item_name.slice(0, 16)}…` : f.item_name,
      conversion: clampMetric(f.conversion_pct, 0, 100),
      views: f.item_opens,
      orders: f.orders,
    }));
}

export function menuQuadrantSeries(menuEngineering = []) {
  const counts = { Star: 0, Puzzle: 0, Workhorse: 0, Dog: 0 };
  menuEngineering.forEach((m) => { counts[m.quadrant] = (counts[m.quadrant] || 0) + 1; });
  return Object.entries(counts).map(([name, value]) => ({ name, value }));
}

export function languageChartSeries(biData) {
  const byLang = biData?.by_language || {};
  return [
    { name: "Arabic", value: Number(byLang.ar) || 0 },
    { name: "English", value: Number(byLang.en) || 0 },
  ];
}
