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

/** Normalize top_items from BI (impressions + opens). */
export function resolveItemVisibility(topItem) {
  const impressions = Number(topItem?.impressions) || 0;
  const opens = Number(topItem?.opens) || 0;
  const visibility = impressions > 0 ? impressions : opens;
  return {
    impressions,
    opens,
    visibility,
    hasImpressionData: impressions > 0,
    impression_sessions: Number(topItem?.impression_sessions) || 0,
    visible_duration_ms: Number(topItem?.visible_duration_ms) || 0,
  };
}

export function buildTopItemVisibilityMap(topItems = []) {
  const map = {};
  (topItems || []).forEach((t) => {
    if (!t?.name) return;
    map[t.name.toLowerCase()] = resolveItemVisibility(t);
  });
  return map;
}

export function hasVisibilityTracking(topItems = [], byEventType = {}) {
  if ((topItems || []).some((t) => Number(t.impressions) > 0)) return true;
  return Number(byEventType?.item_impression) > 0;
}

/** Attention score 0–100 with sub-scores (visibility, duration, deep interest, sales, revenue) */
export function computeAttentionScore({
  impressions = 0,
  modalOpens = 0,
  orders = 0,
  visibleDurationMs = 0,
  impressionSessions = 0,
  avgVisibleDurationMs = 0,
  netSales = 0,
  addonOpens = 0,
}) {
  const imp = safeNumber(impressions);
  const opens = safeNumber(modalOpens);
  const o = safeNumber(orders);
  if (!imp && !opens && !o) {
    return { score: 0, visibility_score: 0, duration_score: 0, deep_interest_score: 0, sales_score: 0, revenue_score: 0 };
  }

  const visibility_score = Math.min(100, Math.round(Math.min(imp, 120) * 0.35));
  const deep_interest_score = imp > 0 ? Math.min(100, Math.round(safePct(opens, imp) * 1.1)) : 0;
  const avgDur = avgVisibleDurationMs > 0
    ? avgVisibleDurationMs
    : impressionSessions > 0
      ? visibleDurationMs / impressionSessions
      : 0;
  const duration_score = Math.min(100, Math.round(Math.min(avgDur, 15000) / 150));
  const sales_score = Math.min(100, Math.round(Math.min(o, 25) * 3.2 + safePct(Math.min(o, imp), Math.max(imp, 1)) * 0.35));
  const revPerImp = imp > 0 ? safeNumber(netSales) / imp : 0;
  const revenue_score = Math.min(100, Math.round(revPerImp * 4.5));
  const addonBonus = opens > 0 ? Math.min(8, safePct(addonOpens, opens) * 0.15) : 0;

  const score = Math.min(
    100,
    Math.round(
      visibility_score * 0.22 +
        duration_score * 0.12 +
        deep_interest_score * 0.18 +
        sales_score * 0.32 +
        revenue_score * 0.14 +
        addonBonus,
    ),
  );

  return {
    score,
    visibility_score,
    duration_score,
    deep_interest_score,
    sales_score,
    revenue_score,
  };
}

/**
 * Visibility-first conversion metrics.
 * Primary denominator: item_impression, fallback item_open.
 */
