/** Menu placement intelligence from impression metadata */

export function buildPlacementIntelligence(biData) {
  const placementStats = biData?.placement_stats || [];
  const byEvent = biData?.by_event_type || {};
  const impressions = Number(byEvent.item_impression) || 0;

  if (!impressions && !placementStats.length) {
    return {
      ready: false,
      message: "Placement tracking is warming up — impression metadata will sharpen screen-position insights.",
      insights: [],
      byPosition: [],
    };
  }

  const byPosition = placementStats.map((p) => ({
    position: p.position || "unknown",
    impressions: Number(p.impressions) || 0,
    share_pct: impressions > 0
      ? Math.round((Number(p.impressions) / impressions) * 100)
      : 0,
  }));

  const insights = [];
  const top = byPosition.find((p) => p.position === "top");
  const lower = byPosition.find((p) => p.position === "lower");

  if (top && top.share_pct >= 35) {
    insights.push({
      type: "early_visibility",
      message: "Items appearing early on screen receive stronger visibility — top placement drives impressions.",
      confidence: top.impressions >= 30 ? "medium" : "low",
    });
  }

  if (lower && lower.share_pct >= 15 && lower.impressions >= 10) {
    insights.push({
      type: "lower_screen",
      message: "Lower-screen items receive meaningful views but may need hero promotion if sales lag.",
      confidence: "low",
    });
  }

  const totalImp = impressions || byPosition.reduce((s, p) => s + p.impressions, 0);
  if (totalImp < 50) {
    insights.push({
      type: "early",
      message: "Early signal — collect more placement-tagged impressions before repositioning categories.",
      confidence: "low",
    });
  }

  return {
    ready: totalImp >= 20,
    byPosition,
    insights,
    totalImpressions: totalImp,
  };
}
