/**
 * Chart payload helpers for Conversation Intelligence visualization follow-ups.
 */

export const VISUALIZATION_FALLBACK =
  "I can visualize this once daily breakdown data is available.";

function pickBreakdownRows(response = {}) {
  const dataset = response?.conversationDataset;
  return dataset?.dailyBreakdown || dataset?.aggregation?.dailyBreakdown || [];
}

function inferMetricKey(response = {}) {
  const resolved = String(response?.conversationResolution?.resolvedQuestion || "").toLowerCase();
  const metric = String(response?.conversationDataset?.metric || "").toLowerCase();

  if (metric === "guests" || metric === "guest_count" || /\bguests?\b/.test(resolved)) {
    return "guests";
  }
  if (
    metric === "delivery_sales"
    || /\bdelivery\b/.test(resolved)
  ) {
    return "delivery_sales";
  }
  return "net_sales";
}

function valueForMetric(row, metricKey) {
  if (metricKey === "guests") {
    return row.totalGuests ?? row.guestCount ?? row.guests ?? null;
  }
  if (metricKey === "delivery_sales") {
    return row.totalDeliverySales ?? row.deliverySales ?? null;
  }
  return row.totalSales ?? row.netSales ?? row.sales ?? null;
}

const METRIC_LABELS = Object.freeze({
  net_sales: "Net sales",
  delivery_sales: "Delivery sales",
  guests: "Guest count",
});

export function isVisualizationFollowUp(response = {}) {
  if (response?.conversationResolution?.followUpCategory === "visualization") return true;
  if (response?.conversationResolution?.followUpCategory === "drill_down") return true;
  return /daily breakdown/i.test(String(response?.title || ""));
}

export function buildConversationChartPayload(response = {}) {
  const breakdown = pickBreakdownRows(response);
  if (!breakdown.length) return null;

  const metricKey = inferMetricKey(response);
  const points = breakdown
    .map((row) => ({
      date: row.date,
      label: row.date,
      value: valueForMetric(row, metricKey),
    }))
    .filter((row) => row.date && row.value != null && Number.isFinite(Number(row.value)));

  if (!points.length) return null;

  return {
    metricKey,
    metricLabel: METRIC_LABELS[metricKey] || "Value",
    unit: metricKey === "guests" ? "" : "SAR",
    chartType: "bar",
    points,
  };
}

export function resolveVisualizationPresentation(response = {}) {
  const chart = buildConversationChartPayload(response);
  if (chart) {
    return { chart, fallback: null };
  }
  if (isVisualizationFollowUp(response)) {
    return { chart: null, fallback: VISUALIZATION_FALLBACK };
  }
  return { chart: null, fallback: null };
}
