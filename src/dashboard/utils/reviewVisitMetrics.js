/** QR visit cohorts within the supplied period. Sessions are not unique humans.
 * A visit requires a QR scan, a namespaced session ID, branch and employee.
 * Only later redirects in the same period and identity can convert that visit.
 * Orphan redirects remain diagnostic events; no timestamp-based identity guessing.
 */
import { filterAnalyticsReviewEvents } from './isProductionStaff';
import { normalizeReviewBranchId } from '../../review/reviewBranchIdentity';
import { REVIEW_GOOGLE_TYPES, visitConversionPct } from './reviewFunnelMetrics';

export { visitConversionPct } from "./reviewFunnelMetrics";
export function formatVisitPct(value) {
  return value == null || !Number.isFinite(Number(value)) ? 'N/A' : `${value}%`;
}

export function reviewVisitMetrics(events = []) {
  const ids = new Set();
  const rows = filterAnalyticsReviewEvents(events).filter(e => {
    if (!e.id) return true;
    if (ids.has(e.id)) return false;
    ids.add(e.id); return true;
  });
  const key = e => {
    const branch = normalizeReviewBranchId(e.branch_id);
    const review = String(e.review_session_id || '').trim();
    const menu = String(e.session_id || '').trim();
    const session = review ? `review:${review}` : menu ? `menu:${menu}` : null;
    return branch && session ? JSON.stringify([branch, String(e.employee_name || '').trim().toLowerCase(), session]) : null;
  };
  const starts = new Map(), converted = new Set();
  let unidentifiable_scans = 0, unmatched_redirects = 0;
  for (const e of rows) {
    if (e.event_type !== 'qr_scan') continue;
    const k = key(e), time = Date.parse(e.created_at);
    if (!k || !Number.isFinite(time)) { unidentifiable_scans++; continue; }
    starts.set(k, Math.min(starts.get(k) ?? Infinity, time));
  }
  for (const e of rows) {
    if (!REVIEW_GOOGLE_TYPES.has(e.event_type)) continue;
    const k = key(e), start = starts.get(k), time = Date.parse(e.created_at);
    if (start != null && Number.isFinite(time) && time >= start) converted.add(k);
    else unmatched_redirects++;
  }
  const qr_visits = starts.size, converted_visits = converted.size;
  return { qr_visits, converted_visits, unidentifiable_scans, unmatched_redirects,
    visit_start_times: [...starts.values()],
    raw_qr_scans: rows.filter(e => e.event_type === 'qr_scan').length,
    raw_google_redirects: rows.filter(e => REVIEW_GOOGLE_TYPES.has(e.event_type)).length,
    conversion_pct: visitConversionPct(converted_visits, qr_visits, unidentifiable_scans) };
}

/** Adapt explicit visit fields; legacy summaries cannot establish conversion. */
export function visitsFromSummary(row = {}) {
  return {
    qr_visits: row.qr_visits ?? null,
    converted_visits: row.converted_visits ?? null,
    raw_qr_scans: row.raw_qr_scans ?? row.raw_scans ?? row.qr_scans ?? row.scans ?? 0,
    raw_google_redirects: row.raw_google_redirects ?? row.raw_google ?? row.google_redirects ?? row.google ?? 0,
    unidentifiable_scans: row.unidentifiable_scans ?? 0,
    unmatched_redirects: row.unmatched_redirects ?? 0,
    conversion_pct: visitConversionPct(row.converted_visits, row.qr_visits, row.unidentifiable_scans),
  };
}
