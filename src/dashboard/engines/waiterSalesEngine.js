import { resolveStaffRole, staffRoleLabel } from "../config/staffRoles";

function categoryFromRow(row) {
  const cat = (row.analytics_category || row.inherited_category || row.category || "").toLowerCase();
  const name = (row.matched_menu_item_name || row.raw_item_name || "").toLowerCase();
  if (cat) return cat;
  if (name.includes("coffee") || name.includes("tea") || name.includes("juice")) return "beverage";
  if (name.includes("dessert") || name.includes("cake") || name.includes("churros")) return "dessert";
  if (name.includes("burger") || name.includes("pasta") || name.includes("main")) return "mains";
  if (name.includes("breakfast") || name.includes("pancake")) return "breakfast";
  return "other";
}

/**
 * Staff KPIs from waiter product sales import — every creator + role tagging.
 */
export function buildWaiterSalesIntelligence(salesItems = []) {
  const byWaiter = {};

  (salesItems || []).forEach((row) => {
    const waiter = (row.waiter_name || "Unassigned").trim() || "Unassigned";
    if (!byWaiter[waiter]) {
      byWaiter[waiter] = {
        waiter,
        role: resolveStaffRole(waiter),
        roleLabel: staffRoleLabel(waiter),
        quantity: 0,
        net_sales: 0,
        lines: 0,
        modifier_qty: 0,
        dessert_qty: 0,
        beverage_qty: 0,
        parent_qty: 0,
        categoryRevenue: {},
      };
    }
    const w = byWaiter[waiter];
    const qty = Number(row.quantity_sold) || 0;
    const rev = Number(row.net_sales) || 0;
    w.quantity += qty;
    w.net_sales += rev;
    w.lines += 1;

    const cat = categoryFromRow(row);
    w.categoryRevenue[cat] = (w.categoryRevenue[cat] || 0) + rev;

    const isMod =
      row.is_modifier ||
      row.track_as_modifier ||
      ["modifier", "sauce_condiment", "addon"].includes(row.semantic_class);
    const name = (row.matched_menu_item_name || row.raw_item_name || "").toLowerCase();

    if (isMod) w.modifier_qty += qty;
    else w.parent_qty += qty;

    if (cat === "beverage" || name.includes("coffee") || name.includes("tea") || name.includes("juice")) {
      w.beverage_qty += qty;
    }
    if (cat === "dessert" || name.includes("dessert") || name.includes("cake") || name.includes("churros")) {
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

    const cats = Object.entries(w.categoryRevenue || {}).sort((a, b) => b[1] - a[1]);
    const strongestCategory = cats[0]?.[0] || "—";
    const weakestCategory = cats.length > 1 ? cats[cats.length - 1][0] : "—";

    return {
      ...w,
      avgCheck,
      modifierAttachPct,
      dessertAttachPct,
      beverageAttachPct,
      strongestCategory,
      weakestCategory,
      role: w.role || resolveStaffRole(w.waiter),
      roleLabel: staffRoleLabel(w.waiter),
    };
  });

  const sorted = list.sort((a, b) => b.net_sales - a.net_sales);
  const waitersOnly = sorted.filter((w) => w.role === "waiter");
  const managers = sorted.filter((w) => w.role === "manager" || w.role === "admin");

  const competition = waitersOnly;

  return {
    all: sorted,
    waiters: competition,
    managers,
    topUpseller: competition[0] || null,
    dessertChampion: [...competition].sort((a, b) => b.dessertAttachPct - a.dessertAttachPct)[0] || null,
    beverageChampion: [...competition].sort((a, b) => b.beverageAttachPct - a.beverageAttachPct)[0] || null,
    radarTop: competition.slice(0, 5).map((w) => ({
      waiter: w.waiter.length > 12 ? `${w.waiter.slice(0, 10)}…` : w.waiter,
      revenue: w.net_sales,
      modifier: w.modifierAttachPct,
      dessert: w.dessertAttachPct,
      beverage: w.beverageAttachPct,
      avgCheck: w.avgCheck,
    })),
    waiterCount: waitersOnly.length,
    managerCount: managers.length,
  };
}
