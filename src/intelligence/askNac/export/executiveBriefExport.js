/**
 * Shared Executive Brief export helpers — single source for UI-adjacent PDF/CSV labels.
 */

export const EXECUTIVE_KPI_KEYS = Object.freeze([
  "gross_sales",
  "net_sales",
  "guest_count",
  "order_count",
  "avg_per_guest",
  "card_sales",
  "cash_sales",
  "delivery_sales",
]);

export const EXECUTIVE_METRIC_DISPLAY_LABELS = Object.freeze({
  gross_sales: "Gross Sales",
  net_sales: "Net Sales",
  guest_count: "Guest Count",
  order_count: "Orders",
  avg_per_guest: "Average Spend",
  card_sales: "Electronic Payments",
  cash_sales: "Cash",
  delivery_sales: "Delivery Sales",
  total_sales: "Total Sales",
});

export function resolveExecutiveMetricLabel(metric) {
  const key = metric?.key || metric?.metricKey || metric?.metric_key;
  if (key && EXECUTIVE_METRIC_DISPLAY_LABELS[key]) {
    return EXECUTIVE_METRIC_DISPLAY_LABELS[key];
  }
  const label = String(metric?.label || "").trim();
  if (/^card sales$/i.test(label)) return "Electronic Payments";
  return label || "Metric";
}

export function formatExportAnswerText(directAnswer) {
  if (directAnswer == null) return "";
  if (typeof directAnswer === "string") return directAnswer.trim();
  if (typeof directAnswer === "number" || typeof directAnswer === "boolean") {
    return String(directAnswer);
  }
  return "";
}

export function hasExecutiveBriefPayload(payload) {
  const brief = payload?.executiveBrief;
  return Boolean(
    brief &&
      typeof brief === "object" &&
      (String(brief.executiveSummary || "").trim() ||
        brief.keyFindings?.length ||
        brief.operationalRisks?.length ||
        brief.recommendedActions?.length ||
        brief.dataSources?.length),
  );
}

export function normalizeExecutiveBriefForExport(brief = {}) {
  if (!brief || typeof brief !== "object") {
    return {
      executiveSummary: "",
      keyFindings: [],
      operationalRisks: [],
      recommendedActions: [],
      dataSources: [],
    };
  }

  return {
    executiveSummary: String(brief.executiveSummary || "").trim(),
    keyFindings: [...(brief.keyFindings || [])].map((line) => String(line || "").trim()).filter(Boolean),
    operationalRisks: [...(brief.operationalRisks || [])]
      .map((line) => String(line || "").trim())
      .filter(Boolean),
    recommendedActions: [...(brief.recommendedActions || [])]
      .map((line) => String(line || "").trim())
      .filter(Boolean),
    dataSources: [...(brief.dataSources || [])].map((line) => String(line || "").trim()).filter(Boolean),
  };
}

export function extractExecutiveKpiMetrics(keyMetrics = []) {
  const byKey = new Map();
  (keyMetrics || []).forEach((metric) => {
    const key = metric.key || inferMetricKeyFromLabel(metric.label);
    if (!key || byKey.has(key)) return;
    byKey.set(key, {
      key,
      label: resolveExecutiveMetricLabel({ ...metric, key }),
      value: metric.value,
      unit: metric.unit || "",
      source: metric.source || "",
    });
  });

  return EXECUTIVE_KPI_KEYS.map((key) => byKey.get(key)).filter(Boolean);
}

function inferMetricKeyFromLabel(label = "") {
  const normalized = String(label).trim().toLowerCase();
  const entries = Object.entries(EXECUTIVE_METRIC_DISPLAY_LABELS);
  for (const [key, displayLabel] of entries) {
    if (displayLabel.toLowerCase() === normalized) return key;
  }
  if (/^card sales$/i.test(normalized)) return "card_sales";
  if (/^electronic payments$/i.test(normalized)) return "card_sales";
  if (/^delivery sales$/i.test(normalized)) return "delivery_sales";
  if (/^average spend/i.test(normalized)) return "avg_per_guest";
  return null;
}

export function applyExecutiveMetricDisplayLabels(keyMetrics = []) {
  return (keyMetrics || []).map((metric) => ({
    ...metric,
    label: resolveExecutiveMetricLabel(metric),
  }));
}
