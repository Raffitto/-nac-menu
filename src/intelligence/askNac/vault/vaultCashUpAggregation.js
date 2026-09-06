/**
 * Multi-day cash-up fact grouping and aggregation (structured facts only).
 */

import {
  pickAggregateMetricValue,
  normalizeDeliveryPlatform,
  DELIVERY_PLATFORM_KEYS,
} from "./vaultSalesPerformanceIntelligence";

function resolveBusinessDate(fact) {
  const raw = fact?.periodEnd ?? fact?.period_end ?? fact?.periodStart ?? fact?.period_start;
  const text = String(raw || "").trim().slice(0, 10);
  return text || null;
}

function pickDaySales(facts = []) {
  return (
    pickAggregateMetricValue(facts, "net_sales")
    ?? pickAggregateMetricValue(facts, "total_sales")
    ?? pickAggregateMetricValue(facts, "gross_sales")
  );
}

function sumNumbers(values = []) {
  return values.reduce((sum, value) => sum + Number(value), 0);
}

function initPlatformTotals() {
  return DELIVERY_PLATFORM_KEYS.reduce((acc, key) => {
    acc[key] = { sales: 0, orders: 0 };
    return acc;
  }, {});
}

/**
 * Sum delivery_sales / delivery_orders by dimensions.platform across a date range.
 */
export function aggregateDeliveryPlatformBreakdown(factsByDate = {}, startDate, endDate) {
  const totals = initPlatformTotals();
  const dates = Object.keys(factsByDate)
    .filter((date) => (!startDate || date >= startDate) && (!endDate || date <= endDate))
    .sort();

  for (const date of dates) {
    for (const fact of factsByDate[date] || []) {
      const metricKey = fact.metricKey || fact.metric_key;
      if (metricKey !== "delivery_sales" && metricKey !== "delivery_orders") continue;
      const platform = normalizeDeliveryPlatform(fact.dimensions?.platform);
      if (!platform) continue;
      const value = Number(fact.metricValue ?? fact.metric_value);
      if (!Number.isFinite(value)) continue;
      if (metricKey === "delivery_sales") totals[platform].sales += value;
      if (metricKey === "delivery_orders") totals[platform].orders += value;
    }
  }

  let totalDeliverySales = 0;
  let totalDeliveryOrders = 0;
  for (const key of DELIVERY_PLATFORM_KEYS) {
    totalDeliverySales += totals[key].sales;
    totalDeliveryOrders += totals[key].orders;
  }

  const deliveryPlatformBreakdown = {};
  for (const key of DELIVERY_PLATFORM_KEYS) {
    const sales = totals[key].sales;
    const orders = totals[key].orders;
    if (sales === 0 && orders === 0) continue;
    deliveryPlatformBreakdown[key] = {
      sales,
      orders,
      averageOrderValue: orders > 0 ? sales / orders : null,
      salesShare: totalDeliverySales > 0 ? (sales / totalDeliverySales) * 100 : null,
      orderShare: totalDeliveryOrders > 0 ? (orders / totalDeliveryOrders) * 100 : null,
    };
  }

  const rankedBySales = Object.entries(deliveryPlatformBreakdown)
    .sort((a, b) => b[1].sales - a[1].sales);
  const rankedByOrders = Object.entries(deliveryPlatformBreakdown)
    .sort((a, b) => b[1].orders - a[1].orders);

  return {
    deliveryPlatformBreakdown,
    topPlatformBySales: rankedBySales[0]?.[0] || null,
    topPlatformByOrders: rankedByOrders[0]?.[0] || null,
  };
}

/**
 * Group cash-up structured facts by business date (period_end).
 * @returns {Record<string, object[]>}
 */
export function groupCashUpFactsByBusinessDate(facts = []) {
  const groups = {};
  for (const fact of facts || []) {
    const date = resolveBusinessDate(fact);
    if (!date) continue;
    if (!groups[date]) groups[date] = [];
    groups[date].push(fact);
  }
  return groups;
}

/**
 * @returns {{
 *   totalSales: number|null,
 *   totalGuests: number|null,
 *   totalOrders: number|null,
 *   averageSpend: number|null,
 *   totalDeliverySales: number|null,
 *   totalDeliveryOrders: number|null,
 *   dayCount: number,
 *   dailyBreakdown: Array<{ date: string, totalSales: number|null, totalGuests: number|null, totalOrders: number|null, totalDeliverySales: number|null, totalDeliveryOrders: number|null }>
 * }}
 */
