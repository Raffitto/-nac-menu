/** Normalize get_bi_dashboard top_items for visibility-first analytics */

import { computeAttentionScore } from "./intelligenceSanity";

export function normalizeTopItems(topItems = []) {
  return (topItems || []).map((t) => {
    const impressions = Number(t.impressions) || 0;
    const opens = Number(t.opens) || 0;
    const impression_sessions = Number(t.impression_sessions) || 0;
    const visible_duration_ms = Number(t.visible_duration_ms) || 0;
    const deep_interest_rate =
      t.deep_interest_rate != null
        ? Number(t.deep_interest_rate)
        : impressions > 0
          ? Math.round((opens / impressions) * 1000) / 10
          : null;
    const avg_visible_duration_ms =
      Number(t.avg_visible_duration_ms) ||
      (impression_sessions > 0 ? Math.round(visible_duration_ms / impression_sessions) : 0);

    const attention = computeAttentionScore({
      impressions,
      modalOpens: opens,
      orders: 0,
      visibleDurationMs: visible_duration_ms,
      impressionSessions: impression_sessions,
      avgVisibleDurationMs: avg_visible_duration_ms,
    });

    return {
      ...t,
      name: t.name,
      impressions,
      opens,
      impression_sessions,
      visible_duration_ms,
      deep_interest_rate,
      avg_visible_duration_ms,
      visibility: impressions > 0 ? impressions : opens,
      hasImpressionData: impressions > 0,
      attention_score: t.attention_score ?? attention.score,
    };
  });
}
