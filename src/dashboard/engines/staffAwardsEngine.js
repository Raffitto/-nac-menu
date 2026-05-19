import { computeOperationalScore } from "./staffOperationalEngine";

function topBy(list, key, filter = () => true) {
  const eligible = list.filter(filter);
  if (!eligible.length) return null;
  return [...eligible].sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0))[0];
}

function topByFn(list, fn, filter = () => true) {
  const eligible = list.filter(filter);
  if (!eligible.length) return null;
  return [...eligible].sort((a, b) => fn(b) - fn(a))[0];
}

/**
 * KPI awards + operational scores for executive staff intelligence.
 */
export function buildStaffAwards(waiters = [], team = {}) {
  const list = waiters.filter((w) => w.role === "waiter" || !w.role);
  const withScores = list.map((w) => ({
    ...w,
    operationalScore: computeOperationalScore(w, team),
  }));

  const awards = [
    {
      id: "top_revenue",
      label: "Top gross sales",
      winner: topBy(withScores, "gross_sales")?.waiter,
      value: topBy(withScores, "gross_sales")?.gross_sales,
      format: "sar",
    },
    {
      id: "avg_ticket",
      label: "Highest avg ticket",
      winner: topBy(withScores, "avgCheck")?.waiter,
      value: topBy(withScores, "avgCheck")?.avgCheck,
      format: "sar",
    },
    {
      id: "modifier",
      label: "Best modifier attachment",
      winner: topBy(withScores, "modifierAttachPct")?.waiter,
      value: topBy(withScores, "modifierAttachPct")?.modifierAttachPct,
      format: "pct",
    },
    {
      id: "premium_bev",
      label: "Strongest premium beverage mix",
      winner: topByFn(withScores, (w) => w.ops?.premiumBevPct || 0, (w) => (w.ops?.bevGross || 0) > 0)?.waiter,
      value: topByFn(withScores, (w) => w.ops?.premiumBevPct || 0)?.ops?.premiumBevPct,
      format: "pct",
    },
    {
      id: "breakfast",
      label: "Best breakfast seller",
      winner: topByFn(withScores, (w) => w.ops?.breakfastGross || 0)?.waiter,
      value: topByFn(withScores, (w) => w.ops?.breakfastGross || 0)?.ops?.breakfastGross,
      format: "sar",
    },
    {
      id: "pm",
      label: "Strongest PM / dessert profile",
      winner: topBy(withScores, "dessertAttachPct")?.waiter,
      value: topBy(withScores, "dessertAttachPct")?.dessertAttachPct,
      format: "pct",
    },
    {
      id: "mocktail",
      label: "Strongest mocktail / premium drink",
      winner: topByFn(withScores, (w) => w.ops?.mocktailGross || 0)?.waiter,
      value: topByFn(withScores, (w) => w.ops?.mocktailGross || 0)?.ops?.mocktailGross,
      format: "sar",
    },
    {
      id: "dessert",
      label: "Strongest dessert seller",
      winner: topBy(withScores, "dessertAttachPct")?.waiter,
      value: topBy(withScores, "dessertAttachPct")?.dessertAttachPct,
      format: "pct",
    },
    {
      id: "balanced",
      label: "Most balanced performer",
      winner: topByFn(
        withScores,
        (w) => w.operationalScore,
        (w) => w.modifierAttachPct >= 10 && (w.ops?.premiumBevPct || 0) >= 10,
      )?.waiter,
      value: topByFn(withScores, (w) => w.operationalScore)?.operationalScore,
      format: "score",
    },
    {
      id: "efficiency",
      label: "Most efficient (score vs volume)",
      winner: topByFn(withScores, (w) => w.operationalScore, (w) => w.quantity >= 400)?.waiter,
      value: topByFn(withScores, (w) => w.operationalScore, (w) => w.quantity >= 400)?.operationalScore,
      format: "score",
    },
    {
      id: "hidden",
      label: "Hidden opportunity",
      winner: topByFn(
        withScores,
        (w) => w.quantity,
        (w) => w.modifierAttachPct < 12 && w.quantity >= 450,
      )?.waiter,
      value: topByFn(withScores, (w) => w.modifierAttachPct, (w) => w.modifierAttachPct < 12)?.modifierAttachPct,
      format: "pct",
    },
  ].filter((a) => a.winner);

  const ranked = [...withScores].sort((a, b) => b.operationalScore - a.operationalScore);

  return {
    awards,
    ranked,
    topOperational: ranked[0] || null,
  };
}
