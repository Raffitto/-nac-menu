/**
 * Internal operational adapter — maps cash-up / vault-style metrics to NIL signals.
 */

import { createSignal, EVIDENCE_LEVELS, NIL_DOMAINS } from "../nilContract";
import { registerNilSignalAdapter } from "../signalFramework";

const METRIC_LABELS = {
  sales_change_pct: "Sales change",
  guest_change_pct: "Guest count change",
  avg_spend_change_pct: "Average spend change",
  orders_change_pct: "Order count change",
  delivery_sales_change_pct: "Delivery sales change",
  delivery_orders_change_pct: "Delivery orders change",
  complaints_change: "Complaint volume change",
  delivery_performance: "Delivery performance",
  voids_change_pct: "Void rate change",
  discounts_change_pct: "Discount volume change",
};

function formatPct(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  const sign = num > 0 ? "+" : "";
  return `${sign}${num}%`;
}

function adaptInternalOperationalSignal(raw, context = {}) {
  if (!raw || typeof raw !== "object") return null;

  if (raw.metric && METRIC_LABELS[raw.metric]) {
    const value = raw.value;
    const num = Number(value);
    const isStable = raw.stable === true
      || String(value).toLowerCase() === "stable"
      || (Number.isFinite(num) && Math.abs(num) < 0.5 && raw.metric.includes("change"));

    let direction = "stable";
    if (!isStable && Number.isFinite(num)) {
      direction = num > 0 ? "up" : "down";
    } else if (raw.direction) {
      direction = raw.direction;
    }

    return createSignal({
      domain: NIL_DOMAINS.INTERNAL_OPERATIONAL,
      type: "metric",
      label: METRIC_LABELS[raw.metric],
      value: raw.metric.includes("change") && Number.isFinite(Number(value)) ? formatPct(value) : value,
      unit: raw.unit || (raw.metric.includes("pct") ? "%" : ""),
      direction,
      periodLabel: raw.periodLabel || context.periodLabel || "",
      branchLabel: raw.branchLabel || context.branchLabel || "",
      sources: [{
        name: raw.source || "Cash-up facts",
        detail: raw.sourceDetail || "Uploaded cash-up analytics",
        reliability: 0.92,
        branch: raw.branchLabel || context.branchLabel || "",
        period: raw.periodLabel || context.periodLabel || "",
      }],
      reliability: 0.92,
      evidenceLevel: EVIDENCE_LEVELS.FACT,
      metadata: { metricKey: raw.metric },
    });
  }

  if (raw.recommendation) {
    return createSignal({
      domain: NIL_DOMAINS.INTERNAL_OPERATIONAL,
      type: "observation",
      label: String(raw.recommendation),
      value: raw.recommendation,
      evidenceLevel: EVIDENCE_LEVELS.RECOMMENDATION,
      sources: [{ name: raw.source || "Operational review", reliability: 0.6 }],
      reliability: 0.6,
    });
  }

  return null;
}

registerNilSignalAdapter(NIL_DOMAINS.INTERNAL_OPERATIONAL, adaptInternalOperationalSignal);

export { adaptInternalOperationalSignal, METRIC_LABELS };
