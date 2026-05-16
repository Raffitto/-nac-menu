/** Category A/B/C/D grades from visibility + sales signals */

import { safePct } from "../utils/intelligenceSanity";

function gradeFromScore(score) {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 45) return "C";
  return "D";
}

const CATEGORY_LABELS = {
  breakfast: "Breakfast",
  brunch: "Brunch",
  daytime: "Daytime",
  evening: "Evening",
  desserts: "Desserts",
  drinks: "Drinks",
};

export function buildCategoryGrades(biData, funnels = [], searchIntel = null) {
  const topCats = biData?.top_categories || [];
  const deadZones = biData?.dead_zones || [];
  const dzMap = Object.fromEntries(
    (deadZones || []).map((d) => [d.category_id || d.category, d]),
  );

  const funnelsByCat = {};
  funnels.forEach((f) => {
    const cid = f.category_id;
    if (!cid) return;
    if (!funnelsByCat[cid]) funnelsByCat[cid] = [];
    funnelsByCat[cid].push(f);
  });

  return topCats.map((cat) => {
    const id = cat.id;
    const opens = Number(cat.opens) || 0;
    const impressions = Number(cat.impressions) || 0;
    const dz = dzMap[id];
    const eng = dz?.engagement_ratio != null
      ? Number(dz.engagement_ratio)
      : safePct(Number(dz?.item_opens) || 0, opens);

    const catFunnels = funnelsByCat[id] || [];
    const orders = catFunnels.reduce((s, f) => s + (f.orders || 0), 0);
    const net = catFunnels.reduce((s, f) => s + (f.net_sales || 0), 0);
    const deep = impressions > 0
      ? safePct(catFunnels.reduce((s, f) => s + (f.item_opens || 0), 0), impressions)
      : 0;

    const visibilityScore = Math.min(25, impressions * 0.08);
    const depthScore = Math.min(25, deep * 0.25);
    const salesScore = Math.min(30, orders * 2 + net / 500);
    const engagementScore = Math.min(20, eng * 0.2);

    const composite = Math.round(visibilityScore + depthScore + salesScore + engagementScore);
    const grade = gradeFromScore(composite);

    const sorted = [...catFunnels].sort((a, b) => (b.attention_score || 0) - (a.attention_score || 0));
    const strongest = sorted[0];
    const weakest = sorted[sorted.length - 1];

    let reason = `${CATEGORY_LABELS[id] || id}: ${impressions} impressions, ${opens} category opens.`;
    if (grade === "A") reason = "Strong visibility, engagement, and sales efficiency.";
    else if (grade === "D") reason = "Low item engagement or weak visibility-to-sales in this category.";

    let action = "Maintain placement and hero items.";
    if (grade === "C" || grade === "D") {
      action = "Improve first-screen items and reduce category drop-off.";
    }
    if (eng < 30 && opens >= 5) {
      action = "Guests open the category but rarely explore items — refresh hero placement.";
    }

    const searchBoost = searchIntel?.topSuccessful?.some((s) =>
      String(s.query).toLowerCase().includes(String(id).slice(0, 4)),
    );

    return {
      category_id: id,
      name: CATEGORY_LABELS[id] || id,
      grade,
      score: composite,
      reason,
      strongest_item: strongest?.item_name || "—",
      weakest_item: weakest?.item_name || "—",
      action,
      impressions,
      opens,
      deep_interest_rate: deep,
      orders,
      net_sales: net,
      engagement_ratio: eng,
      search_support: Boolean(searchBoost),
      confidence: impressions >= 50 || opens >= 20 ? "medium" : "low",
    };
  });
}
