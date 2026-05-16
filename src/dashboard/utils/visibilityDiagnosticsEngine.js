/** Validate live visibility traffic quality */

import { normalizeTopItems } from "./topItemsNormalize";

export function buildVisibilityDiagnostics(biData) {
  const byType = biData?.by_event_type || {};
  const impressions = Number(byType.item_impression) || 0;
  const impressionEnds = Number(byType.item_impression_end) || 0;
  const opens = Number(byType.item_open) || 0;

  const topItems = normalizeTopItems(biData?.top_items || []);
  const totalDuration = topItems.reduce((s, t) => s + (t.visible_duration_ms || 0), 0);
  const avgDuration = impressionEnds > 0 ? Math.round(totalDuration / impressionEnds) : 0;
  const openRatio = impressions > 0 ? Math.round((opens / impressions) * 100) : null;

  const noDuration = topItems.filter(
    (t) => t.impressions >= 5 && (!t.visible_duration_ms || t.visible_duration_ms === 0),
  );
  const opensNoImp = topItems.filter((t) => t.opens >= 3 && t.impressions === 0);
  const suspiciousDuration = topItems.filter((t) => {
    const avg = t.impression_sessions > 0 ? t.visible_duration_ms / t.impression_sessions : 0;
    return avg > 120000;
  });

  const mobileDesktop = biData?.placement_stats || [];
  const duplicateEstimate = impressions > 0
    ? Math.max(0, impressions - impressionEnds - Math.round(impressions * 0.05))
    : 0;

  const checks = [
    { label: "item_impression events", value: impressions, ok: impressions > 0 },
    { label: "item_impression_end events", value: impressionEnds, ok: impressionEnds > 0 },
    { label: "Impression → open ratio", value: openRatio != null ? `${openRatio}%` : "—", ok: openRatio == null || openRatio < 80 },
    { label: "Avg visible duration", value: avgDuration ? `${avgDuration} ms` : "—", ok: avgDuration > 0 && avgDuration < 60000 },
    { label: "Items: impressions, no duration", value: noDuration.length, ok: noDuration.length <= 3 },
    { label: "Items: opens, no impressions", value: opensNoImp.length, ok: opensNoImp.length <= 5 },
    { label: "Suspicious long durations", value: suspiciousDuration.length, ok: suspiciousDuration.length === 0 },
  ];

  const health =
    checks.filter((c) => c.ok).length >= checks.length - 2 ? "healthy" : "needs_review";

  return {
    health,
    checks,
    impressions,
    impressionEnds,
    openRatio,
    avgDuration,
    duplicateEstimate,
    noDuration: noDuration.slice(0, 5).map((t) => t.name),
    opensNoImp: opensNoImp.slice(0, 5).map((t) => t.name),
    suspiciousDuration: suspiciousDuration.slice(0, 5).map((t) => t.name),
    placementBreakdown: mobileDesktop,
  };
}
