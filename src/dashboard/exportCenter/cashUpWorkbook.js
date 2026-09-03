import * as XLSX from "xlsx";
import { eachIsoDateInclusive } from "./dateRange";

const COLUMNS = [
  { key: "date", label: "Date" },
  { key: "total_sales", label: "Total Sales" },
  { key: "net_sales", label: "Net Total Sales" },
  { key: "guest_count", label: "Number of Guests" },
  { key: "order_count", label: "Order Count" },
  { key: "avg_per_guest", label: "Average per Guest" },
  { key: "visa", label: "Visa" },
  { key: "cash", label: "Cash" },
  { key: "mastercard", label: "Mastercard" },
  { key: "mada", label: "Mada" },
  { key: "amex", label: "Amex" },
  { key: "gcc_net", label: "GCC-Net" },
  { key: "ccm", label: "CCM Sales" },
  { key: "jahez", label: "Jahez" },
  { key: "chefz", label: "Chefz" },
  { key: "keeta", label: "Keeta" },
  { key: "hunger", label: "Hunger" },
  { key: "owners_on_account", label: "Owners / On Account" },
  { key: "tips", label: "Tips" },
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
  { key: "discount_comp", label: "Discount / Comp" },
  { key: "void_count", label: "Void Count" },
  { key: "void_waste", label: "Void Waste" },
];

function factValue(facts, date, key) {
  const row = (facts || []).find((f) => {
    if (String(f.period_end).slice(0, 10) !== date) return false;
    if (f.metric_key === key) return true;
    if (f.metric_key === "payment_method" && (f.dimensions?.method || f.dimensions?.payment_method) === key) {
      return true;
    }
    return false;
  });
  return row == null ? "" : Number(row.metric_value);
}

export function buildCashUpRows(facts, from, to) {
  return eachIsoDateInclusive(from, to).map((date) => {
    const out = { date };
    COLUMNS.slice(1).forEach((col) => {
      const v = factValue(facts, date, col.key);
      out[col.key] = v === "" || v == null || Number.isNaN(v) ? "" : v;
    });
    if (out.avg_per_guest === "" && out.net_sales && out.guest_count) {
      out.avg_per_guest = Math.round((Number(out.net_sales) / Number(out.guest_count)) * 100) / 100;
    }
    return out;
  });
}

export function buildCashUpWorkbookBuffer(facts, { from, to, branch = "khobar" } = {}) {
  const rows = buildCashUpRows(facts, from, to);
  const present = rows.filter((r) => r.total_sales !== "" || r.net_sales !== "");
  const totals = COLUMNS.slice(1).reduce((acc, col) => {
    const sum = present.reduce((s, r) => s + (Number(r[col.key]) || 0), 0);
    acc[col.key] = ["avg_per_guest"].includes(col.key)
      ? (present.length ? Math.round((sum / present.length) * 100) / 100 : "")
      : present.length
        ? Math.round(sum * 100) / 100
        : "";
    return acc;
  }, { date: "TOTAL" });
  const averages = COLUMNS.slice(1).reduce((acc, col) => {
    const vals = present.map((r) => Number(r[col.key])).filter((n) => Number.isFinite(n) && n !== 0);
    acc[col.key] = vals.length ? Math.round((vals.reduce((s, n) => s + n, 0) / present.length) * 100) / 100 : "";
    return acc;
  }, { date: "DAILY AVERAGE" });

  const target = (facts || []).find((f) => f.metric_key === "target_sales");
  const aoa = [
    [`NAC ${branch} Cash Up`, from, to],
    target ? ["Target / Budget", Number(target.metric_value)] : ["Target / Budget", ""],
    [],
    COLUMNS.map((c) => c.label),
    ...rows.map((r) => COLUMNS.map((c) => r[c.key])),
    COLUMNS.map((c) => totals[c.key]),
    COLUMNS.map((c) => averages[c.key]),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Cash Up");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}
