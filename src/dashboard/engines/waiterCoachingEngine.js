/**
 * Calibrated operational coaching — trust layer prevents fake / generic insights.
 */
import {
  CONFIDENCE,
  CONFIDENCE_LABEL,
  isBreakfastHeavy,
  isPmHeavy,
  isLowValueBeverageDominant,
  isPremiumBeverageMeaningful,
  isVolumeWithoutMargin,
} from "./intelligenceCalibration";

function withMeta(w, block, team) {
  const conf = w.confidence?.overall || CONFIDENCE.MODERATE;
  return {
    ...block,
    confidence: conf,
    confidenceLabel: CONFIDENCE_LABEL[conf],
    severity: block.severity || "medium",
  };
}

/** Breakfast-heavy server: never celebrate breakfast — frame as expected + premium gap */
function breakfastCalibrated(w, team) {
  const name = w.waiter;
  const mod = w.modifierAttachPct || 0;
  const bf = w.ops?.breakfastPct || 0;
  const premBev = w.ops?.premiumBevPct || 0;
  const expected = w.calibration?.breakfastExpected || isBreakfastHeavy(w);

  if (expected) {
    return {
      narrative: `Breakfast volume is already strong (${bf}% of gross) due to shift positioning — this is expected, not a surprise. Egg and brunch items are moving, but modifier capture remains ${mod}% and premium beverage mix is only ${premBev}%.`,
      opportunity:
        "Within existing morning traffic, convert tables with premium beverages (mocktails/lemonades ~29 SAR) and paid sides — do not add generic breakfast coaching.",
      category: "Breakfast premium conversion",
      severity: mod < 10 || premBev < 15 ? "high" : "medium",
    };
  }

  return {
    narrative: `${name} shows breakfast crossover (${bf}% breakfast mix) outside a primary morning profile. Premium attach on brunch tables trails peers.`,
    opportunity: "When on morning cover, pair breakfast mains with one premium beverage before close.",
    category: "Breakfast crossover",
    severity: "medium",
  };
}

function beverageCalibrated(w, team) {
  const name = w.waiter;
  const lowBev = w.ops?.lowValueBevPct || 0;
  const premBev = w.ops?.premiumBevPct || 0;
  const bevConf = w.confidence?.beverageMix || CONFIDENCE.MODERATE;

  if (isLowValueBeverageDominant(w)) {
    const cautious = bevConf === CONFIDENCE.LOW ? " (beverage sample still building)" : "";
    return {
      narrative: `Beverage count is high (${w.beverageAttachPct}% attach), but ${lowBev}% of drink revenue is Pepsi/7Up/water — not a beverage success story.${cautious}`,
      opportunity:
        premBev < 12
          ? "Convert soft drink defaults to mocktails and signature lemonades — this is the largest margin lever on current tables."
          : "Continue shifting cola/water orders to premium drinks; soft drink share remains above target.",
      category: "Beverage quality mix",
      severity: "high",
    };
  }

  if (isPremiumBeverageMeaningful(w) && premBev >= 22) {
    return {
      narrative: `${name} runs a credible premium beverage mix (${premBev}% premium drink revenue) — mocktails and specialty drinks are contributing real margin.`,
      opportunity: isPmHeavy(w)
        ? "Document PM scripts for premium drinks; use as peer reference on dinner shifts."
        : "Maintain premium-first beverage suggestion — avoid reverting to soft drink defaults.",
      category: "Premium beverage strength",
      severity: "low",
    };
  }

  return {
    narrative: `${name} sells beverages steadily but premium penetration (${premBev}%) is below floor target. Volume alone is not improving profitability.`,
    opportunity: "Lead with signature lemonade or mocktail — not cola or Pepsi — on every eligible table.",
    category: "Premium beverage gap",
    severity: "medium",
  };
}

