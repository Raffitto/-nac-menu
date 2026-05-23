/**
 * Foodics waiter revenue quality scoring — distinct from branch review operationalScoreEngine.
 */

import { classifyMenuItem, inferShiftLean } from "../config/menuOperationalTaxonomy";
import { canonicalStaffName } from "../config/staffRoles";

function rowGross(row) {
  const g = Number(row.gross_sales);
  return Number.isFinite(g) ? g : Number(row.net_sales) || 0;
}

function itemName(row) {
  return (row.matched_menu_item_name || row.raw_item_name || "").trim();
}

function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

/** Enrich waiter roster with Foodics line-level sales metrics. */
export function buildFoodicsWaiterIntelligence(salesItems = [], waiterIntel = {}, timeShift = null) {
  const byWaiter = {};
  const team = {
    gross: 0,
    qty: 0,
    premiumBevGross: 0,
    lowValueBevGross: 0,
    bevGross: 0,
    breakfastGross: 0,
    eggGross: 0,
    dessertGross: 0,
    modifierQty: 0,
    parentQty: 0,
  };

  (salesItems || []).forEach((row) => {
    const waiter = canonicalStaffName(row.waiter_name);
    if (!byWaiter[waiter]) {
      byWaiter[waiter] = {
        gross: 0,
        qty: 0,
        premiumBevGross: 0,
        lowValueBevGross: 0,
        standardBevGross: 0,
        bevGross: 0,
        bevQty: 0,
        breakfastGross: 0,
        breakfastQty: 0,
        eggGross: 0,
        eggQty: 0,
        dessertGross: 0,
        dessertQty: 0,
        premiumFoodGross: 0,
        coffeeQty: 0,
        mocktailGross: 0,
        mocktailQty: 0,
        modifierQty: 0,
        parentQty: 0,
        lines: 0,
      };
    }
    const w = byWaiter[waiter];
    const name = itemName(row);
    const qty = Number(row.quantity_sold) || 0;
    const gross = rowGross(row);
    const cat = row.analytics_category || row.category || "";
    const cls = classifyMenuItem(name, cat);
    const isMod = row.is_modifier || row.track_as_modifier;

    w.gross += gross;
    w.qty += qty;
    w.lines += 1;
    team.gross += gross;
    team.qty += qty;

    if (!isMod) w.parentQty += qty;
    else w.modifierQty += qty;

    if (cls.beverageTier === "low_value") {
      w.lowValueBevGross += gross;
      w.bevGross += gross;
      w.bevQty += qty;
      team.lowValueBevGross += gross;
      team.bevGross += gross;
    } else if (
      cls.beverageTier === "premium" ||
      name.toLowerCase().includes("mocktail") ||
      name.toLowerCase().includes("mojito")
    ) {
      w.premiumBevGross += gross;
      w.bevGross += gross;
      w.bevQty += qty;
      team.premiumBevGross += gross;
      team.bevGross += gross;
      if (
        name.toLowerCase().includes("mocktail") ||
        name.toLowerCase().includes("mojito") ||
        name.toLowerCase().includes("lemonade")
      ) {
        w.mocktailGross += gross;
        w.mocktailQty += qty;
      }
    } else if (cls.beverageTier === "standard" || cat === "beverage") {
      w.standardBevGross += gross;
      w.bevGross += gross;
      w.bevQty += qty;
      team.bevGross += gross;
      if (
        name.toLowerCase().includes("coffee") ||
        name.toLowerCase().includes("latte") ||
        name.toLowerCase().includes("espresso")
      ) {
        w.coffeeQty += qty;
      }
    }

    if (cls.foodTier === "breakfast" || cls.foodTier === "egg") {
      w.breakfastGross += gross;
      w.breakfastQty += qty;
      team.breakfastGross += gross;
    }
    if (cls.foodTier === "egg") {
      w.eggGross += gross;
      w.eggQty += qty;
      team.eggGross += gross;
    }
    if (cls.foodTier === "dessert") {
      w.dessertGross += gross;
      w.dessertQty += qty;
      team.dessertGross += gross;
    }
    if (cls.foodTier === "premium") {
      w.premiumFoodGross += gross;
    }

    if (isMod) {
      team.modifierQty += qty;
    } else {
      team.parentQty += qty;
    }
  });

  team.premiumBevPct = pct(team.premiumBevGross, team.bevGross);
  team.lowValueBevPct = pct(team.lowValueBevGross, team.bevGross);
  team.breakfastPct = pct(team.breakfastGross, team.gross);

  const baseWaiters = waiterIntel?.waiters || [];
  const enriched = baseWaiters.map((w) => {
    const m = byWaiter[w.waiter] || byWaiter[canonicalStaffName(w.waiter)] || {};
    const gross = w.gross_sales || w.primarySales || m.gross || 0;
    const metrics = {
      premiumBevGross: m.premiumBevGross || 0,
      lowValueBevGross: m.lowValueBevGross || 0,
      bevGross: m.bevGross || 0,
      premiumBevPct: pct(m.premiumBevGross, m.bevGross),
      lowValueBevPct: pct(m.lowValueBevGross, m.bevGross),
      breakfastGross: m.breakfastGross || 0,
      breakfastPct: pct(m.breakfastGross, gross),
      eggGross: m.eggGross || 0,
      eggQty: m.eggQty || 0,
      dessertGross: m.dessertGross || 0,
      dessertPct: pct(m.dessertGross, gross),
      mocktailGross: m.mocktailGross || 0,
      mocktailQty: m.mocktailQty || 0,
      coffeeQty: m.coffeeQty || 0,
      premiumFoodGross: m.premiumFoodGross || 0,
      premiumMixPct: pct((m.premiumBevGross || 0) + (m.premiumFoodGross || 0), gross),
    };
    const shiftLean = inferShiftLean(w.waiter, metrics);
    return {
      ...w,
      ops: {
        ...metrics,
        shiftLean,
        shiftLabel:
          shiftLean === "breakfast"
            ? "Morning / breakfast-heavy"
            : shiftLean === "pm"
              ? "PM / dinner-heavy"
              : "Balanced daypart",
      },
    };
  });

  const daypartNote = timeShift?.peakDaypart?.label
    ? `Peak imported daypart: ${timeShift.peakDaypart.label}.`
    : "";

  return {
    waiters: enriched,
    team: { ...team, daypartNote },
    byWaiter,
  };
}

