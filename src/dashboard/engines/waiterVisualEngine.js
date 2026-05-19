/**
 * Chart-ready datasets + executive storytelling for waiter & beverage visuals.
 */
import { waiterSalesValue } from "../utils/waiterSalesMetric";
import {
  SHIFT_LABELS,
  SCATTER_QUADRANTS,
  ARCHETYPES,
  EXECUTIVE_LABELS,
  revenueQualityBand,
  SEMANTIC,
} from "../config/executiveVisualLanguage";
import {
  isBreakfastHeavy,
  isPmHeavy,
  isVolumeWithoutMargin,
  isLowValueBeverageDominant,
} from "./intelligenceCalibration";

const SHIFT_COLORS = {
  breakfast: SEMANTIC.gold,
  pm: SEMANTIC.teal,
  balanced: SEMANTIC.gray,
};

export function shiftColor(shiftLean) {
  return SHIFT_COLORS[shiftLean] || SHIFT_COLORS.balanced;
}

export function shiftLabel(shiftLean) {
  return SHIFT_LABELS[shiftLean] || SHIFT_LABELS.balanced;
}

function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

function norm(value, max) {
  if (!max || max <= 0) return 0;
  return Math.round(Math.min(100, (value / max) * 100));
}

export function inferWaiterArchetype(w) {
  if (isLowValueBeverageDominant(w) && (w.revenueQualityScore || 0) < 48) {
    return { ...ARCHETYPES.margin_risk, hint: "Soft drink-heavy mix dilutes margin quality" };
  }
  if (isVolumeWithoutMargin(w)) {
    return { ...ARCHETYPES.volume_heavy, hint: "Highest volume, weakest monetization quality" };
  }
  if ((w.revenueQualityScore || 0) >= 72 && (w.ops?.premiumBevPct || 0) >= 18) {
    return { ...ARCHETYPES.premium_seller, hint: "Best premium conversion on the floor" };
  }
  if (isBreakfastHeavy(w)) {
    return { ...ARCHETYPES.breakfast_specialist, hint: "Morning shift concentration — coach premium within traffic" };
  }
  if (isPmHeavy(w)) {
    return { ...ARCHETYPES.dinner_specialist, hint: "Dinner shift monetization profile" };
  }
  if ((w.modifierAttachPct || 0) < 10 && (w.quantity || 0) >= 420) {
    return { ...ARCHETYPES.hidden_upside, hint: "Hidden operational upside on modifiers and premium beverages" };
  }
  return { ...ARCHETYPES.balanced_operator, hint: "Balanced floor operator" };
}

function classifyScatterPoint(p, midGross, midRq) {
  const highVol = p.gross >= midGross;
  const highRq = p.rq >= midRq;
  if (highVol && highRq) return SCATTER_QUADRANTS.premium_balanced;
  if (highVol && !highRq) return SCATTER_QUADRANTS.volume_risk;
  if (!highVol && highRq) return SCATTER_QUADRANTS.quality_specialist;
  return SCATTER_QUADRANTS.hidden_opportunity;
}

export function buildRevenueQualityScatter(waiters = [], salesMetric = "gross") {
  const points = waiters.map((w) => {
    const gross = waiterSalesValue(w, salesMetric);
    const lean = w.ops?.shiftLean || "balanced";
    const archetype = inferWaiterArchetype(w);
    const band = revenueQualityBand(w.revenueQualityScore);
    return {
      waiter: w.waiter,
      gross,
      rq: w.revenueQualityScore ?? 0,
      avgCheck: w.avgCheck ?? 0,
      shift: lean,
      shiftLabel: shiftLabel(lean),
      fill: shiftColor(lean),
      z: Math.max(90, Math.min(440, (w.avgCheck || 30) * 8)),
      archetype,
      qualityBand: band.label,
    };
  });

  const maxGross = Math.max(...points.map((p) => p.gross), 1);
  const midGross = maxGross * 0.52;
  const midRq = 52;

  return points.map((p) => {
    const quadrant = classifyScatterPoint(p, midGross, midRq);
    let callout = quadrant.hint;
    if (p === points.find((x) => x.gross === maxGross && x.rq === Math.min(...points.map((z) => z.rq)))) {
      callout = "Highest volume, weakest monetization";
    }
    const topRq = [...points].sort((a, b) => b.rq - a.rq)[0];
    if (p.waiter === topRq?.waiter) callout = "Best revenue quality on the floor";
    return { ...p, quadrant, scatterCallout: callout, midGross, midRq };
  });
}

