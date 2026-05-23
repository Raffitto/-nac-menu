import { formatHourBucketLabel, formatDayBucketLabel } from "./hourlyBucketLabels";

export const CATEGORY_NAMES = {
  brunch: "Brunch",
  daytime: "Daytime",
  breakfast: "Breakfast",
  evening: "Evening",
  desserts: "Desserts",
  drinks: "Drinks",
};

export function formatCategoryName(id) {
  return CATEGORY_NAMES[id] || id;
}

export function formatDuration(seconds) {
  const s = Number(seconds);
  if (!s || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  if (m > 0) return `${m}m ${rem}s`;
  return `${rem}s`;
}

export function formatPercent(value, total) {
  if (!total || total === 0) return "—";
  return `${Math.round((value / total) * 100)}%`;
}

export function formatHourLabel(iso, granularity = "hour") {
  return formatHourBucketLabel(iso, granularity);
}

export function formatDayLabel(iso) {
  return formatDayBucketLabel(iso);
}

export function pct(num, den) {
  if (!den || den === 0) return 0;
  return Math.round((num / den) * 100);
}

export function formatNumber(n) {
  const v = Number(n);
  if (!v && v !== 0) return "0";
  return v.toLocaleString();
}

export function exportCSV(filename, headers, rows) {
  const escape = (cell) => {
    const str = String(cell ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [
    headers.map(escape).join(","),
    ...rows.map((row) => row.map(escape).join(",")),
  ];
  const csv = lines.join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
