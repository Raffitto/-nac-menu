/**
 * Weekly coaching targets — food / add-ons / modifiers first; dessert secondary only.
 */

function focusCoaching(weakFocus, strongFocus) {
  if (!weakFocus?.length) return null;
  const names = weakFocus.map((f) => f.label).join(", ");
  return {
    severity: "high",
    category: "Weekly focus",
    headline: `Push weekly focus: ${names}`,
    action: `Prioritize ${names} on every eligible table. Lead with one specific item per guest before closing the order.`,
    pushNextWeek: names,
  };
}

function generalCoaching(w) {
  const name = w.waiter;
  let severity = "medium";
  let category = "Food & add-ons";
  let headline = `${name}: maintain food and add-on standards`;
  let action = "Offer a side, modifier, or beverage with every main course.";
  let pushNextWeek = "Food & add-ons";
  let secondaryNote = null;

  if (w.modifierAttachPct < 8 && w.net_sales >= 1500) {
    severity = "high";
    category = "Modifier upsell";
    headline = `${name}: strong volume, weak modifier attachment`;
    if ((w.strongestCategory || "").includes("mains") || w.strongestCategory === "other") {
      action =
        "Push truffle mayo and fries with every burger table. Script: suggest fries before closing the order.";
    } else {
      action = "Offer one paid add-on on every main — sauce, protein upgrade, or side.";
    }
    pushNextWeek = "Modifiers & sides";
  } else if (w.beverageAttachPct >= 12 && w.modifierAttachPct < 10 && w.food_qty < w.beverage_qty) {
    severity = "medium";
    category = "Beverage upsell";
    headline = `${name}: strong coffee — target extra shot / milk upsell`;
    action = "Offer extra shot during morning coffee rush and upsell milk alternatives on lattes.";
    pushNextWeek = "Extra shot & milk";
  } else if (w.foodMixPct < 55 && w.beverage_qty > w.food_qty && w.net_sales >= 800) {
    severity = "high";
    category = "Food attachment";
    headline = `${name}: high beverage, weak food mix`;
    action = "Pair every beverage order with a food item — breakfast plate, sandwich, or small bite.";
    pushNextWeek = "Food with drinks";
  } else if (w.net_sales >= 2000 && w.modifierAttachPct < 12) {
    severity = "medium";
    category = "Sides & modifiers";
    headline = `${name}: strong mains — improve side attachment`;
    action = "Suggest fries, asparagus, or truffle mayo with every main. Never close without one add-on.";
    pushNextWeek = "Sides & sauces";
  } else if ((w.strongestCategory || "") === "mains" && w.modifierAttachPct < 15) {
    severity = "medium";
    category = "Premium mix";
    headline = `${name}: push premium add-ons with mains`;
    action = "Offer protein upgrades with pasta/risotto and pita bread with dips on shareable tables.";
    pushNextWeek = "Premium add-ons";
  } else if ((w.strongestCategory || "") === "breakfast" && w.modifierAttachPct < 12) {
    severity = "medium";
    category = "Breakfast conversion";
    headline = `${name}: weak breakfast add-ons`;
    action = "Push maple syrup with pancakes and still/sparkling water with breakfast tables.";
    pushNextWeek = "Breakfast add-ons";
  } else if (w.net_sales < 600 && w.quantity > 0) {
    severity = "medium";
    category = "Check building";
    headline = `${name}: build average check`;
    action = "Focus on food + beverage pairing — never send a single-item ticket without an add-on offer.";
    pushNextWeek = "Pairings";
  } else if (w.modifierAttachPct >= 20) {
    severity = "low";
    category = "Mentor";
    headline = `${name}: top upseller — share playbook`;
    action = "Mentor team on modifier timing during peak shifts.";
    pushNextWeek = "Mentor peers";
  }

  if (w.dessertAttachPct < 5 && w.parent_qty >= 20) {
    secondaryNote = "Optional: mention desserts after mains — not the primary push.";
  }

  const impact =
    severity === "high"
      ? "High revenue lift if coaching is applied consistently."
      : "Incremental improvement on guest spend.";

  return {
    waiter: name,
    headline,
    action,
    pushNextWeek,
    severity,
    category,
    impact,
    secondaryNote,
    priority: severity === "high" ? "high" : severity === "low" ? "low" : "medium",
    net_sales: w.net_sales,
    quantity: w.quantity,
    modifierAttachPct: w.modifierAttachPct,
    dessertAttachPct: w.dessertAttachPct,
    beverageAttachPct: w.beverageAttachPct,
    foodMixPct: w.foodMixPct,
    beverageMixPct: w.beverageMixPct,
    strongestCategory: w.strongestCategory,
    weakestCategory: w.weakestCategory,
    focusPerformance: w.focusPerformance,
    detail: `${w.net_sales.toLocaleString()} SAR · ${w.quantity} units · ${w.modifierAttachPct}% mods · ${w.foodMixPct}% food mix · ${w.beverageMixPct}% bev`,
  };
}

/**
 * @param {object} waiterIntel — { waiters: [...] }
 * @param {{ focusItems?: string[], teamFocusBenchmarks?: object }} options
 */
export function buildWaiterTargets(waiterIntel, options = {}) {
  const list = waiterIntel?.waiters || [];
  const focusItems = options.focusItems || [];
  if (!list.length) return [];

  const teamFocusAvg = {};
  if (focusItems.length) {
    focusItems.forEach((label) => {
      const total = list.reduce((s, w) => {
        const fp = (w.focusPerformance || []).find((f) => f.label === label);
        return s + (fp?.qty || 0);
      }, 0);
      teamFocusAvg[label] = list.length ? total / list.length : 0;
    });
  }

  return list.map((w) => {
    if (focusItems.length) {
      const weakFocus = (w.focusPerformance || []).filter((f) => {
        const avg = teamFocusAvg[f.label] || 0;
        return f.qty < Math.max(1, avg * 0.6);
      });
      const strongFocus = (w.focusPerformance || []).filter((f) => f.qty >= (teamFocusAvg[f.label] || 0) * 1.1);

      if (weakFocus.length) {
        const coached = focusCoaching(weakFocus, strongFocus);
        return {
          ...generalCoaching(w),
          ...coached,
          headline: `${w.waiter}: ${coached.headline}`,
          secondaryNote: w.dessertAttachPct < 5 ? "Optional dessert mention after mains." : null,
          focusWeak: weakFocus,
          focusStrong: strongFocus,
        };
      }
    }

    return generalCoaching(w);
  });
}