export function aggregateCashUpFactsOverRange({
  startDate,
  endDate,
  branchId,
  factsByDate = {},
  includeDailyBreakdown = true,
}) {
  void branchId;
  const dates = Object.keys(factsByDate)
    .filter((date) => (!startDate || date >= startDate) && (!endDate || date <= endDate))
    .sort();

  const dailyBreakdown = includeDailyBreakdown ? dates.map((date) => {
    const dayFacts = factsByDate[date] || [];
    const totalSales = pickDaySales(dayFacts);
    const totalGuests = pickAggregateMetricValue(dayFacts, "guest_count");
    const totalOrders = pickAggregateMetricValue(dayFacts, "order_count");
    const totalDeliverySales = pickAggregateMetricValue(dayFacts, "delivery_sales");
    const totalDeliveryOrders = pickAggregateMetricValue(dayFacts, "delivery_orders");
    return {
      date,
      totalSales: totalSales != null ? Number(totalSales) : null,
      totalGuests: totalGuests != null ? Number(totalGuests) : null,
      totalOrders: totalOrders != null ? Number(totalOrders) : null,
      totalDeliverySales: totalDeliverySales != null ? Number(totalDeliverySales) : null,
      totalDeliveryOrders: totalDeliveryOrders != null ? Number(totalDeliveryOrders) : null,
    };
  }) : [];

  const salesValues = includeDailyBreakdown
    ? dailyBreakdown.map((row) => row.totalSales).filter((v) => v != null)
    : dates.map((date) => pickDaySales(factsByDate[date] || [])).filter((v) => v != null);
  const guestValues = includeDailyBreakdown
    ? dailyBreakdown.map((row) => row.totalGuests).filter((v) => v != null)
    : dates.map((date) => pickAggregateMetricValue(factsByDate[date] || [], "guest_count")).filter((v) => v != null);
  const orderValues = includeDailyBreakdown
    ? dailyBreakdown.map((row) => row.totalOrders).filter((v) => v != null)
    : dates.map((date) => pickAggregateMetricValue(factsByDate[date] || [], "order_count")).filter((v) => v != null);
  const deliverySalesValues = includeDailyBreakdown
    ? dailyBreakdown.map((row) => row.totalDeliverySales).filter((v) => v != null)
    : dates.map((date) => pickAggregateMetricValue(factsByDate[date] || [], "delivery_sales")).filter((v) => v != null);
  const deliveryOrderValues = includeDailyBreakdown
    ? dailyBreakdown.map((row) => row.totalDeliveryOrders).filter((v) => v != null)
    : dates.map((date) => pickAggregateMetricValue(factsByDate[date] || [], "delivery_orders")).filter((v) => v != null);

  const totalSales = salesValues.length ? sumNumbers(salesValues) : null;
  const totalGuests = guestValues.length ? sumNumbers(guestValues) : null;
  const totalOrders = orderValues.length ? sumNumbers(orderValues) : null;
  const totalDeliverySales = deliverySalesValues.length ? sumNumbers(deliverySalesValues) : null;
  const totalDeliveryOrders = deliveryOrderValues.length ? sumNumbers(deliveryOrderValues) : null;

  let averageSpend = null;
  if (totalSales != null && totalGuests != null && totalGuests > 0) {
    averageSpend = totalSales / totalGuests;
  }

  const platformAgg = aggregateDeliveryPlatformBreakdown(factsByDate, startDate, endDate);

  const salesDates = includeDailyBreakdown
    ? dailyBreakdown.filter((row) => row.totalSales != null).map((row) => row.date)
    : dates.filter((date) => pickDaySales(factsByDate[date] || []) != null);
  const deliveryOrderDates = includeDailyBreakdown
    ? dailyBreakdown.filter((row) => row.totalDeliveryOrders != null).map((row) => row.date)
    : dates.filter((date) => pickAggregateMetricValue(factsByDate[date] || [], "delivery_orders") != null);

  const expectedDayCount = countCalendarDaysInRange(startDate, endDate);
  const dayCount = dates.length;
  const missingDayCount = expectedDayCount > 0 ? Math.max(0, expectedDayCount - dayCount) : 0;

  return {
    totalSales,
    totalGuests,
    totalOrders,
    averageSpend,
    totalDeliverySales,
    totalDeliveryOrders,
    dayCount,
    expectedDayCount,
    missingDayCount,
    requestedStartDate: startDate || null,
    requestedEndDate: endDate || null,
    dailyBreakdown,
    salesCoverageStart: salesDates[0] || null,
    salesCoverageEnd: salesDates[salesDates.length - 1] || null,
    deliveryOrderCoverageStart: deliveryOrderDates[0] || null,
    deliveryPlatformBreakdown: platformAgg.deliveryPlatformBreakdown,
    topPlatformBySales: platformAgg.topPlatformBySales,
    topPlatformByOrders: platformAgg.topPlatformByOrders,
  };
}

