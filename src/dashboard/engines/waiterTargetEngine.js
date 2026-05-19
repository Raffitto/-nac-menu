/**
 * Actionable weekly coaching targets — waiters only (call on filtered list).
 */
export function buildWaiterTargets(waiterIntel) {
  const list = waiterIntel?.waiters || [];
  if (!list.length) return [];

  return list.map((w) => {
    const name = w.waiter;
    let severity = "medium";
    let category = "General";
    let headline = `${name}: maintain service standards`;
    let action = "Continue pairing suggestions on every table.";
    let pushNextWeek = "Maintain standards";

    if (w.modifierAttachPct < 8 && w.net_sales >= 1500) {
      severity = "high";
      category = "Modifier upsell";
      headline = `${name}: strong volume, weak modifier attachment`;
      if ((w.strongestCategory || "").includes("mains") || w.strongestCategory === "other") {
        action =
          "Push truffle sauce and fries with every burger table. Script: suggest fries before closing the order.";
      } else {
        action = "Offer one paid add-on on every main — sauce, protein upgrade, or side.";
      }
      pushNextWeek = "Modifiers & sides";
    } else if (w.dessertAttachPct < 6 && w.parent_qty >= 15) {
      severity = "high";
      category = "Dessert";
      headline = `${name}: push desserts next week`;
      action = "Promote desserts after 9 PM and with every coffee close. Lead with churros or pavlova.";
      pushNextWeek = "Desserts";
    } else if (w.beverageAttachPct >= 12 && w.modifierAttachPct < 10) {
      severity = "medium";
      category = "Beverage upsell";
      headline = `${name}: high beverage movement — target extra shot upsell`;
      action = "Offer extra shot during morning coffee rush and after lunch lattes.";
      pushNextWeek = "Extra shot & milk";
    } else if (w.net_sales >= 2500 && w.dessert_qty < 8) {
      severity = "medium";
      category = "Dessert";
      headline = `${name}: strong mains, improve dessert attachment`;
      action = "Present dessert menu with mains — never skip the dessert ask.";
      pushNextWeek = "Desserts";
    } else if ((w.strongestCategory || "") === "breakfast" && w.modifierAttachPct < 12) {
      severity = "medium";
      category = "Breakfast conversion";
      headline = `${name}: weak breakfast add-ons`;
      action = "Push maple syrup with pancakes and fresh milk with coffee at breakfast tables.";
      pushNextWeek = "Breakfast add-ons";
    } else if (w.net_sales < 600 && w.quantity > 0) {
      severity = "medium";
      category = "Check building";
      headline = `${name}: build average check`;
      action = "Focus on pairings — beverage + side with every single-item order.";
      pushNextWeek = "Pairings";
    } else if (w.modifierAttachPct >= 20) {
      severity = "low";
      category = "Mentor";
      headline = `${name}: top upseller — share playbook`;
      action = "Mentor team on modifier timing during peak shifts.";
      pushNextWeek = "Mentor peers";
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
      priority: severity === "high" ? "high" : severity === "low" ? "low" : "medium",
      net_sales: w.net_sales,
      quantity: w.quantity,
      modifierAttachPct: w.modifierAttachPct,
      dessertAttachPct: w.dessertAttachPct,
      beverageAttachPct: w.beverageAttachPct,
      strongestCategory: w.strongestCategory,
      weakestCategory: w.weakestCategory,
      detail: `${w.net_sales.toLocaleString()} SAR · ${w.quantity} units · ${w.modifierAttachPct}% mods · ${w.dessertAttachPct}% desserts`,
    };
  });
}
