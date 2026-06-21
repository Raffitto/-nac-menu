/**
 * Multi-day cash-up fact grouping and aggregation (structured facts only).
 */

import { pickAggregateMetricValue } from "./vaultSalesPerformanceIntelligence";

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
export function aggregateCashUpFactsOverRange({ startDate, endDate, branchId, factsByDate = {} }) {
  void branchId;
  const dates = Object.keys(factsByDate)
    .filter((date) => (!startDate || date >= startDate) && (!endDate || date <= endDate))
    .sort();

  const dailyBreakdown = dates.map((date) => {
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
  });

  const salesValues = dailyBreakdown.map((row) => row.totalSales).filter((v) => v != null);
  const guestValues = dailyBreakdown.map((row) => row.totalGuests).filter((v) => v != null);
  const orderValues = dailyBreakdown.map((row) => row.totalOrders).filter((v) => v != null);
  const deliverySalesValues = dailyBreakdown.map((row) => row.totalDeliverySales).filter((v) => v != null);
  const deliveryOrderValues = dailyBreakdown.map((row) => row.totalDeliveryOrders).filter((v) => v != null);

  const totalSales = salesValues.length ? sumNumbers(salesValues) : null;
  const totalGuests = guestValues.length ? sumNumbers(guestValues) : null;
  const totalOrders = orderValues.length ? sumNumbers(orderValues) : null;
  const totalDeliverySales = deliverySalesValues.length ? sumNumbers(deliverySalesValues) : null;
  const totalDeliveryOrders = deliveryOrderValues.length ? sumNumbers(deliveryOrderValues) : null;

  let averageSpend = null;
  if (totalSales != null && totalGuests != null && totalGuests > 0) {
    averageSpend = totalSales / totalGuests;
  }

  return {
    totalSales,
    totalGuests,
    totalOrders,
    averageSpend,
    totalDeliverySales,
    totalDeliveryOrders,
    dayCount: dailyBreakdown.length,
    dailyBreakdown,
  };
}

export function buildCashUpRangeQueryLimit(startDate, endDate) {
  if (!startDate || !endDate) return 512;
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  const spanDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
  return Math.min(4000, spanDays * 48);
}
