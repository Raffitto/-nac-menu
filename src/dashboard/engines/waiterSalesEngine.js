/**
 * Waiter / server KPIs from Foodics sales imports.
 */
export function buildWaiterSalesIntelligence(salesItems = []) {
  const byWaiter = {};

  (salesItems || []).forEach((row) => {
    const waiter = (row.waiter_name || "Unassigned").trim() || "Unassigned";
    if (!byWaiter[waiter]) {
      byWaiter[waiter] = {
        waiter,
        quantity: 0,
        net_sales: 0,
        lines: 0,
        modifier_qty: 0,
        dessert_qty: 0,
        beverage_qty: 0,
        parent_qty: 0,
      };
    }
    const w = byWaiter[waiter];
    const qty = Number(row.quantity_sold) || 0;
    w.quantity += qty;
    w.net_sales += Number(row.net_sales) || 0;
    w.lines += 1;

    const isMod =
      row.is_modifier ||
      row.track_as_modifier ||
      ["modifier", "sauce_condiment", "addon"].includes(row.semantic_class);
    const cat = (row.analytics_category || row.inherited_category || "").toLowerCase();
    const name = (row.matched_menu_item_name || row.raw_item_name || "").toLowerCase();

    if (isMod) w.modifier_qty += qty;
    else w.parent_qty += qty;

    if (cat === "beverage" || name.includes("coffee") || name.includes("tea") || name.includes("juice")) {
      w.beverage_qty += qty;
    }
    if (name.includes("dessert") || name.includes("cake") || name.includes("churros") || name.includes("pavlova")) {
      w.dessert_qty += qty;
    }
  });

  const list = Object.values(byWaiter).map((w) => {
    const avgCheck = w.quantity > 0 ? Math.round((w.net_sales / w.quantity) * 100) / 100 : 0;
    const modifierAttachPct =
      w.parent_qty > 0 ? Math.round((w.modifier_qty / w.parent_qty) * 1000) / 10 : 0;
    const dessertAttachPct =
      w.parent_qty > 0 ? Math.round((w.dessert_qty / w.parent_qty) * 1000) / 10 : 0;
    const beverageAttachPct =
      w.parent_qty > 0 ? Math.round((w.beverage_qty / w.parent_qty) * 1000) / 10 : 0;

    return {
      ...w,
      avgCheck,
      modifierAttachPct,
      dessertAttachPct,
      beverageAttachPct,
    };
  });

  const sorted = list.sort((a, b) => b.net_sales - a.net_sales);

  return {
    waiters: sorted,
    topUpseller: sorted[0] || null,
    dessertChampion: [...sorted].sort((a, b) => b.dessertAttachPct - a.dessertAttachPct)[0] || null,
    beverageChampion: [...sorted].sort((a, b) => b.beverageAttachPct - a.beverageAttachPct)[0] || null,
    radarTop: sorted.slice(0, 5).map((w) => ({
      waiter: w.waiter.length > 12 ? `${w.waiter.slice(0, 10)}…` : w.waiter,
      revenue: w.net_sales,
      modifier: w.modifierAttachPct,
      dessert: w.dessertAttachPct,
      beverage: w.beverageAttachPct,
      avgCheck: w.avgCheck,
    })),
  };
}
