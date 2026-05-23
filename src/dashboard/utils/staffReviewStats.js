/** Aggregate per-staff review funnel from raw review_events rows */

import { staffNameForTracking } from "../../review/reviewGeneratorShared";
import {
  filterAnalyticsReviewEvents,
  filterProductionStaffList,
  isProductionStaff,
} from "./isProductionStaff";
import { normalizeBranchId } from "./branchIdentity";
import {
  REVIEW_PAGE_OPEN_TYPES,
  REVIEW_GENERATED_TYPES,
  REVIEW_GOOGLE_TYPES,
  reviewConversionPct,
} from "../../platform/engines/funnelAnalyticsEngine";

const COPY_TYPES = new Set(["review_copy", "copy_review"]);

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
    const branch = normalizeBranchId(e.branch_id);
    const key = `${branch || "unknown"}::${name}`;

    if (!map[key]) {
      map[key] = {
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
    if (e.employee_role && !map[key].role) map[key].role = e.employee_role;
    if (branch && !map[key].branch) map[key].branch = branch;

    if (e.event_type === "qr_scan") {
      map[key].scans += 1;
    } else if (REVIEW_PAGE_OPEN_TYPES.has(e.event_type)) {
      map[key].review_opens += 1;
    }
    if (REVIEW_GENERATED_TYPES.has(e.event_type)) map[key].generated += 1;
    if (COPY_TYPES.has(e.event_type)) map[key].copy += 1;
    if (REVIEW_GOOGLE_TYPES.has(e.event_type)) map[key].google += 1;
  });

  return Object.values(map)
    .map((s) => ({
      ...s,
      opens: s.scans,
      conversion_pct: reviewConversionPct(s.google, s.scans),
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
      conversion_pct: reviewConversionPct(g.google, g.scans),
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
    const b = normalizeBranchId(e.branch_id);
    if (!b) return;
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
