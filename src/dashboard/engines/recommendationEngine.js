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
      title: `Hidden opportunity: ${h.item_name}`,
      action: "Elevate placement — strong sales relative to visibility.",
      impact: "high",
    });
  });

  (intelligence.attention?.menuTraps || []).slice(0, 2).forEach((t) => {
    risks.push({
      title: `${t.item_name}: attention without sales`,
      action: "Review pricing, photo, and description — high visibility, weak conversion.",
      impact: "high",
    });
  });

  menuEngineering.filter((m) => m.quadrant === "Puzzle").slice(0, 2).forEach((p) => {
    operations.push({ title: p.item_name, action: p.suggestion, quadrant: p.quadrant });
  });

  (intelligence.search?.insights || []).filter((i) => i.type === "unmet").slice(0, 1).forEach((s) => {
    operations.push({
      title: "Search friction",
      action: "Guests search for terms with weak results — add Arabic/English synonyms to improve discovery.",
      quadrant: "search",
    });
  });

  return { urgent, opportunities, risks, operations };
}

export function buildManagementBriefing(intelligence, recommendations, forecasts) {
  const working = (intelligence?.attention?.elite || []).slice(0, 3).map((e) => e.item_name);
  if (!working.length && intelligence?.funnels?.length) {
    intelligence.funnels
      .filter((f) => f.behavior_type === "Visual Seller" || f.behavior_type === "Discovery Seller")
      .slice(0, 2)
      .forEach((f) => working.push(f.item_name));
  }

  const weakest = (intelligence?.attention?.menuTraps || []).slice(0, 3).map((t) => t.item_name);
  if (!weakest.length) {
    (intelligence?.funnels || [])
      .filter((f) => f.behavior_type === "Menu Trap")
      .slice(0, 2)
      .forEach((f) => weakest.push(f.item_name));
  }

  return {
    strongest: working,
    weakest,
    working,
    needsAttention: weakest,
    changed: forecasts?.narratives?.[0]?.message || "Patterns will clarify as more guest sessions are collected.",
    todayActions: recommendations?.urgent?.slice(0, 2).map((u) => u.action) || [],
    monitor: [
      ...(recommendations?.opportunities?.slice(0, 1).map((o) => o.title) || []),
      "Impression trends and Foodics batch comparison",
    ],
    opportunities: recommendations?.opportunities?.slice(0, 2).map((o) => o.title) || [],
    risks: recommendations?.risks?.slice(0, 2).map((r) => r.title) || [],
    focus:
      recommendations?.urgent[0]?.action ||
      recommendations?.opportunities[0]?.title ||
      "Monitor guest attention and sales alignment.",
  };
}