function pmCalibrated(w) {
  const name = w.waiter;
  const mod = w.modifierAttachPct || 0;
  const dessert = w.dessertAttachPct || 0;
  const premBev = w.ops?.premiumBevPct || 0;

  if (isBreakfastHeavy(w)) {
    return null;
  }

  return {
    narrative: `${name} carries a PM-weighted profile: dessert attach ${dessert}%, modifier ${mod}%. ${premBev < 15 ? "Premium beverage mix remains low for dinner-style traffic." : "Premium drinks are contributing on dinner tables."}`,
    opportunity:
      dessert < 8
        ? "PM focus: dessert offer on mains; add one premium modifier before ticket send."
        : "Push premium modifiers and mocktails on multi-guest PM tables — not soft drinks.",
    category: "PM monetization",
    severity: mod < 12 ? "high" : "medium",
  };
}

function volumeMarginCalibrated(w) {
  return {
    narrative: `${w.waiter} runs high unit volume (${w.quantity} covers) but avg check (${w.avgCheck} SAR) and modifier attach (${w.modifierAttachPct}%) indicate revenue quality is thin — quantity is inflating gross without margin depth.`,
    opportunity:
      "Treat as upsell efficiency issue: one paid modifier + one premium beverage attempt per table before close — volume without attach is not a win.",
    category: "Revenue quality",
    severity: "high",
  };
}

function modifierCalibrated(w) {
  const mod = w.modifierAttachPct || 0;
  const conf = w.confidence?.modifier || CONFIDENCE.MODERATE;
  if (conf === CONFIDENCE.LOW) {
    return {
      narrative: `${w.waiter}: modifier sample is still limited this period — avoid aggressive coaching until attach data stabilizes.`,
      opportunity: "Track paid add-on attempts per shift; revisit after more covers post in Foodics.",
      category: "Monitor modifiers",
      severity: "low",
    };
  }
  if (mod < 8 && (w.primarySales || w.gross_sales) >= 1500) {
    return {
      narrative: `${w.waiter} posts solid gross with only ${mod}% modifier attach — paid add-ons are under-captured relative to table volume.`,
      opportunity: "Pre-close script: fries, sauce upgrade, or side with every main — skip free condiment-only offers as the primary push.",
      category: "Modifier monetization",
      severity: "high",
    };
  }
  return null;
}

function balancedCalibrated(w, team, rank) {
  const mod = w.modifierAttachPct || 0;
  const avg = w.avgCheck || 0;
  const rq = w.revenueQualityScore || 0;

  if (mod >= 18 && rq >= 55) {
    return {
      narrative: `${w.waiter} combines ${mod}% modifier attach, ${avg} SAR avg check, and revenue quality score ${rq}/100 — profile is operationally balanced.`,
      opportunity: "Use as floor mentor for modifier timing; focus team on premium beverage conversion next.",
      category: "Operational benchmark",
      severity: "low",
    };
  }

  const modBlock = modifierCalibrated(w);
  if (modBlock) return modBlock;

  return {
    narrative: `${w.waiter} maintains ${avg} SAR avg check with revenue quality ${rq}/100. Primary gap is premium monetization vs peers, not raw covers.`,
    opportunity: "Prioritize margin levers (premium bev + paid modifiers) over pushing more single-item tickets.",
    category: "Margin focus",
    severity: "medium",
  };
}

