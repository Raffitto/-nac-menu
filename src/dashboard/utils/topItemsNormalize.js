/** Normalize get_bi_dashboard top_items for visibility-first analytics */

export function normalizeTopItems(topItems = []) {
  return (topItems || []).map((t) => {
    const impressions = Number(t.impressions) || 0;
    const opens = Number(t.opens) || 0;
    return {
      ...t,
      name: t.name,
      impressions,
      opens,
      impression_sessions: Number(t.impression_sessions) || 0,
      visible_duration_ms: Number(t.visible_duration_ms) || 0,
      visibility: impressions > 0 ? impressions : opens,
    };
  });
}