/** Foodics waiter score /100 — revenue quality from imported sales lines. */
export function computeFoodicsWaiterScore(w, teamAvg = {}) {
  const revScore = Math.min(22, (w.primarySales || w.gross_sales || 0) / 1400);
  const modScore = Math.min(22, (w.modifierAttachPct || 0) * 1.25);
  const premBevScore = Math.min(22, (w.ops?.premiumBevPct || 0) * 0.9);
  const avgCheckScore = Math.min(18, ((w.avgCheck || 0) / 48) * 18);
  const balanceScore = Math.min(10, 10 - Math.abs((w.foodMixPct || 50) - 55) / 5);
  const penalty =
    (w.ops?.lowValueBevPct || 0) > 58 && (w.ops?.premiumBevPct || 0) < 14
      ? 14
      : (w.quantity || 0) >= 480 && (w.avgCheck || 0) < 36
        ? 10
        : (w.modifierAttachPct || 0) < 6
          ? 6
          : 0;
  const legacy = Math.max(0, revScore + modScore + premBevScore + avgCheckScore + balanceScore - penalty);
  const rq = w.revenueQualityScore;
  if (rq != null && rq > 0) {
    return Math.round(Math.max(0, Math.min(100, legacy * 0.42 + rq * 0.58)));
  }
  return Math.round(Math.max(0, Math.min(100, legacy)));
}