export function buildCashUpRangeQueryLimit(startDate, endDate) {
  if (!startDate || !endDate) return 256;
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  const spanDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
  return Math.min(800, spanDays * 20);
}

export function countCalendarDaysInRange(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  if (end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}

/** Ensure requested-window coverage metadata is always present for matched comparisons. */
export function enrichCashUpAggregationCoverageMeta(aggregation, startDate, endDate) {
  if (!aggregation) return aggregation;
  const expected = Number(aggregation.expectedDayCount)
    || countCalendarDaysInRange(
      aggregation.requestedStartDate || startDate,
      aggregation.requestedEndDate || endDate,
    )
    || 0;
  const dayCount = Number(aggregation.dayCount) || 0;
  return {
    ...aggregation,
    expectedDayCount: expected || null,
    missingDayCount: expected > 0 ? Math.max(0, expected - dayCount) : (aggregation.missingDayCount ?? null),
    requestedStartDate: aggregation.requestedStartDate || startDate || null,
    requestedEndDate: aggregation.requestedEndDate || endDate || null,
  };
}

export function splitRangeIntoMonthChunks(startDate, endDate) {
  const chunks = [];
  if (!startDate || !endDate || startDate > endDate) return chunks;

  let y = Number(startDate.slice(0, 4));
  let m = Number(startDate.slice(5, 7)) - 1;
  const endY = Number(endDate.slice(0, 4));
  const endM = Number(endDate.slice(5, 7)) - 1;

  while (y < endY || (y === endY && m <= endM)) {
    const monthStart = chunks.length === 0
      ? startDate
      : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const isLastMonth = y === endY && m === endM;
    const monthEnd = isLastMonth
      ? endDate
      : `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const monthLabel = new Date(Date.UTC(y, m, 1, 12)).toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    chunks.push({ startDate: monthStart, endDate: monthEnd, label: monthLabel });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return chunks;
}

export function shouldUseChunkedCashUpFetch(startDate, endDate, periodType) {
  if (periodType === "year_to_date") return true;
  return countCalendarDaysInRange(startDate, endDate) > 35;
}

export function shouldSkipDailyBreakdownForRange(startDate, endDate, periodType) {
  if (periodType === "year_to_date") return true;
  return countCalendarDaysInRange(startDate, endDate) > 31;
}

export function shouldSkipDailyBreakdownForSimpleMetric(question, periodType, startDate, endDate) {
  if (shouldSkipDailyBreakdownForRange(startDate, endDate, periodType)) return true;
  const q = String(question || "").toLowerCase();
  if (/\b(compare|versus|\bvs\b|week over week|wow|rank|best|worst|which day)\b/.test(q)) return false;
  return ["this_week", "this_month", "last_week", "named_month", "previous_week"].includes(String(periodType || ""));
}

export function coverageRowsFromCashUpAggregation(aggregation, {
  startDate,
  endDate,
  branchId = null,
} = {}) {
  const available = Array.isArray(aggregation?.availableDates)
    ? aggregation.availableDates
    : [];
  return [{
    id: "rpc-cash-up-range",
    branchId,
    department: "finance",
    reportType: "cash_up",
    periodStart: startDate || aggregation?.requestedStartDate || null,
    periodEnd: endDate || aggregation?.requestedEndDate || null,
    factCount: Number(aggregation?.dayCount) || 0,
    readinessStatus: (Number(aggregation?.dayCount) || 0) > 0 ? "ready" : "missing",
    lastIngestedAt: aggregation?.salesCoverageEnd || null,
    sourceFileId: null,
    fileTitle: null,
    availableDates: available,
    freshness: aggregation?.salesCoverageEnd || null,
  }];
}
