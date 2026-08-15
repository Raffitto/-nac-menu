/**
 * Canonical Cash Up authority used by Ask NAC commercial.sales:
 * ask_nac_structured_facts / report_type=cash_up / metric_key=net_sales
 * (same store as getVaultFacts + get_vault_cash_up_range_aggregate).
 */

export const CANONICAL_CASH_UP = {
  table: "ask_nac_structured_facts",
  reportType: "cash_up",
  metricKey: "net_sales",
  rpc: "get_vault_cash_up_range_aggregate",
  definition: "Management headline net sales, typically ex-VAT.",
} as const;

export function pickDailyCashUpNetSales(rows: Array<{ period_start?: string; periodStart?: string; metric_value?: number | string; metricValue?: number | string }>): Map<string, number> {
  const byDate = new Map<string, number[]>();
  for (const row of rows) {
    const date = String(row.period_start || row.periodStart || "").slice(0, 10);
    const value = Number(row.metric_value ?? row.metricValue);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value)) continue;
    const list = byDate.get(date) || [];
    list.push(value);
    byDate.set(date, list);
  }
  const out = new Map<string, number>();
  for (const [date, values] of byDate) {
    const unique = [...new Set(values.map((v) => Number(v.toFixed(5))))];
    out.set(date, unique.sort((a, b) => Math.abs(b) - Math.abs(a))[0]);
  }
  return out;
}
