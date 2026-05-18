/** Aggregate per-staff review funnel from raw review_events rows */

const SCAN_TYPES = new Set(["qr_scan", "review_page_open", "review_open"]);
const GENERATED_TYPES = new Set(["review_generate", "review_regenerate"]);
const COPY_TYPES = new Set(["review_copy", "copy_review"]);
const GOOGLE_TYPES = new Set(["review_google_click", "google_redirect"]);

function dayKey(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function hasStaffName(e) {
  return Boolean((e.employee_name || "").trim());
}

export function aggregateStaffReviewStats(events = []) {
  const map = {};
  (events || []).forEach((e) => {
    if (!hasStaffName(e)) return;

    const name = e.employee_name.trim();
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
    } else if (e.event_type === "review_page_open" || e.event_type === "review_open") {
      map[name].review_opens += 1;
      map[name].scans += 1;
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

/** Merge RPC top_employees with granular client stats (dynamic names from data). */
export function mergeStaffStats(rpcEmployees = [], granular = []) {
  const names = new Set(granular.map((g) => g.name));
  (rpcEmployees || []).forEach((e) => {
    if ((e.name || "").trim()) names.add(e.name.trim());
  });
  if (!names.size) return [];

  const granByName = Object.fromEntries(granular.map((g) => [g.name, g]));
  const rpcByName = Object.fromEntries(
    (rpcEmployees || []).map((e) => [e.name, e]).filter(([n]) => (n || "").trim()),
  );

  return [...names]
    .filter((name) => name && name.trim())
    .map((name) => {
      const g = granByName[name];
      const r = rpcByName[name];
      const scans = g?.scans ?? r?.opens ?? 0;
      const review_opens = g?.review_opens ?? 0;
      const google = g?.google ?? r?.google_clicks ?? 0;
      const copy = g?.copy ?? 0;
      const generated = g?.generated ?? r?.generated ?? 0;
      return {
        name,
        role: g?.role || r?.role || "",
        branch: g?.branch || "",
        scans,
        opens: scans,
        review_opens,
        generated,
        copy,
        google,
        conversion_pct: scans > 0 ? Math.round((google / scans) * 100) : r?.conversion_pct ?? 0,
      };
    })
    .sort((a, b) => b.scans - a.scans);
}

/** Daily review scan trend. */
export function buildDailyScanTrend(events = []) {
  const byDay = {};
  (events || []).forEach((e) => {
    if (!SCAN_TYPES.has(e.event_type)) return;
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
  (events || []).forEach((e) => {
    if (!SCAN_TYPES.has(e.event_type)) return;
    const b = (e.branch_id || "unknown").toLowerCase();
    byBranch[b] = (byBranch[b] || 0) + 1;
  });
  return Object.entries(byBranch)
    .map(([branch_id, scans]) => ({ branch_id, scans }))
    .sort((a, b) => b.scans - a.scans);
}

export function sumScans(events = []) {
  return (events || []).filter((e) => SCAN_TYPES.has(e.event_type)).length;
}
