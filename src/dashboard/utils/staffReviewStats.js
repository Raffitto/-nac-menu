/** Aggregate per-staff review funnel from raw review_events rows */

import { staffNameForTracking } from "../../review/reviewGeneratorShared";
import {
  filterAnalyticsReviewEvents,
  filterProductionStaffList,
  isProductionStaff,
} from "./isProductionStaff";

const PAGE_OPEN_TYPES = new Set(["review_page_open", "review_open"]);
const GENERATED_TYPES = new Set(["review_generate", "review_regenerate"]);
const COPY_TYPES = new Set(["review_copy", "copy_review"]);
const GOOGLE_TYPES = new Set(["review_google_click", "google_redirect"]);

function dayKey(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function eventStaffName(e) {
  const raw = (e.employee_name || "").trim();
  if (!raw) return null;
  return staffNameForTracking(raw) || raw;
}

export function aggregateStaffReviewStats(events = []) {
  const map = {};
  filterAnalyticsReviewEvents(events).forEach((e) => {
    const name = eventStaffName(e);
    if (!name || !isProductionStaff(name)) return;
    const branch = (e.branch_id || "").toLowerCase();

    if (!map[name]) {
      map[name] = {
        name,
        role: e.employee_role || "",
        branch,
        scans: 0,
        review_opens: 0,
        generated: 0,
        copy: 0,
        google: 0,
      };
    }
    if (e.employee_role && !map[name].role) map[name].role = e.employee_role;
    if (branch && !map[name].branch) map[name].branch = branch;

    if (e.event_type === "qr_scan") {
      map[name].scans += 1;
    } else if (PAGE_OPEN_TYPES.has(e.event_type)) {
      map[name].review_opens += 1;
    }
    if (GENERATED_TYPES.has(e.event_type)) map[name].generated += 1;
    if (COPY_TYPES.has(e.event_type)) map[name].copy += 1;
    if (GOOGLE_TYPES.has(e.event_type)) map[name].google += 1;
  });

  return Object.values(map)
    .map((s) => ({
      ...s,
      opens: s.scans,
      conversion_pct: s.scans > 0 ? Math.round((s.google / s.scans) * 100) : 0,
    }))
    .sort((a, b) => b.scans - a.scans || b.google - a.google);
}

/** Staff stats from review_events only (no menu/RPC merge). */
export function mergeStaffStats(_rpcEmployees = [], granular = []) {
  return filterProductionStaffList(
    (granular || []).filter((g) => g.name && String(g.name).trim()),
  )
    .map((g) => ({
      ...g,
      opens: g.scans,
      conversion_pct:
        g.scans > 0 ? Math.round((g.google / g.scans) * 100) : 0,
    }))
    .sort((a, b) => b.scans - a.scans);
}

/** Daily review scan trend. */
export function buildDailyScanTrend(events = []) {
  const byDay = {};
  filterAnalyticsReviewEvents(events).forEach((e) => {
    if (e.event_type !== "qr_scan") return;
    const key = dayKey(e.created_at);
    if (!key) return;
    byDay[key] = (byDay[key] || 0) + 1;
  });
  return Object.entries(byDay)
    .map(([date, scans]) => ({ date, scans }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Branch-level scan totals from review events. */
export function buildBranchScanTotals(events = []) {
  const byBranch = {};
  filterAnalyticsReviewEvents(events).forEach((e) => {
    if (e.event_type !== "qr_scan") return;
    const b = (e.branch_id || "unknown").toLowerCase();
    byBranch[b] = (byBranch[b] || 0) + 1;
  });
  return Object.entries(byBranch)
    .map(([branch_id, scans]) => ({ branch_id, scans }))
    .sort((a, b) => b.scans - a.scans);
}

export function sumScans(events = []) {
  return filterAnalyticsReviewEvents(events).filter((e) => e.event_type === "qr_scan")
    .length;
}