export function computeConversionMetrics({
  impressions = 0,
  modalOpens = 0,
  orders = 0,
  netSales = 0,
  visibleDurationMs = 0,
  addonOpens = 0,
  views = 0,
}) {
  const imp = Math.max(0, safeNumber(impressions));
  const opens = Math.max(0, safeNumber(modalOpens || views));
  const primary = imp > 0 ? imp : opens;
  const o = Math.max(0, safeNumber(orders));
  const net = Math.max(0, safeNumber(netSales));

  const ordersFromPrimary = Math.min(o, primary);
  const impression_conversion_pct =
    primary > 0 ? safePct(ordersFromPrimary, primary) : (o > 0 ? null : 0);
  const deep_interest_rate = imp > 0 ? safePct(opens, imp) : null;
  const modal_open_rate = deep_interest_rate;
  const addon_curiosity_rate = opens > 0 ? safePct(addonOpens, opens) : null;
  const offline_ratio_pct = o > 0 ? safePct(Math.max(0, o - primary), o) : 0;
  const revenue_per_view = primary > 0 ? safeCurrency(net / primary) : null;

  let trust_label = null;
  if (imp > 0 && opens > 0 && deep_interest_rate != null && deep_interest_rate < 8 && o >= 5) {
    trust_label = "Visually confident item — guests see it without opening details.";
  } else if (imp >= 20 && opens >= 10 && impression_conversion_pct >= 8) {
    trust_label = "Star performer — strong visibility and efficient conversion.";
  } else if (primary === 0 && o > 0) {
    trust_label = "Offline-driven seller — strong POS volume with minimal menu visibility.";
  } else if (imp >= 25 && impression_conversion_pct < 5 && !offline_ratio_pct) {
    trust_label = "Menu trap — high visibility, weak sales conversion.";
  } else if (o > primary && primary > 0) {
    trust_label =
      offline_ratio_pct >= 50
        ? "Strong waiter-driven demand — orders exceed visible menu engagement."
        : "Extremely strong seller with significant offline ordering behavior.";
  } else if (imp >= 15 && deep_interest_rate != null && deep_interest_rate < 5 && o === 0) {
    trust_label = "Attractive but low deep interest — presentation may be self-explanatory.";
  }

  const offline_driven = (primary < 8 && o >= 10) || (primary === 0 && o > 0);

  return {
    item_impressions: imp,
    item_modal_opens: opens,
    item_views: primary,
    quantity_sold: o,
    orders_from_views: ordersFromPrimary,
    menu_conversion_pct: impression_conversion_pct,
    impression_conversion_pct,
    conversion_rate: impression_conversion_pct,
    deep_interest_rate,
    modal_open_rate,
    addon_curiosity_rate,
    offline_ratio_pct,
    revenue_per_view,
    trust_label,
    offline_driven,
    visible_duration_ms: safeNumber(visibleDurationMs),
  };
}

export function formatConversionCell(metrics) {
  if (!metrics) return "—";
  if (metrics.trust_label && (metrics.offline_driven || metrics.quantity_sold > metrics.item_views)) {
    return metrics.trust_label;
  }
  if (metrics.impression_conversion_pct == null && metrics.menu_conversion_pct == null) return "—";
  const pct = metrics.impression_conversion_pct ?? metrics.menu_conversion_pct;
  return `${pct}%`;
}

export function sanitizeFunnelRow(row = {}) {
  const impressions = safeNumber(row.item_impressions ?? row.impressions);
  const modalOpens = safeNumber(row.item_modal_opens ?? row.item_opens ?? row.opens);
  const orders = safeNumber(row.orders ?? row.quantity_sold);
  const metrics = computeConversionMetrics({
    impressions,
    modalOpens,
    orders,
    netSales: row.net_sales ?? 0,
    visibleDurationMs: row.visible_duration_ms,
    addonOpens: row.addon_opens,
  });
  const attention = computeAttentionScore({
    impressions: metrics.item_impressions,
    modalOpens: metrics.item_modal_opens,
    orders,
    visibleDurationMs: metrics.visible_duration_ms,
    impressionSessions: row.impression_sessions,
    avgVisibleDurationMs: row.avg_visible_duration_ms,
    netSales: row.net_sales ?? 0,
    addonOpens: row.addon_opens,
  });

  return {
    ...row,
    item_impressions: metrics.item_impressions,
    item_modal_opens: metrics.item_modal_opens,
    item_opens: modalOpens,
    item_views: metrics.item_views,
    impressions: metrics.item_impressions,
    orders,
    quantity_sold: orders,
    conversion_pct: metrics.impression_conversion_pct ?? 0,
    conversion_rate: metrics.impression_conversion_pct ?? 0,
    menu_conversion_pct: metrics.impression_conversion_pct,
    impression_conversion_pct: metrics.impression_conversion_pct,
    deep_interest_rate: metrics.deep_interest_rate,
    modal_open_rate: metrics.modal_open_rate,
    offline_ratio_pct: metrics.offline_ratio_pct,
    revenue_per_view: metrics.revenue_per_view ?? safeNumber(row.revenue_per_view, 0),
    trust_label: metrics.trust_label,
    offline_driven: metrics.offline_driven || row.offline_driven,
    attention_score: attention.score,
    attention_subscores: attention,
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
  const hasImpressions = Number(data?.by_event_type?.item_impression) > 0;
  if (!hasImpressions) warnings.push("no_impressions");
  return { valid: sessions >= 1, sessions, events, warnings, hasImpressions };
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
