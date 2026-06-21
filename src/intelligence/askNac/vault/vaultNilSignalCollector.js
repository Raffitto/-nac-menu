/**
 * Build internal NIL signals from cash-up period aggregations (read-only, no external APIs).
 */

import { EVIDENCE_LEVELS, NIL_DOMAINS } from "../../nil/nilContract";

const STABLE_PCT_THRESHOLD = 0.5;

function pctChange(current, previous) {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
  return ((c - p) / p) * 100;
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function metricSignal(metric, value, { stable = false, periodLabel, branchLabel, sourceDetail }) {
  return {
    metric,
    value: stable ? 0 : round1(value),
    stable,
    periodLabel,
    branchLabel,
    source: "Cash-up facts",
    sourceDetail,
    reliability: 0.92,
  };
}

function correlationSignal(label, { periodLabel, branchLabel, supports = [] }) {
  return {
    label,
    observation: label,
    evidenceLevel: EVIDENCE_LEVELS.CORRELATION,
    domain: NIL_DOMAINS.INTERNAL_OPERATIONAL,
    periodLabel,
    branchLabel,
    source: "Cash-up analytics correlation",
    reliability: 0.85,
    supports,
  };
}

/**
 * @param {object} current
 * @param {object} previous
 * @param {object} [options]
 * @returns {unknown[]}
 */
export function buildInternalSignalsFromAggregations(current = {}, previous = {}, options = {}) {
  const periodLabel = options.periodLabel || "";
  const branchLabel = options.branchLabel || "";
  const sourceDetail = options.sourceDetail || "Uploaded cash-up structured facts";
  const signals = [];

  const mappings = [
    ["sales_change_pct", current.totalSales, previous.totalSales],
    ["guest_change_pct", current.totalGuests, previous.totalGuests],
    ["orders_change_pct", current.totalOrders, previous.totalOrders],
    ["avg_spend_change_pct", current.averageSpend, previous.averageSpend],
    ["delivery_sales_change_pct", current.totalDeliverySales, previous.totalDeliverySales],
    ["delivery_orders_change_pct", current.totalDeliveryOrders, previous.totalDeliveryOrders],
  ];

  for (const [metric, currentVal, previousVal] of mappings) {
    const pct = pctChange(currentVal, previousVal);
    if (pct == null) continue;
    signals.push(metricSignal(metric, pct, {
      stable: Math.abs(pct) < STABLE_PCT_THRESHOLD,
      periodLabel,
      branchLabel,
      sourceDetail,
    }));
  }

  const deliverySalesPct = pctChange(current.totalDeliverySales, previous.totalDeliverySales);
  const deliveryOrdersPct = pctChange(current.totalDeliveryOrders, previous.totalDeliveryOrders);
  const deliveryStable = (deliverySalesPct == null || Math.abs(deliverySalesPct) < STABLE_PCT_THRESHOLD)
    && (deliveryOrdersPct == null || Math.abs(deliveryOrdersPct) < STABLE_PCT_THRESHOLD);
  if (deliveryStable && (current.totalDeliverySales != null || current.totalDeliveryOrders != null)) {
    signals.push({
      metric: "delivery_performance",
      value: "stable",
      stable: true,
      periodLabel,
      branchLabel,
      source: "Cash-up facts",
      sourceDetail,
      reliability: 0.92,
    });
  }

  if (current.dayCount != null && previous.dayCount != null && current.dayCount !== previous.dayCount) {
    signals.push({
      label: "Cash-up coverage differed between periods",
      value: `${current.dayCount} day(s) vs ${previous.dayCount} day(s)`,
      evidenceLevel: EVIDENCE_LEVELS.FACT,
      domain: NIL_DOMAINS.INTERNAL_OPERATIONAL,
      periodLabel,
      branchLabel,
      source: "Cash-up coverage",
      reliability: 0.95,
    });
  }

  return [...signals, ...buildInternalCorrelationSignals(signals, { periodLabel, branchLabel })];
}

function buildInternalCorrelationSignals(metricSignals = [], context = {}) {
  const byMetric = Object.fromEntries(
    metricSignals.filter((s) => s.metric).map((s) => [s.metric, s]),
  );
  const correlations = [];

  const sales = byMetric.sales_change_pct;
  const guests = byMetric.guest_change_pct;
  const spend = byMetric.avg_spend_change_pct;

  if (sales && guests && !sales.stable && !guests.stable) {
    const sameDirection = (sales.value < 0 && guests.value < 0) || (sales.value > 0 && guests.value > 0);
    if (sameDirection) {
      correlations.push(correlationSignal(
        "Sales change moved in the same direction as guest count change",
        { ...context, supports: [sales.metric, guests.metric] },
      ));
    }
  }

  if (sales && spend && !sales.stable) {
    if (spend.stable) {
      correlations.push(correlationSignal(
        "Average spend remained stable while sales changed, so the move is unlikely to be spend-per-guest driven alone",
        { ...context, supports: [sales.metric, spend.metric] },
      ));
    } else {
      const sameDirection = (sales.value < 0 && spend.value < 0) || (sales.value > 0 && spend.value > 0);
      correlations.push(correlationSignal(
        sameDirection
          ? "Sales and average spend moved together"
          : "Sales and average spend moved in different directions",
        { ...context, supports: [sales.metric, spend.metric] },
      ));
    }
  }

  const delivery = byMetric.delivery_performance;
  if (sales && delivery?.stable && !sales.stable) {
    correlations.push(correlationSignal(
      "Delivery performance remained stable while sales changed",
      { ...context, supports: [sales.metric, delivery.metric] },
    ));
  }

  return correlations;
}

export function buildPlatformDeliveryChangeSignals(current = {}, previous = {}, context = {}) {
  const currentBreakdown = current.deliveryPlatformBreakdown || {};
  const previousBreakdown = previous.deliveryPlatformBreakdown || {};
  const signals = [];

  for (const platform of new Set([...Object.keys(currentBreakdown), ...Object.keys(previousBreakdown)])) {
    const pct = pctChange(currentBreakdown[platform]?.sales, previousBreakdown[platform]?.sales);
    if (pct == null || Math.abs(pct) < STABLE_PCT_THRESHOLD) continue;
    signals.push({
      label: `${platform} delivery sales change`,
      value: round1(pct),
      unit: "%",
      domain: NIL_DOMAINS.INTERNAL_OPERATIONAL,
      evidenceLevel: EVIDENCE_LEVELS.FACT,
      periodLabel: context.periodLabel,
      branchLabel: context.branchLabel,
      source: "Cash-up delivery platform facts",
      reliability: 0.9,
      metadata: { platform },
    });
  }

  return signals;
}
