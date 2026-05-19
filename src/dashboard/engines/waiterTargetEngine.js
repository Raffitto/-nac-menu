/**
 * Per-waiter weekly target recommendations for staff exports.
 */
export function buildWaiterTargets(waiterIntel) {
  const list = waiterIntel?.waiters || [];
  if (!list.length) return [];

  return list.map((w) => {
    const name = w.waiter;
    const parts = [];
    let priority = "maintain";
    let headline = `${name}: maintain momentum`;

    if (w.net_sales >= 3000 && w.modifierAttachPct < 10) {
      parts.push("strong volume, weak modifier attachment");
      headline = `${name}: strong volume, weak modifier attachment`;
      priority = "modifier";
    } else if (w.dessertAttachPct < 8 && w.parent_qty >= 20) {
      parts.push("push desserts next week");
      headline = `${name}: push desserts next week`;
      priority = "dessert";
    } else if (w.beverageAttachPct >= 15 && w.modifierAttachPct < 8) {
      parts.push("high beverage movement — target extra shot upsell");
      headline = `${name}: high beverage movement, target extra shot upsell`;
      priority = "beverage_upsell";
    } else if (w.net_sales >= 2000 && w.dessert_qty < 5) {
      parts.push("strong mains — improve dessert attachment");
      headline = `${name}: strong mains, improve dessert attachment`;
      priority = "dessert";
    } else if (w.modifierAttachPct >= 18) {
      parts.push("top upseller — mentor team on add-ons");
      headline = `${name}: top upseller — share modifier playbook`;
      priority = "mentor";
    } else if (w.net_sales < 800) {
      parts.push("build check size — focus on pairings");
      headline = `${name}: build average check with pairings`;
      priority = "volume";
    }

    const detail = parts.length
      ? parts.join(" · ")
      : `${w.net_sales.toLocaleString()} SAR · ${w.modifierAttachPct}% mods · ${w.dessertAttachPct}% desserts`;

    return {
      waiter: name,
      headline,
      detail,
      priority,
      net_sales: w.net_sales,
      quantity: w.quantity,
      modifierAttachPct: w.modifierAttachPct,
      dessertAttachPct: w.dessertAttachPct,
      beverageAttachPct: w.beverageAttachPct,
      avgCheck: w.avgCheck,
      pushNextWeek:
        priority === "dessert"
          ? "Desserts"
          : priority === "modifier" || priority === "beverage_upsell"
            ? "Modifiers & shots"
            : priority === "volume"
              ? "Pairings & sides"
              : "Maintain standards",
    };
  });
}