export function buildWaiterGroupedBars(waiters = [], salesMetric = "gross") {
  const list = [...waiters];
  const maxGross = Math.max(...list.map((w) => waiterSalesValue(w, salesMetric)), 1);
  const maxAvg = Math.max(...list.map((w) => w.avgCheck || 0), 1);
  const maxRq = Math.max(...list.map((w) => w.revenueQualityScore || 0), 1);

  return list
    .map((w, rank) => {
      const gross = waiterSalesValue(w, salesMetric);
      const archetype = inferWaiterArchetype(w);
      return {
        waiter: w.waiter,
        shortName: w.waiter.length > 11 ? `${w.waiter.slice(0, 10)}…` : w.waiter,
        rank: rank + 1,
        archetype,
        bars: [
          {
            key: "gross",
            label: EXECUTIVE_LABELS.grossSales,
            pct: norm(gross, maxGross),
            display: `${Math.round(gross).toLocaleString()} SAR`,
            tone: "teal",
          },
          {
            key: "avg",
            label: EXECUTIVE_LABELS.avgTicket,
            pct: norm(w.avgCheck, maxAvg),
            display: `${Math.round(w.avgCheck || 0)} SAR`,
            tone: "gold",
          },
          {
            key: "mod",
            label: EXECUTIVE_LABELS.modifierAttach,
            pct: Math.min(100, w.modifierAttachPct || 0),
            display: `${w.modifierAttachPct ?? 0}%`,
            tone: "teal",
          },
          {
            key: "premBev",
            label: EXECUTIVE_LABELS.premiumBeverageMix,
            pct: Math.min(100, w.ops?.premiumBevPct || 0),
            display: `${w.ops?.premiumBevPct ?? 0}%`,
            tone: "gold",
          },
          {
            key: "rq",
            label: EXECUTIVE_LABELS.revenueQuality,
            pct: norm(w.revenueQualityScore, maxRq),
            display: `${w.revenueQualityScore ?? 0}/100`,
            tone: w.revenueQualityScore >= 72 ? "teal" : w.revenueQualityScore < 48 ? "critical" : "warn",
          },
        ],
      };
    })
    .sort((a, b) => b.bars.find((x) => x.key === "rq")?.pct - a.bars.find((x) => x.key === "rq")?.pct);
}

export function buildWaiterRadar(waiter, teamWaiters = []) {
  if (!waiter) return { axes: [], waiter: null, teamBenchmark: [] };

  const team = teamWaiters.length ? teamWaiters : [waiter];
  const maxAvg = Math.max(...team.map((w) => w.avgCheck || 0), 1);
  const teamAvgMod = team.reduce((s, w) => s + (w.modifierAttachPct || 0), 0) / team.length;
  const teamAvgPrem = team.reduce((s, w) => s + (w.ops?.premiumBevPct || 0), 0) / team.length;
  const mod = waiter.modifierAttachPct || 0;
  const lowBev = waiter.ops?.lowValueBevPct || 0;
  const consistency = Math.max(0, Math.min(100, 100 - Math.abs(lowBev - 35) * 0.9 - (mod < 8 ? 12 : 0)));
  const upsell = Math.round(
    (waiter.revenueQualityScore || 0) * 0.55 +
      Math.min(100, mod * 2.2) * 0.25 +
      Math.min(100, (waiter.ops?.premiumBevPct || 0) * 2.5) * 0.2,
  );

  const axes = [
    { axis: "Premium mix", value: Math.min(100, waiter.ops?.premiumMixPct || 0), benchmark: 55, fullMark: 100 },
    { axis: "Average ticket", value: norm(waiter.avgCheck, maxAvg), benchmark: 55, fullMark: 100 },
    { axis: "Modifier attach", value: Math.min(100, mod), benchmark: Math.round(teamAvgMod), fullMark: 100 },
    { axis: "Premium beverage", value: Math.min(100, waiter.ops?.premiumBevPct || 0), benchmark: Math.round(teamAvgPrem), fullMark: 100 },
    { axis: "Dessert monetization", value: Math.min(100, waiter.dessertAttachPct || 0), benchmark: 12, fullMark: 100 },
    { axis: "Consistency", value: Math.round(consistency), benchmark: 60, fullMark: 100 },
    { axis: "Upsell efficiency", value: upsell, benchmark: 58, fullMark: 100 },
  ];

  return {
    waiter: waiter.waiter,
    axes,
    shiftLabel: shiftLabel(waiter.ops?.shiftLean),
    archetype: inferWaiterArchetype(waiter),
  };
}

