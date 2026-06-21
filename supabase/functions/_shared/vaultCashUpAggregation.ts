import { pickAggregateMetricValue } from "./vaultSalesPerformanceIntelligence.ts";

type FactRow = Record<string, unknown>;

function resolveBusinessDate(fact: FactRow) {
  const raw = fact?.periodEnd ?? fact?.period_end ?? fact?.periodStart ?? fact?.period_start;
  const text = String(raw || "").trim().slice(0, 10);
  return text || null;
}

function pickDaySales(facts: FactRow[] = []) {
  return (
    pickAggregateMetricValue(facts, "net_sales")
    ?? pickAggregateMetricValue(facts, "total_sales")
    ?? pickAggregateMetricValue(facts, "gross_sales")
  );
}

function sumNumbers(values: number[] = []) {
  return values.reduce((sum, value) => sum + Number(value), 0);
}

export function groupCashUpFactsByBusinessDate(facts: FactRow[] = []) {
  const groups: Record<string, FactRow[]> = {};
  for (const fact of facts) {
    const date = resolveBusinessDate(fact);
    if (!date) continue;
    if (!groups[date]) groups[date] = [];
    groups[date].push(fact);
  }
  return groups;
}

export type CashUpRangeAggregation = {
  totalSales: number | null;
  totalGuests: number | null;
  totalOrders: number | null;
  averageSpend: number | null;
  totalDeliverySales: number | null;
  totalDeliveryOrders: number | null;
  dayCount: number;
  dailyBreakdown: Array<{
    date: string;
    totalSales: number | null;
    totalGuests: number | null;
    totalOrders: number | null;
    totalDeliverySales: number | null;
    totalDeliveryOrders: number | null;
  }>;
};

export function aggregateCashUpFactsOverRange({
  startDate,
  endDate,
  branchId,
  factsByDate = {},
  includeDailyBreakdown = true,
}: {
  startDate?: string | null;
  endDate?: string | null;
  branchId?: string | null;
  factsByDate?: Record<string, FactRow[]>;
  includeDailyBreakdown?: boolean;
}): CashUpRangeAggregation {
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
    ? dailyBreakdown.map((row) => row.totalSales).filter((v): v is number => v != null)
    : dates.map((date) => pickDaySales(factsByDate[date] || [])).filter((v): v is number => v != null);
  const guestValues = includeDailyBreakdown
    ? dailyBreakdown.map((row) => row.totalGuests).filter((v): v is number => v != null)
    : dates.map((date) => pickAggregateMetricValue(factsByDate[date] || [], "guest_count")).filter((v): v is number => v != null);
  const orderValues = includeDailyBreakdown
    ? dailyBreakdown.map((row) => row.totalOrders).filter((v): v is number => v != null)
    : dates.map((date) => pickAggregateMetricValue(factsByDate[date] || [], "order_count")).filter((v): v is number => v != null);
  const deliverySalesValues = includeDailyBreakdown
    ? dailyBreakdown.map((row) => row.totalDeliverySales).filter((v): v is number => v != null)
    : dates.map((date) => pickAggregateMetricValue(factsByDate[date] || [], "delivery_sales")).filter((v): v is number => v != null);
  const deliveryOrderValues = includeDailyBreakdown
    ? dailyBreakdown.map((row) => row.totalDeliveryOrders).filter((v): v is number => v != null)
    : dates.map((date) => pickAggregateMetricValue(factsByDate[date] || [], "delivery_orders")).filter((v): v is number => v != null);

  const totalSales = salesValues.length ? sumNumbers(salesValues) : null;
  const totalGuests = guestValues.length ? sumNumbers(guestValues) : null;
  const totalOrders = orderValues.length ? sumNumbers(orderValues) : null;
  const totalDeliverySales = deliverySalesValues.length ? sumNumbers(deliverySalesValues) : null;
  const totalDeliveryOrders = deliveryOrderValues.length ? sumNumbers(deliveryOrderValues) : null;

  let averageSpend: number | null = null;
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
    dayCount: dates.length,
    dailyBreakdown,
  };
}

export function buildCashUpRangeQueryLimit(startDate?: string | null, endDate?: string | null) {
  if (!startDate || !endDate) return 256;
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  const spanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  return Math.min(800, spanDays * 20);
}
