import { computeFoodicsWaiterScore } from "./foodicsWaiterScoreEngine";
import { isLowValueBeverageDominant, isPremiumBeverageMeaningful } from "./intelligenceCalibration";

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
 * KPI awards — calibrated to avoid celebrating low-margin inflation.
 */
export function buildStaffAwards(waiters = [], team = {}) {
  const list = waiters.filter((w) => w.role === "waiter" || !w.role);
  const withScores = list.map((w) => ({
    ...w,
    operationalScore: computeFoodicsWaiterScore(w, team),
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
      id: "revenue_quality",
      label: "Best revenue quality",
      winner: topByFn(withScores, (w) => w.revenueQualityScore || 0, (w) => (w.revenueQualityScore || 0) >= 48)?.waiter,
      value: topByFn(withScores, (w) => w.revenueQualityScore || 0)?.revenueQualityScore,
      format: "score",
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
      winner: topBy(withScores, "modifierAttachPct", (w) => (w.confidence?.modifier || "moderate") !== "low_sample")?.waiter,
      value: topBy(withScores, "modifierAttachPct")?.modifierAttachPct,
      format: "pct",
    },
    {
      id: "premium_bev",
      label: "Strongest premium beverage mix",
      winner: topByFn(
        withScores,
        (w) => w.ops?.premiumBevPct || 0,
        (w) => (w.ops?.bevGross || 0) > 400 && !isLowValueBeverageDominant(w) && isPremiumBeverageMeaningful(w),
      )?.waiter,
      value: topByFn(
        withScores,
        (w) => w.ops?.premiumBevPct || 0,
        (w) => !isLowValueBeverageDominant(w),
      )?.ops?.premiumBevPct,
      format: "pct",
    },
    {
      id: "breakfast",
      label: "Breakfast gross leader",
      winner: topByFn(
        withScores,
        (w) => w.ops?.breakfastGross || 0,
        (w) => !w.calibration?.shouldNotCelebrateBreakfast || (w.ops?.premiumBevPct || 0) >= 18,
      )?.waiter,
      value: topByFn(withScores, (w) => w.ops?.breakfastGross || 0)?.ops?.breakfastGross,
      format: "sar",
    },
    {
      id: "pm",
      label: "Strongest PM / dessert profile",
      winner: topBy(withScores, "dessertAttachPct", (w) => w.calibration?.pmExpected || (w.ops?.dessertPct || 0) >= 10)?.waiter,
      value: topBy(withScores, "dessertAttachPct")?.dessertAttachPct,
      format: "pct",
    },
    {
      id: "mocktail",
      label: "Strongest mocktail / premium drink",
      winner: topByFn(withScores, (w) => w.ops?.mocktailGross || 0, (w) => (w.ops?.mocktailGross || 0) >= 400)?.waiter,
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
        (w) =>
          w.modifierAttachPct >= 10 &&
          (w.ops?.premiumBevPct || 0) >= 12 &&
          !isLowValueBeverageDominant(w) &&
          (w.revenueQualityScore || 0) >= 50,
      )?.waiter,
      value: topByFn(withScores, (w) => w.operationalScore)?.operationalScore,
      format: "score",
    },
    {
      id: "efficiency",
      label: "Best revenue quality vs volume",
      winner: topByFn(withScores, (w) => w.revenueQualityScore || 0, (w) => w.quantity >= 400)?.waiter,
      value: topByFn(withScores, (w) => w.revenueQualityScore || 0, (w) => w.quantity >= 400)?.revenueQualityScore,
      format: "score",
    },
    {
      id: "hidden",
      label: "Hidden opportunity",
      winner: topByFn(
        withScores,
        (w) => w.quantity,
        (w) => w.modifierAttachPct < 12 && w.quantity >= 450 && (w.revenueQualityScore || 0) < 50,
      )?.waiter,
      value: topByFn(withScores, (w) => w.revenueQualityScore || 0, (w) => (w.revenueQualityScore || 0) < 50)?.revenueQualityScore,
      format: "score",
    },
  ].filter((a) => a.winner);

  const ranked = [...withScores].sort((a, b) => {
    const rq = (b.revenueQualityScore || 0) - (a.revenueQualityScore || 0);
    if (Math.abs(rq) > 3) return rq;
    return b.operationalScore - a.operationalScore;
  });

  return {
    awards,
    ranked,
    topOperational: ranked[0] || null,
  };
}
