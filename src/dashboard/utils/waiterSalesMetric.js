/** Waiter leaderboard sales metric — default gross to match Foodics pivot */

export const WAITER_SALES_METRICS = {
  gross: { id: "gross", label: "Gross Sales", field: "gross_sales" },
  net: { id: "net", label: "Net Sales", field: "net_sales" },
};

export const DEFAULT_WAITER_SALES_METRIC = "gross";

export function waiterSalesValue(waiter, metricId = DEFAULT_WAITER_SALES_METRIC) {
  if (!waiter) return 0;
  if (metricId === "net") return Number(waiter.net_sales) || 0;
  const gross = Number(waiter.gross_sales);
  if (Number.isFinite(gross) && gross > 0) return gross;
  return Number(waiter.net_sales) || 0;
}

export function sortWaitersByMetric(waiters, metricId, desc = true) {
  const copy = [...(waiters || [])];
  copy.sort((a, b) => {
    const av = waiterSalesValue(a, metricId);
    const bv = waiterSalesValue(b, metricId);
    return desc ? bv - av : av - bv;
  });
  return copy;
}
