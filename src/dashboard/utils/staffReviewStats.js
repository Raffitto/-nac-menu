/** Aggregate per-staff review funnel from raw review_events rows */

function dayKey(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function aggregateStaffReviewStats(events = [], branchId = "") {
  const map = {};
  (events || []).forEach((e) => {
    const name = (e.employee_name || "").trim() || "Unknown";
    if (!map[name]) {
      map[name] = {
        name,
        role: e.employee_role || "",
        branch: branchId,
        scans: 0,
        review_opens: 0,
        generated: 0,
        copy: 0,
        google: 0,
      };
    }
    if (e.employee_role && !map[name].role) map[name].role = e.employee_role;
    switch (e.event_type) {
      case "review_page_open":
        map[name].scans += 1;
        break;
      case "review_generate":
      case "review_regenerate":
        map[name].generated += 1;
        map[name].review_opens += 1;
        break;
      case "review_copy":
        map[name].copy += 1;
        break;
      case "review_google_click":
        map[name].google += 1;
        break;
      default:
        break;
    }
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
  const names = new Set([
    ...granular.map((g) => g.name),
    ...(rpcEmployees || []).map((e) => e.name),
  ]);
  if (!names.size) return [];

  const granByName = Object.fromEntries(granular.map((g) => [g.name, g]));
  const rpcByName = Object.fromEntries((rpcEmployees || []).map((e) => [e.name, e]));

  return [...names]
    .map((name) => {
      const g = granByName[name];
      const r = rpcByName[name];
      const scans = g?.scans ?? r?.opens ?? 0;
      const review_opens = g?.review_opens ?? r?.generated ?? 0;
      const google = g?.google ?? r?.google_clicks ?? 0;
      const copy = g?.copy ?? 0;
      const generated = g?.generated ?? r?.generated ?? 0;
      return {
        name,
        role: g?.role || r?.role || "",
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

/** Daily review scan trend (review_page_open). */
export function buildDailyScanTrend(events = []) {
  const byDay = {};
  (events || []).forEach((e) => {
    if (e.event_type !== "review_page_open") return;
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
    if (e.event_type !== "review_page_open") return;
    const b = (e.branch_id || "unknown").toLowerCase();
    byBranch[b] = (byBranch[b] || 0) + 1;
  });
  return Object.entries(byBranch)
    .map(([branch_id, scans]) => ({ branch_id, scans }))
    .sort((a, b) => b.scans - a.scans);
}

export function sumScans(events = []) {
  return (events || []).filter((e) => e.event_type === "review_page_open").length;
}
