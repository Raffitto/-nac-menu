/** Rule-based forecasts with confidence labels — no external ML */
import { clampMetric, safePct } from "../utils/intelligenceSanity";

function hourBand(h) {
  if (h == null) return "unknown";
  if (h < 11) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 18) return "afternoon";
  if (h < 22) return "evening";
  return "late_night";
}

export function buildForecasts(biData, intelligence, foodicsContext = null) {
  if (!biData) return { items: [], hours: [], categories: [], narratives: [], likelyTopSellers: [], declining: [] };

  const narratives = [];
  const funnels = intelligence?.funnels || foodicsContext?.conversionRows || [];
  const topItems = biData?.top_items || [];
  const byHour = biData?.by_hour || [];

  const trendingUp = [...funnels]
    .filter((f) => f.order_trend_pct > 5 || ((f.impressions ?? f.item_opens) >= 15 && clampMetric(f.conversion_pct, 0, 100) >= 8))
    .sort((a, b) => (b.order_trend_pct || 0) - (a.order_trend_pct || 0))
    .slice(0, 5)
    .map((f) => ({
      item_name: f.item_name,
      signal: f.order_trend_pct > 0 ? `+${f.order_trend_pct}% orders vs prior Foodics batch` : "Strong visibility-to-sales momentum",
      confidence: f.signal_strength === "Strong signal" ? "high" : "medium",
    }));

  const declining = [...funnels]
    .filter((f) => {
      if (f.order_trend_pct != null && f.order_trend_pct < -10) return true;
      const imp = f.impressions ?? f.item_opens ?? 0;
      return imp >= 15 && (f.orders || 0) >= 3 && f.order_trend_pct != null && f.order_trend_pct < -5;
    })
    .slice(0, 5)
    .map((f) => ({
      item_name: f.item_name,
      signal: f.order_trend_pct != null
        ? `${f.order_trend_pct}% orders vs prior batch`
        : "Views stable but orders softening",
      confidence: "medium",
    }));

  const peak = biData?.strongest_hour;
  if (peak != null) {
    narratives.push({
      type: "peak_hour",
      message: `Expect peak guest activity around ${peak}:00 (business day window).`,
      confidence: "medium",
    });
  }

  const dessertCat = intelligence?.categoryGrades?.find((c) => c.category_id === "desserts")
    || intelligence?.categoryHealth?.find((c) => c.category_id === "desserts");
  if (dessertCat && (dessertCat.opens > 15 || dessertCat.impressions > 20)) {
    narratives.push({
      type: "category",
      message: "Desserts likely peak after 9 PM — sustained category interest supports late-night promotion.",
      confidence: "low",
    });
  }

  const lateHours = byHour.filter((h) => {
    const d = h.hour ? new Date(h.hour) : null;
    const hr = d && !Number.isNaN(d.getTime()) ? d.getHours() : null;
    return hr != null && hr >= 21;
  });
  const lateVol = lateHours.reduce((s, h) => s + (Number(h.count) || 0), 0);
  const totalVol = byHour.reduce((s, h) => s + (Number(h.count) || 0), 0);
  if (totalVol > 0 && safePct(lateVol, totalVol) >= 25) {
    narratives.push({
      type: "late_night",
      message: "Late-night activity is material — align dessert and drinks visibility for after 9 PM.",
      confidence: "medium",
    });
  }

  const topImp = [...topItems].sort((a, b) => (b.impressions ?? b.opens) - (a.impressions ?? a.opens))[0];
  if (topImp) {
    const band = hourBand(peak);
    narratives.push({
      type: "top_item",
      message: `"${topImp.name}" leads impressions (${topImp.impressions ?? topImp.opens}) — likely remains high-attention next period.`,
      confidence: topImp.impressions >= 40 ? "medium" : "low",
    });
    if (band === "breakfast" || band === "lunch") {
      narratives.push({
        type: "daypart",
        message: `${band} daypart is active — feature daytime heroes on first screen.`,
        confidence: "low",
      });
    }
  }

  const likelyTopSellers = trendingUp.length
    ? trendingUp
    : [...funnels]
        .filter((f) => (f.orders || 0) >= 5)
        .sort((a, b) => (b.orders || 0) - (a.orders || 0))
        .slice(0, 3)
        .map((f) => ({
          item_name: f.item_name,
          signal: `${f.orders} Foodics orders · ${f.impression_conversion_pct ?? f.conversion_pct ?? 0}% visibility-to-sales`,
          confidence: f.order_confidence === "High confidence" ? "high" : "medium",
        }));

  if (likelyTopSellers[0]) {
    narratives.unshift({
      type: "tomorrow_top",
      message: `Likely tomorrow top seller: ${likelyTopSellers[0].item_name} — ${likelyTopSellers[0].signal}.`,
      confidence: likelyTopSellers[0].confidence,
    });
  }

  declining.slice(0, 2).forEach((d) => {
    narratives.push({
      type: "declining",
      message: `Declining signal: ${d.item_name} — ${d.signal}.`,
      confidence: "medium",
    });
  });

  const accel = trendingUp.find((t) => (t.signal || "").includes("+"));
  if (accel) {
    narratives.push({
      type: "acceleration",
      message: `Trend acceleration: ${accel.item_name} (${accel.signal}).`,
      confidence: "medium",
    });
  }

  return {
    likelyTopSellers,
    trendingUp,
    declining,
    peakHour: peak,
    narratives,
    acceleration: accel || null,
  };
}

export function answerForecastQuestion(question, biData, intelligence, foodics) {
  const q = question.toLowerCase();
  const forecasts = buildForecasts(biData, intelligence, foodics);

  if (q.includes("tomorrow") || q.includes("next week") || q.includes("forecast") || q.includes("trend")) {
    const top = forecasts.likelyTopSellers[0];
    if (top) {
      return {
        answer: `Likely top seller: "${top.item_name}". ${top.signal}. ${forecasts.narratives[0]?.message || ""}`,
        confidence: top.confidence || "medium",
        intent: "forecast",
      };
    }
  }

  if (q.includes("declin")) {
    const d = forecasts.declining[0];
    if (d) {
      return {
        answer: `Declining signal: ${d.item_name} — ${d.signal}.`,
        confidence: "medium",
        intent: "forecast",
      };
    }
  }

  if (q.includes("dessert") && q.includes("night")) {
    const n = forecasts.narratives.find((x) => x.type === "late_night" || x.type === "category");
    if (n) return { answer: n.message, confidence: n.confidence, intent: "forecast" };
  }

  if (q.includes("peak") || q.includes("hour")) {
    const h = forecasts.peakHour;
    return {
      answer: h != null ? `Peak activity expected around ${h}:00 (NAC business day).` : "Not enough hourly data for a forecast yet.",
      confidence: h != null ? "medium" : "low",
      intent: "forecast",
    };
  }

  return null;
}
