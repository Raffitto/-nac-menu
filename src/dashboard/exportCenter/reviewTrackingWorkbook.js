import * as XLSX from "xlsx";
import { canonicalStaffName, isManagerRole, isWaiterRole } from "../config/staffRoles";
import { eachIsoDateInclusive } from "./dateRange";

function dayKey(value) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function aggregateReviewTrackingStats(entries = [], { from, to } = {}) {
  const byStaff = {};
  (entries || []).forEach((e) => {
    const name = canonicalStaffName(e.staff_name || e.source_staff_name);
    if (!name || isManagerRole(name) || !isWaiterRole(name)) return;
    const day = dayKey(e.review_date);
    if (!day) return;
    if (from && day < from) return;
    if (to && day > to) return;
    const count = Number(e.review_count);
    if (!Number.isFinite(count)) return;
    if (!byStaff[name]) byStaff[name] = { name, review_count: 0, google: 0 };
    byStaff[name].review_count += count;
    byStaff[name].google += count;
  });
  return Object.values(byStaff).sort((a, b) => b.review_count - a.review_count || a.name.localeCompare(b.name));
}

export function buildReviewTrackingGrid(entries = [], { from, to } = {}) {
  const dates = eachIsoDateInclusive(from, to);
  const byStaff = {};
  (entries || []).forEach((e) => {
    const name = canonicalStaffName(e.staff_name || e.source_staff_name);
    if (!name || isManagerRole(name) || !isWaiterRole(name)) return;
    const day = dayKey(e.review_date);
    if (!day || day < from || day > to) return;
    const count = Number(e.review_count);
    if (!Number.isFinite(count)) return;
    if (!byStaff[name]) byStaff[name] = {};
    byStaff[name][day] = (byStaff[name][day] || 0) + count;
  });

  const staff = Object.keys(byStaff).sort();
  const rows = staff.map((name) => {
    const cells = { staff: name };
    let total = 0;
    dates.forEach((d) => {
      const n = byStaff[name][d] || 0;
      cells[d] = n;
      total += n;
    });
    cells.total = total;
    return cells;
  });
  const dailyTotals = { staff: "TOTAL" };
  let grand = 0;
  dates.forEach((d) => {
    const n = rows.reduce((s, r) => s + (r[d] || 0), 0);
    dailyTotals[d] = n;
    grand += n;
  });
  dailyTotals.total = grand;
  return { dates, rows, dailyTotals };
}

export function buildReviewTrackingWorkbookBuffer(entries, { from, to, branch = "khobar" } = {}) {
  const grid = buildReviewTrackingGrid(entries, { from, to });
  const header = ["Staff", ...grid.dates, "Period total"];
  const aoa = [
    [`NAC ${branch} Review Tracking`, from, to],
    ["Source: Google Drive 2026 review tracking"],
    header,
    ...grid.rows.map((r) => [r.staff, ...grid.dates.map((d) => r[d]), r.total]),
    [grid.dailyTotals.staff, ...grid.dates.map((d) => grid.dailyTotals[d]), grid.dailyTotals.total],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Review Tracking");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}
