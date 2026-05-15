/** Data sanity + trust helpers for all intelligence engines */

const MAX_PCT = 100;

export function safeNumber(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

export function clampMetric(value, min = 0, max = MAX_PCT) {
  const n = safeNumber(value, min);
  return Math.min(max, Math.max(min, n));
}

export function safePct(numerator, denominator, { max = MAX_PCT, decimals = 1 } = {}) {
  const num = safeNumber(numerator);
  const den = safeNumber(denominator);
  if (den <= 0) return 0;
  const raw = (num / den) * 100;
  if (!Number.isFinite(raw)) return 0;
  const factor = 10 ** decimals;
  return clampMetric(Math.round(raw * factor) / factor, 0, max);
}

export function safeCurrency(value) {
  const n = safeNumber(value, NaN);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

export function trendPct(current, previous) {
  const cur = safeNumber(current);
  const prev = safeNumber(previous, NaN);
  if (!Number.isFinite(prev) || prev === 0) return null;
  const raw = ((cur - prev) / prev) * 100;
  if (!Number.isFinite(raw)) return null;
  return clampMetric(Math.round(raw * 10) / 10, -999, 999);
}

/**
 * Trustworthy conversion metrics when orders may exceed menu views.
 */
export function computeConversionMetrics({
  views = 0,
  orders = 0,
  impressions = null,
  netSales = 0,
}) {
  const v = Math.max(0, safeNumber(views));
  const o = Math.max(0, safeNumber(orders));
  const imp = impressions != null ? Math.max(0, safeNumber(impressions)) : v;
  const net = Math.max(0, safeNumber(netSales));

  const ordersFromViews = Math.min(o, v);
  const menu_conversion_pct = v > 0 ? safePct(ordersFromViews, v) : (o > 0 ? null : 0);
  const offline_ratio_pct = o > 0 ? safePct(Math.max(0, o - v), o) : 0;
  const exposure_efficiency_pct = imp > 0 ? safePct(o, imp) : null;
  const revenue_per_view = v > 0 ? safeCurrency(net / v) : null;

  let trust_label = null;
  if (o > v && v > 0) {
    if (offline_ratio_pct >= 50) {
      trust_label = "Strong offline-driven demand — orders exceed menu opens.";
    } else {
      trust_label = "Extremely strong seller with significant offline ordering behavior.";
    }
  } else if (v === 0 && o > 0) {
    trust_label = "Offline-driven seller — strong POS volume with minimal menu discovery.";
  } else if (v > 0 && o === 0) {
    trust_label = "Menu interest without matching POS orders in this period.";
  }

  const offline_driven = o > v || (v < 8 && o >= 10);

  return {
    item_views: v,
    quantity_sold: o,
    orders_from_views: ordersFromViews,
    menu_conversion_pct,
    conversion_rate: menu_conversion_pct,
    offline_ratio_pct,
    exposure_efficiency_pct,
    revenue_per_view,
    trust_label,
    offline_driven,
  };
}

export function formatConversionCell(metrics) {
  if (!metrics) return "—";
  if (metrics.trust_label && (metrics.offline_driven || metrics.quantity_sold > metrics.item_views)) {
    return metrics.trust_label;
  }
  if (metrics.menu_conversion_pct == null) return "—";
  return `${metrics.menu_conversion_pct}%`;
}

export function sanitizeFunnelRow(row = {}) {
  const views = safeNumber(row.item_opens ?? row.item_views ?? row.impressions);
  const orders = safeNumber(row.orders ?? row.quantity_sold);
  const metrics = computeConversionMetrics({
    views,
    orders,
    impressions: row.impressions ?? views,
    netSales: row.net_sales ?? 0,
  });

  return {
    ...row,
    item_opens: views,
    item_views: views,
    impressions: safeNumber(row.impressions, views),
    orders,
    quantity_sold: orders,
    conversion_pct: metrics.menu_conversion_pct ?? 0,
    conversion_rate: metrics.menu_conversion_pct ?? 0,
    menu_conversion_pct: metrics.menu_conversion_pct,
    offline_ratio_pct: metrics.offline_ratio_pct,
    exposure_efficiency_pct: metrics.exposure_efficiency_pct,
    revenue_per_view: metrics.revenue_per_view ?? safeNumber(row.revenue_per_view, 0),
    trust_label: metrics.trust_label,
    offline_driven: metrics.offline_driven || row.offline_driven,
    order_trend_pct: row.order_trend_pct != null ? clampMetric(row.order_trend_pct, -999, 999) : null,
  };
}

export function validateInsightData(data) {
  if (!data || typeof data !== "object") {
    return { valid: false, sessions: 0, events: 0, warnings: ["no_data"] };
  }
  const sessions = safeNumber(data.total_sessions);
  const events = safeNumber(data.total_events);
  const warnings = [];
  if (sessions < 5) warnings.push("low_sessions");
  if (events < 20) warnings.push("low_events");
  return { valid: sessions >= 1, sessions, events, warnings };
}

export function computeTrustConfidence({
  baseLevel = "low",
  sampleSize = 0,
  hasHistory = false,
  hasFoodics = false,
}) {
  let score = baseLevel === "high" ? 75 : baseLevel === "medium" ? 50 : 25;
  if (sampleSize >= 10000) score += 20;
  else if (sampleSize >= 1000) score += 12;
  else if (sampleSize >= 200) score += 6;
  else if (sampleSize < 50) score -= 15;

  if (hasHistory) score += 10;
  if (hasFoodics) score += 5;

  let level = "low";
  let phrase = "Early signal detected.";
  if (score >= 72) {
    level = "high";
    phrase = "Consistent trend detected.";
  } else if (score >= 42) {
    level = "medium";
    phrase = "Current behavior suggests";
  }

  return { level, phrase, score };
}

export function buildDataContext({ events = 0, sessions = 0, period = "All time", foodicsBatch = false }) {
  const parts = [];
  if (events > 0) parts.push(`Based on ${events.toLocaleString()} menu events`);
  if (sessions > 0) parts.push(`${sessions.toLocaleString()} sessions`);
  if (period) parts.push(period);
  if (foodicsBatch) parts.push("compared to previous Foodics import");
  return parts.filter(Boolean).join(" · ");
}

export function exportCell(value, fallback = "—") {
  if (value == null || value === "" || (typeof value === "number" && !Number.isFinite(value))) {
    return fallback;
  }
  if (typeof value === "number" && value > MAX_PCT && String(value).includes(".")) {
    return fallback;
  }
  return value;
}
