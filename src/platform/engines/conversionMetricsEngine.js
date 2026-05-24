/**
 * Strict menu visibility → sales conversion — no fake % on sparse samples.
 */

import { CONFIDENCE } from "../contracts/dataConfidence";
import { REPORT_TRUTH, INSUFFICIENT_MENU_SAMPLE } from "../contracts/reportTruthContract";

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safePct(numerator, denominator, decimals = 1) {
  const num = safeNumber(numerator);
  const den = safeNumber(denominator);
  if (den <= 0) return null;
  const raw = (num / den) * 100;
  if (!Number.isFinite(raw)) return null;
  const factor = 10 ** decimals;
  return Math.min(100, Math.max(0, Math.round(raw * factor) / factor));
}

function confidenceRank(level) {
  const map = { [CONFIDENCE.HIGH]: 3, [CONFIDENCE.MEDIUM]: 2, [CONFIDENCE.LOW]: 1 };
  return map[level] || 0;
}

export function assessTrackingConfidence({
  views = 0,
  sessions = 0,
  impressions = 0,
  opens = 0,
} = {}) {
  const v = Math.max(safeNumber(views), safeNumber(impressions), safeNumber(opens));
  const s = safeNumber(sessions);
  const { minViews, minSessions } = REPORT_TRUTH.conversion;

  if (v >= minViews * 3 && s >= minSessions * 2) {
    return { level: CONFIDENCE.HIGH, provisional: false, score: 85 };
  }
  if (v >= minViews && s >= minSessions) {
    return { level: CONFIDENCE.MEDIUM, provisional: true, score: 55 };
  }
  return { level: CONFIDENCE.LOW, provisional: true, score: 20, insufficient_sample: true };
}

/**
 * Real conversion: tracked views only, gated by sample + confidence.
 */
export function computeStrictConversionMetrics(input = {}) {
  const imp = Math.max(0, safeNumber(input.impressions));
  const opens = Math.max(0, safeNumber(input.modalOpens ?? input.views));
  const trackedViews = imp > 0 ? imp : opens;
  const orders = Math.max(0, safeNumber(input.orders ?? input.quantity_sold));
  const netSales = Math.max(0, safeNumber(input.netSales ?? input.net_sales));
  const sessions = safeNumber(input.sessions ?? input.tracked_sessions);

  const trackingConfidence = input.trackingConfidence || assessTrackingConfidence({
    views: trackedViews,
    sessions,
    impressions: imp,
    opens,
  });

  const { minViews, minSessions, minOrdersForRate, minConfidenceForPct } = REPORT_TRUTH.conversion;
  const confidenceOk =
    confidenceRank(trackingConfidence.level) >= confidenceRank(minConfidenceForPct);

  const insufficientSample =
    trackedViews < minViews ||
    (sessions > 0 && sessions < minSessions) ||
    Boolean(trackingConfidence.insufficient_sample);

  let impression_conversion_pct = null;
  let conversion_allowed = false;

  if (
    !insufficientSample &&
    confidenceOk &&
    trackedViews >= minViews &&
    orders >= minOrdersForRate
  ) {
    const ordersFromViews = Math.min(orders, trackedViews);
    impression_conversion_pct = safePct(ordersFromViews, trackedViews);
    conversion_allowed = impression_conversion_pct != null;
  }

  const deep_interest_rate = imp > 0 ? safePct(opens, imp) : null;
  const offline_driven =
    orders >= REPORT_TRUTH.offline.minSalesForOffline &&
    trackedViews <= REPORT_TRUTH.offline.maxViewsForOffline;

  let trust_label = null;
  let seller_class = null;

  if (offline_driven || (trackedViews < minViews && orders >= REPORT_TRUTH.offline.minSalesForOffline)) {
    seller_class = orders >= 20 ? "operational_bestseller" : "offline_driven_seller";
    trust_label =
      orders >= 20
        ? "Operational bestseller — floor recommendation item, not low engagement."
        : "Offline-driven seller — strong POS volume with minimal menu visibility.";
  } else if (insufficientSample && orders > 0) {
    trust_label = INSUFFICIENT_MENU_SAMPLE;
  } else if (imp >= 25 && impression_conversion_pct != null && impression_conversion_pct < 5) {
    trust_label = "Menu trap — high visibility, weak sales conversion.";
  }

  const conversion_display = conversion_allowed
    ? `${impression_conversion_pct}%`
    : insufficientSample
      ? INSUFFICIENT_MENU_SAMPLE
      : trust_label || "—";

  return {
    item_impressions: imp,
    item_modal_opens: opens,
    item_views: trackedViews,
    quantity_sold: orders,
    orders_from_views: conversion_allowed ? Math.min(orders, trackedViews) : null,
    menu_conversion_pct: impression_conversion_pct,
    impression_conversion_pct,
    conversion_rate: impression_conversion_pct,
    conversion_pct: impression_conversion_pct,
    conversion_allowed,
    insufficient_sample: insufficientSample,
    tracking_confidence: trackingConfidence.level,
    confidence: trackingConfidence.level,
    provisional: trackingConfidence.provisional || !conversion_allowed,
    deep_interest_rate,
    modal_open_rate: deep_interest_rate,
    revenue_per_view: trackedViews > 0 && netSales > 0 ? Math.round((netSales / trackedViews) * 100) / 100 : null,
    trust_label,
    seller_class,
    offline_driven,
    conversion_display,
  };
}

/** Visibility × sales quadrant (medium+ confidence only). */
export function classifyVisibilitySalesQuadrant(row = {}, confidence = CONFIDENCE.LOW) {
  if (confidenceRank(confidence) < confidenceRank(REPORT_TRUTH.visibility.minConfidenceForQuadrant)) {
    return { quadrant: null, label: INSUFFICIENT_MENU_SAMPLE };
  }

  const views = Number(row.item_views ?? row.item_impressions) || 0;
  const sales = Number(row.quantity_sold ?? row.orders) || 0;
  const { highViewThreshold, lowViewThreshold, highSalesThreshold } = REPORT_TRUTH.visibility;

  const highVis = views >= highViewThreshold;
  const lowVis = views < lowViewThreshold;
  const highSales = sales >= highSalesThreshold;
  const lowSales = sales < highSalesThreshold;

  if (highVis && highSales) return { quadrant: "high_visibility_high_sales", label: "High visibility / high sales" };
  if (highVis && lowSales) return { quadrant: "high_visibility_weak_sales", label: "High visibility / weak sales" };
  if (lowVis && highSales) return { quadrant: "low_visibility_high_sales", label: "Low visibility / high sales" };
  return { quadrant: "low_visibility_low_sales", label: "Low visibility / low sales" };
}

export { safeNumber, safePct };
