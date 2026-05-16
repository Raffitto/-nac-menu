/** Shared admin intelligence range: today | 7d | 30d → RPC p_hours */

export const DEFAULT_RANGE = "today";

export const RANGE_OPTIONS = [
  { id: "today", label: "Today", hours: 24, title: "NAC business day · 3:00 AM – 2:59 AM (Asia/Riyadh)" },
  { id: "7d", label: "7D", hours: 168, title: "Last 7 business-day windows" },
  { id: "30d", label: "30D", hours: 720, title: "Last 30 business-day windows" },
];

export function rangeToHours(range) {
  const match = RANGE_OPTIONS.find((o) => o.id === range);
  return match?.hours ?? 24;
}

export function hoursToRange(hours) {
  const h = Number(hours);
  if (h === 168) return "7d";
  if (h === 720) return "30d";
  return "today";
}

export function rangeExportLabel(range) {
  const match = RANGE_OPTIONS.find((o) => o.id === range);
  return match?.label ?? "Today";
}

export function branchDisplayName(branch) {
  const b = (branch || "khobar").toString().toLowerCase();
  return b.charAt(0).toUpperCase() + b.slice(1);
}

export function defaultBranchId() {
  return (process.env.REACT_APP_NAC_BRANCH_ID || "khobar").toLowerCase();
}
