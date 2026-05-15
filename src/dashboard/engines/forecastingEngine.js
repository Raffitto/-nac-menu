/** Rule-based forecasts from trends — no external ML */
import { clampMetric } from "../utils/intelligenceSanity";

export function buildForecasts(biData, intelligence, foodicsContext = null) {
  if (!biData) return { items: [], hours: [], categories: [], narratives: [] };

  const narratives = [];
  const funnels = intelligence?.funnels || foodicsContext?.conversionRows || [];
  const topItems = biData?.top_items || [];

  const trendingUp = [...funnels]
    .filter((f) => f.order_trend_pct > 5 || (f.item_opens >= 15 && clampMetric(f.conversion_pct, 0, 100) >= 8))
    .sort((a, b) => (b.order_trend_pct || 0) - (a.order_trend_pct || 0))
    .slice(0, 5)
    .map((f) => ({
      item_name: f.item_name,
      signal: f.order_trend_pct > 0 ? `+${f.order_trend_pct}% orders vs prior period` : "Strong conversion momentum",
      confidence: "medium",
    }));

  const declining = [...funnels]
    .filter((f) => f.order_trend_pct != null && f.order_trend_pct < -10)
    .slice(0, 5)
    .map((f) => ({
      item_name: f.item_name,
      signal: `${f.order_trend_pct}% orders vs prior period`,
      confidence: "medium",
    }));

  const peak = biData?.strongest_hour;
  if (peak != null) {
    narratives.push({
      type: "peak_hour",
      message: `Expect peak scans around ${peak}:00 based on recent activity.`,
      confidence: "medium",
    });
  }

  const dessertCat = intelligence?.categoryHealth?.find((c) => c.category_id === "desserts");
  if (dessertCat && dessertCat.opens > 20) {
    narratives.push({
      type: "category",
      message: "Dessert categories show sustained interest — consider late-night dessert promotions after 9 PM.",
      confidence: "low",
    });
  }

  topItems.slice(0, 3).forEach((t) => {
    narratives.push({
      type: "top_item",
      message: `"${t.name}" likely remains a top seller next period (${t.opens} views).`,
      confidence: "medium",
    });
  });

  return {
    likelyTopSellers: trendingUp.length ? trendingUp : topItems.slice(0, 3).map((t) => ({ item_name: t.name, signal: `${t.opens} views`, confidence: "low" })),
    trendingUp,
    declining,
    peakHour: peak,
    narratives,
  };
}

export function answerForecastQuestion(question, biData, intelligence, foodics) {
  const q = question.toLowerCase();
  const forecasts = buildForecasts(biData, intelligence, foodics);

  if (q.includes("next week") || q.includes("forecast") || q.includes("trend")) {
    const top = forecasts.likelyTopSellers[0];
    if (top) {
      return {
        answer: `Likely top attention: "${top.item_name}". ${top.signal}. ${forecasts.narratives[0]?.message || ""}`,
        confidence: "medium",
        intent: "forecast",
      };
    }
  }

  if (q.includes("peak") || q.includes("hour")) {
    const h = forecasts.peakHour;
    return {
      answer: h != null ? `Peak activity expected around ${h}:00.` : "Not enough hourly data for a forecast yet.",
      confidence: h != null ? "medium" : "low",
      intent: "forecast",
    };
  }

  return null;
}