export function buildBeverageMixStacked(waiters = []) {
  return waiters
    .filter((w) => (w.ops?.bevGross || 0) > 0)
    .map((w) => {
      const bev = w.ops.bevGross;
      const low = pct(w.ops.lowValueBevGross, bev);
      const prem = pct(w.ops.premiumBevGross, bev);
      const standard = Math.max(0, Math.round((100 - low - prem) * 10) / 10);
      return {
        waiter: w.waiter,
        shortName: w.waiter.length > 11 ? `${w.waiter.slice(0, 10)}…` : w.waiter,
        low,
        standard,
        premium: prem,
        lowGross: w.ops.lowValueBevGross || 0,
        premiumGross: w.ops.premiumBevGross || 0,
        bevGross: bev,
      };
    })
    .sort((a, b) => b.low - a.low);
}

export function buildPremiumBevLeaderboard(waiters = []) {
  return [...waiters]
    .filter((w) => (w.ops?.bevGross || 0) > 200)
    .map((w) => ({
      waiter: w.waiter,
      shortName: w.waiter.length > 11 ? `${w.waiter.slice(0, 10)}…` : w.waiter,
      premiumPct: w.ops?.premiumBevPct || 0,
      lowPct: w.ops?.lowValueBevPct || 0,
      premiumGross: w.ops?.premiumBevGross || 0,
      bevGross: w.ops?.bevGross || 0,
      callout: (w.ops?.premiumBevPct || 0) >= 22 ? "Best premium conversion" : null,
    }))
    .sort((a, b) => b.premiumPct - a.premiumPct);
}

export function estimatePremiumBeverageOpportunity(waiters = []) {
  const CONVERTIBLE_SHARE = 0.12;
  const UPLIFT_FACTOR = 0.4;
  const MIN_LOW_PCT = 45;
  const MIN_LOW_GROSS = 350;

  const byWaiter = [];
  let teamTotal = 0;

  waiters.forEach((w) => {
    const lowPct = w.ops?.lowValueBevPct || 0;
    const lowGross = w.ops?.lowValueBevGross || 0;
    if (lowPct < MIN_LOW_PCT || lowGross < MIN_LOW_GROSS) return;

    const estimate = Math.round(lowGross * CONVERTIBLE_SHARE * UPLIFT_FACTOR);
    if (estimate < 80) return;

    byWaiter.push({ waiter: w.waiter, estimate, lowPct, lowGross });
    teamTotal += estimate;
  });

  return {
    teamTotal,
    byWaiter: byWaiter.sort((a, b) => b.estimate - a.estimate),
    methodology:
      "Conservative premium beverage conversion potential. Validate on next Foodics period before treating as fixed recoverable revenue.",
  };
}

export function enrichWaitersForVisuals(waiters = []) {
  return waiters.map((w) => {
    const archetype = inferWaiterArchetype(w);
    return { ...w, archetype, scatterCallout: archetype.hint };
  });
}

export function buildOperationalVisualBundle(waiters = [], salesMetric = "gross") {
  const enriched = enrichWaitersForVisuals(waiters);
  const scatter = buildRevenueQualityScatter(enriched, salesMetric);
  const grouped = buildWaiterGroupedBars(enriched, salesMetric);
  const beverageStack = buildBeverageMixStacked(enriched);
  const premiumLeaderboard = buildPremiumBevLeaderboard(enriched);
  const opportunity = estimatePremiumBeverageOpportunity(enriched);

  const defaultRadarWaiter =
    [...enriched].sort((a, b) => (b.revenueQualityScore || 0) - (a.revenueQualityScore || 0))[0] ||
    enriched[0] ||
    null;

  const volumeRisk = scatter.find((p) => p.quadrant?.id === "volume_risk" && p.gross === Math.max(...scatter.map((s) => s.gross)));
  const qualityLeader = [...scatter].sort((a, b) => b.rq - a.rq)[0];

  return {
    scatter,
    grouped,
    beverageStack,
    premiumLeaderboard,
    opportunity,
    defaultRadarWaiter,
    volumeRisk,
    qualityLeader,
    radarFor: (w) => buildWaiterRadar(w, enriched),
    midGross: scatter[0]?.midGross,
    midRq: scatter[0]?.midRq ?? 52,
  };
}
