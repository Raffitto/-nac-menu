import { DEFAULT_WAITER_SALES_METRIC } from "../utils/waiterSalesMetric";

const KEY = "nac_waiter_sales_metric";

export function loadWaiterSalesMetric() {
  try {
    const v = localStorage.getItem(KEY);
    return v === "net" ? "net" : DEFAULT_WAITER_SALES_METRIC;
  } catch {
    return DEFAULT_WAITER_SALES_METRIC;
  }
}

export function saveWaiterSalesMetric(metricId) {
  try {
    localStorage.setItem(KEY, metricId === "net" ? "net" : "gross");
  } catch {
    /* ignore */
  }
}