const NAMED = {
  Azhar: (w, t) => breakfastCalibrated(w, t),
  Saiful: (w, t) => {
    if (isLowValueBeverageDominant(w)) return beverageCalibrated(w, t);
    return {
      narrative: `${w.waiter} shows stable covers with elevated coffee (${w.ops?.coffeeQty || 0} units). Coffee drives traffic; premium beverage conversion (${w.ops?.premiumBevPct || 0}%) is the margin lever.`,
      opportunity: "Shift coffee-only patterns to premium iced drinks and mocktails on lunch/dinner — not more coffee volume.",
      category: "Coffee-to-premium",
      severity: "high",
    };
  },
  Ronald: (w, t) => {
    const b = pmCalibrated(w);
    if (b) return b;
    return {
      narrative: `${w.waiter} runs balanced food and beverage spread on PM-leaning shifts. Premium attachment trails table volume.`,
      opportunity: "Dinner tables: mocktail first, modifier on mains — avoid Pepsi default on groups.",
      category: "PM consistency",
      severity: "medium",
    };
  },
  Rana: (w, t) => {
    if (isLowValueBeverageDominant(w)) return beverageCalibrated(w, t);
    return {
      narrative: `${w.waiter} moves tables well with dessert contribution (${w.dessertAttachPct}%), but ${w.ops?.lowValueBevPct || 0}% of beverage revenue is low-margin soft drinks.`,
      opportunity: "Replace soft drink defaults with premium mocktails and lemonades on dessert-capable PM tables.",
      category: "Premium beverage gap",
      severity: "high",
    };
  },
  Sujan: (w, t) => {
    if (isVolumeWithoutMargin(w)) return volumeMarginCalibrated(w);
    return {
      narrative: `${w.waiter} delivers reliable unit volume (${w.quantity}) with ${w.avgCheck} SAR avg check. Modifier capture (${w.modifierAttachPct}%) lags interaction count.`,
      opportunity: "Structured upsell: modifier with every main, premium beverage before close — measure attempts, not just covers.",
      category: "Upsell efficiency",
      severity: "high",
    };
  },
};

export function buildWaiterCoaching(waiters = [], options = {}) {
  const team = options.team || {};
  const focusItems = options.focusItems || [];
  const list = [...waiters].sort((a, b) => (b.primarySales || b.gross_sales) - (a.primarySales || a.gross_sales));

  return list
    .map((w, rank) => {
      let block = null;

      if ((w.confidence?.volume || CONFIDENCE.MODERATE) === CONFIDENCE.LOW) {
        block = {
          narrative: `${w.waiter}: insufficient cover volume this period for strong coaching conclusions.`,
          opportunity: "Re-import full period sales or wait for higher sample before floor coaching.",
          category: "Low sample",
          severity: "low",
        };
      } else if (NAMED[w.waiter]) {
        block = NAMED[w.waiter](w, team);
      } else if (isVolumeWithoutMargin(w)) {
        block = volumeMarginCalibrated(w);
      } else if (isBreakfastHeavy(w) && !isPmHeavy(w)) {
        block = breakfastCalibrated(w, team);
      } else if (isPmHeavy(w) && !isBreakfastHeavy(w)) {
        block = pmCalibrated(w) || beverageCalibrated(w, team);
      } else if (isLowValueBeverageDominant(w)) {
        block = beverageCalibrated(w, team);
      } else {
        block = balancedCalibrated(w, team, rank);
      }

      if (!block) {
        block = balancedCalibrated(w, team, rank);
      }

      block = withMeta(w, block, team);

      const focusNote =
        focusItems.length && (w.confidence?.overall !== CONFIDENCE.LOW)
          ? ` Focus items (${focusItems.slice(0, 2).join(", ")}) only where they fit shift and margin logic.`
          : "";

      return {
        waiter: w.waiter,
        headline: `${w.waiter} — ${block.category}`,
        narrative: block.narrative,
        action: block.opportunity + focusNote,
        body: `${block.narrative} ${block.opportunity}`,
        opportunity: block.opportunity,
        category: block.category,
        severity: block.severity,
        priority: block.severity,
        confidence: block.confidence,
        confidenceLabel: block.confidenceLabel,
        shiftLean: w.ops?.shiftLabel || "—",
        operationalScore: w.operationalScore,
        revenueQualityScore: w.revenueQualityScore,
        premiumBevPct: w.ops?.premiumBevPct,
        lowValueBevPct: w.ops?.lowValueBevPct,
        breakfastPct: w.ops?.breakfastPct,
        modifierAttachPct: w.modifierAttachPct,
        avgCheck: w.avgCheck,
        gross_sales: w.gross_sales,
        quantity: w.quantity,
      };
    })
    .filter(Boolean);
}

export function buildWaiterTargets(waiterIntel, options = {}) {
  const waiters = waiterIntel?.waiters || [];
  return buildWaiterCoaching(waiters, {
    focusItems: options.focusItems,
    team: options.team,
  });
}
