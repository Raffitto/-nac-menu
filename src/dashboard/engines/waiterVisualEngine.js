/**
 * Phase 11 — Chart-ready datasets for waiter comparison & beverage mix visuals.
 */
import { waiterSalesValue } from "../utils/waiterSalesMetric";

const SHIFT_COLORS = {
  breakfast: "#d7bc8a",
  pm: "#4ecdc4",
  balanced: "#8F7A5F",
};

export function shiftColor(shiftLean) {
  return SHIFT_COLORS[shiftLean] || SHIFT_COLORS.balanced;
}

export function shiftLabel(shiftLean) {
  if (shiftLean === "breakfast") return "AM";
  if (shiftLean === "pm") return "PM";
  return "Mixed";
}

function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

function norm(value, max) {
  if (!max || max <= 0) return 0;
  return Math.round(Math.min(100, (value / max) * 100));
}

/** Bubble scatter: gross vs revenue quality */
export function buildRevenueQualityScatter(waiters = [], salesMetric = "gross") {
  return waiters.map((w) => {
    const gross = waiterSalesValue(w, salesMetric);
    const lean = w.ops?.shiftLean || "balanced";
    return {
      waiter: w.waiter,
      gross,
      rq: w.revenueQualityScore ?? 0,
      avgCheck: w.avgCheck ?? 0,
      shift: lean,
      shiftLabel: shiftLabel(lean),
      fill: shiftColor(lean),
      z: Math.max(80, Math.min(420, (w.avgCheck || 30) * 8)),
    };
  });
}

/** Normalized grouped bars for horizontal comparison */
export function buildWaiterGroupedBars(waiters = [], salesMetric = "gross") {
  const list = [...waiters];
  const maxGross = Math.max(...list.map((w) => waiterSalesValue(w, salesMetric)), 1);
  const maxAvg = Math.max(...list.map((w) => w.avgCheck || 0), 1);
  const maxRq = Math.max(...list.map((w) => w.revenueQualityScore || 0), 1);

  return list.map((w) => {
    const gross = waiterSalesValue(w, salesMetric);
    return {
      waiter: w.waiter,
      shortName: w.waiter.length > 11 ? `${w.waiter.slice(0, 10)}…` : w.waiter,
      bars: [
        {
          key: "gross",
          label: "Gross",
          pct: norm(gross, maxGross),
          raw: gross,
          display: `${Math.round(gross).toLocaleString()} SAR`,
          tone: "teal",
        },
        {
          key: "avg",
          label: "Avg ticket",
          pct: norm(w.avgCheck, maxAvg),
          raw: w.avgCheck,
          display: `${Math.round(w.avgCheck || 0)} SAR`,
          tone: "gold",
        },
        {
          key: "mod",
          label: "Modifier",
          pct: Math.min(100, w.modifierAttachPct || 0),
          raw: w.modifierAttachPct,
          display: `${w.modifierAttachPct ?? 0}%`,
          tone: "teal",
        },
        {
          key: "premBev",
          label: "Premium bev",
          pct: Math.min(100, w.ops?.premiumBevPct || 0),
          raw: w.ops?.premiumBevPct,
          display: `${w.ops?.premiumBevPct ?? 0}%`,
          tone: "gold",
        },
        {
          key: "rq",
          label: "Rev. quality",
          pct: norm(w.revenueQualityScore, maxRq),
          raw: w.revenueQualityScore,
          display: `${w.revenueQualityScore ?? 0}/100`,
          tone: w.revenueQualityScore >= 55 ? "teal" : w.revenueQualityScore < 42 ? "critical" : "warn",
        },
      ],
    };
  });
}

/** Radar axes 0–100 for one waiter vs team benchmarks */
export function buildWaiterRadar(waiter, teamWaiters = []) {
  if (!waiter) return { axes: [], waiter: null };

  const team = teamWaiters.length ? teamWaiters : [waiter];
  const maxAvg = Math.max(...team.map((w) => w.avgCheck || 0), 1);
  const mod = waiter.modifierAttachPct || 0;
  const lowBev = waiter.ops?.lowValueBevPct || 0;
  const consistency = Math.max(
    0,
    Math.min(100, 100 - Math.abs(lowBev - 35) * 0.9 - (mod < 8 ? 12 : 0)),
  );
  const upsell = Math.round(
    ((waiter.revenueQualityScore || 0) * 0.55 +
      Math.min(100, (mod || 0) * 2.2) * 0.25 +
      Math.min(100, (waiter.ops?.premiumBevPct || 0) * 2.5) * 0.2),
  );

  const axes = [
    { axis: "Premium mix", value: Math.min(100, waiter.ops?.premiumMixPct || 0), fullMark: 100 },
    { axis: "Avg ticket", value: norm(waiter.avgCheck, maxAvg), fullMark: 100 },
    { axis: "Modifiers", value: Math.min(100, mod), fullMark: 100 },
    { axis: "Premium bev", value: Math.min(100, waiter.ops?.premiumBevPct || 0), fullMark: 100 },
    { axis: "Dessert", value: Math.min(100, waiter.dessertAttachPct || 0), fullMark: 100 },
    { axis: "Consistency", value: Math.round(consistency), fullMark: 100 },
    { axis: "Upsell eff.", value: upsell, fullMark: 100 },
  ];

  return { waiter: waiter.waiter, axes, shiftLabel: shiftLabel(waiter.ops?.shiftLean) };
}

/** Stacked beverage mix % per waiter */
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

/** Premium beverage % leaderboard */
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
    }))
    .sort((a, b) => b.premiumPct - a.premiumPct);
}

/**
 * Conservative premium beverage opportunity — not aggressive AI math.
 * Only Pepsi-heavy profiles; capped uplift on low-value beverage gross.
 */
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

    byWaiter.push({
      waiter: w.waiter,
      estimate,
      lowPct,
      lowGross,
    });
    teamTotal += estimate;
  });

  return {
    teamTotal,
    byWaiter: byWaiter.sort((a, b) => b.estimate - a.estimate),
    methodology:
      "Conservative: 12% of low-value beverage gross × 40% uplift factor. Validate on next Foodics period.",
  };
}

/** Full bundle for Visual OS + export */
export function buildOperationalVisualBundle(waiters = [], salesMetric = "gross") {
  const scatter = buildRevenueQualityScatter(waiters, salesMetric);
  const grouped = buildWaiterGroupedBars(waiters, salesMetric);
  const beverageStack = buildBeverageMixStacked(waiters);
  const premiumLeaderboard = buildPremiumBevLeaderboard(waiters);
  const opportunity = estimatePremiumBeverageOpportunity(waiters);

  const defaultRadarWaiter =
    [...waiters].sort((a, b) => (b.revenueQualityScore || 0) - (a.revenueQualityScore || 0))[0] ||
    waiters[0] ||
    null;

  return {
    scatter,
    grouped,
    beverageStack,
    premiumLeaderboard,
    opportunity,
    defaultRadarWaiter,
    radarFor: (w) => buildWaiterRadar(w, waiters),
  };
}
