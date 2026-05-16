/** Aggregate per-staff review funnel from raw review_events rows */

export function aggregateStaffReviewStats(events = [], branchId = "") {
  const map = {};
  (events || []).forEach((e) => {
    const name = (e.employee_name || "").trim() || "Unknown";
    if (!map[name]) {
      map[name] = {
        name,
        role: e.employee_role || "",
        branch: branchId,
        opens: 0,
        generated: 0,
        copy: 0,
        google: 0,
      };
    }
    if (e.employee_role && !map[name].role) map[name].role = e.employee_role;
    switch (e.event_type) {
      case "review_page_open":
        map[name].opens += 1;
        break;
      case "review_generate":
      case "review_regenerate":
        map[name].generated += 1;
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
      conversion_pct: s.generated > 0 ? Math.round((s.google / s.generated) * 100) : 0,
    }))
    .sort((a, b) => b.generated - a.generated || b.opens - a.opens);
}

/** Merge RPC top_employees with granular stats when available */
export function mergeStaffStats(rpcEmployees = [], granular = []) {
  if (!granular.length) return rpcEmployees;
  const byName = Object.fromEntries(granular.map((g) => [g.name, g]));
  return granular.length
    ? granular
    : (rpcEmployees || []).map((e) => ({
        name: e.name,
        role: e.role || "",
        opens: e.opens ?? 0,
        generated: e.generated ?? 0,
        copy: byName[e.name]?.copy ?? 0,
        google: e.google_clicks ?? 0,
        conversion_pct: e.conversion_pct ?? 0,
      }));
}
