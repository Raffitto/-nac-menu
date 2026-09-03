import * as XLSX from "xlsx";
import { canonicalStaffName, isManagerRole, isWaiterRole } from "../config/staffRoles";
import { eachIsoDateInclusive } from "./dateRange";

function dayKey(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function buildReviewTrackingGrid(events = [], { from, to } = {}) {
  const dates = eachIsoDateInclusive(from, to);
  const byStaff = {};
  (events || []).forEach((e) => {
    const type = String(e.event_type || "");
    if (!/google/i.test(type)) return;
    const name = canonicalStaffName(e.employee_name);
    if (!name || isManagerRole(name) || !isWaiterRole(name)) return;
    const day = dayKey(e.created_at || e.occurred_at || e.event_at);
    if (!day || day < from || day > to) return;
    if (!byStaff[name]) byStaff[name] = {};
    byStaff[name][day] = (byStaff[name][day] || 0) + 1;
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

export function buildReviewTrackingWorkbookBuffer(events, { from, to, branch = "khobar" } = {}) {
  const grid = buildReviewTrackingGrid(events, { from, to });
  const header = ["Staff", ...grid.dates, "Period total"];
  const aoa = [
    [`NAC ${branch} Review Tracking`, from, to],
    [],
    header,
    ...grid.rows.map((r) => [r.staff, ...grid.dates.map((d) => r[d]), r.total]),
    [grid.dailyTotals.staff, ...grid.dates.map((d) => grid.dailyTotals[d]), grid.dailyTotals.total],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Review Tracking");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}
