/** Operational recommendations from intelligence bundle */

export function buildRecommendations(intelligence, menuEngineering = []) {
  if (!intelligence) return { urgent: [], opportunities: [], risks: [], operations: [] };

  const urgent = [];
  const opportunities = [];
  const risks = [];
  const operations = [];

  (intelligence.friction || []).slice(0, 2).forEach((f) => {
    urgent.push({ title: f.title, action: f.action, impact: "high" });
  });

  (intelligence.offlineSellers || []).slice(0, 2).forEach((o) => {
    opportunities.push({
      title: `${o.item_name}: ${o.label}`,
      action: o.suggestion,
      impact: "medium",
    });
  });

  (intelligence.attention?.hiddenGems || []).slice(0, 2).forEach((h) => {
    opportunities.push({
      title: `Hidden gem: ${h.item_name}`,
      action: "Feature higher in menu — strong orders vs low views.",
      impact: "high",
    });
  });

  (intelligence.attention?.menuTraps || []).slice(0, 2).forEach((t) => {
    risks.push({
      title: `Menu trap: ${t.item_name}`,
      action: "High views, weak conversion — fix presentation or pricing.",
      impact: "high",
    });
  });

  menuEngineering.filter((m) => m.quadrant === "Puzzle").slice(0, 2).forEach((p) => {
    operations.push({ title: p.item_name, action: p.suggestion, quadrant: p.quadrant });
  });

  (intelligence.search?.insights || []).filter((i) => i.type === "unmet").slice(0, 1).forEach((s) => {
    operations.push({ title: "Search gap", action: s.message, quadrant: "search" });
  });

  return { urgent, opportunities, risks, operations };
}

export function buildManagementBriefing(intelligence, recommendations, forecasts) {
  return {
    strongest: (intelligence?.attention?.elite || []).slice(0, 3).map((e) => e.item_name),
    weakest: (intelligence?.attention?.menuTraps || []).slice(0, 3).map((t) => t.item_name),
    changed: forecasts?.narratives?.[0]?.message || "Trend analysis improves as more sessions are collected.",
    todayActions: recommendations?.urgent?.slice(0, 2).map((u) => u.action) || [],
    opportunities: recommendations?.opportunities?.slice(0, 2).map((o) => o.title) || [],
    risks: recommendations?.risks?.slice(0, 2).map((r) => r.title) || [],
    focus: recommendations?.urgent[0]?.title || recommendations?.opportunities[0]?.title || "Monitor conversion and search demand.",
  };
}
