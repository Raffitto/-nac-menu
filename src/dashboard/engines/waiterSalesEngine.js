import {
  canonicalStaffName,
  resolveStaffRole,
  staffRoleLabel,
  EXPECTED_WAITERS,
} from "../config/staffRoles";
import { matchFocusItem } from "../utils/focusItemCatalog";
import {
  DEFAULT_WAITER_SALES_METRIC,
  waiterSalesValue,
  sortWaitersByMetric,
} from "../utils/waiterSalesMetric";

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

function itemLabel(row) {
  return (row.matched_menu_item_name || row.raw_item_name || "").trim();
}

function isModifierRow(row) {
  return (
    row.is_modifier ||
    row.track_as_modifier ||
    ["modifier", "sauce_condiment", "addon"].includes(row.semantic_class)
  );
}

function isFoodCategory(cat, name) {
  if (cat === "dessert") return false;
  if (cat === "beverage") return false;
  if (name.includes("water") || name.includes("coffee") || name.includes("juice")) return false;
  return ["mains", "breakfast", "other"].includes(cat) || cat === "food";
}

function rowGross(row) {
  const g = Number(row.gross_sales);
  if (Number.isFinite(g)) return g;
  return Number(row.net_sales) || 0;
}

function rowNet(row) {
  const n = Number(row.net_sales);
  if (Number.isFinite(n)) return n;
  return Number(row.gross_sales) || 0;
}

/**
 * Staff KPIs from waiter product sales import — canonical names, gross + net totals.
 */
export function buildWaiterSalesIntelligence(salesItems = [], options = {}) {
  const focusItems = options.focusItems || [];
  const salesMetric = options.salesMetric || DEFAULT_WAITER_SALES_METRIC;
  const byWaiter = {};

  (salesItems || []).forEach((row) => {
    const waiter = canonicalStaffName(row.waiter_name || "Unassigned");
    if (!byWaiter[waiter]) {
      byWaiter[waiter] = {
        waiter,
        role: resolveStaffRole(waiter),
        roleLabel: staffRoleLabel(waiter),
        quantity: 0,
        net_sales: 0,
        gross_sales: 0,
        lines: 0,
        modifier_qty: 0,
        dessert_qty: 0,
        beverage_qty: 0,
        food_qty: 0,
        parent_qty: 0,
        categoryRevenue: {},
        focusStats: {},
      };
    }
    const w = byWaiter[waiter];
    const qty = Number(row.quantity_sold) || 0;
    w.quantity += qty;
    w.net_sales += rowNet(row);
    w.gross_sales += rowGross(row);
    w.lines += 1;

    const cat = categoryFromRow(row);
    const name = itemLabel(row).toLowerCase();
    const revForCat = rowGross(row);
    w.categoryRevenue[cat] = (w.categoryRevenue[cat] || 0) + revForCat;

    const isMod = isModifierRow(row);

    if (isMod) w.modifier_qty += qty;
    else w.parent_qty += qty;

    if (cat === "beverage" || name.includes("coffee") || name.includes("tea") || name.includes("juice")) {
      w.beverage_qty += qty;
    }
    if (cat === "dessert" || name.includes("dessert") || name.includes("cake") || name.includes("churros")) {
      w.dessert_qty += qty;
    }
    if (isFoodCategory(cat, name) && !isMod) {
      w.food_qty += qty;
    }

    const focusMatch = matchFocusItem(itemLabel(row), focusItems);
    if (focusMatch) {
      if (!w.focusStats[focusMatch]) {
        w.focusStats[focusMatch] = { label: focusMatch, qty: 0, revenue: 0 };
      }
      w.focusStats[focusMatch].qty += qty;
      w.focusStats[focusMatch].revenue += revForCat;
    }
  });

  const list = Object.values(byWaiter).map((w) => {
    const primarySales = waiterSalesValue(w, salesMetric);
    const avgCheck = w.quantity > 0 ? Math.round((primarySales / w.quantity) * 100) / 100 : 0;
    const modifierAttachPct =
      w.parent_qty > 0 ? Math.round((w.modifier_qty / w.parent_qty) * 1000) / 10 : 0;
    const dessertAttachPct =
      w.parent_qty > 0 ? Math.round((w.dessert_qty / w.parent_qty) * 1000) / 10 : 0;
    const beverageAttachPct =
      w.parent_qty > 0 ? Math.round((w.beverage_qty / w.parent_qty) * 1000) / 10 : 0;
    const foodMixPct =
      w.parent_qty > 0 ? Math.round((w.food_qty / w.parent_qty) * 1000) / 10 : 0;
    const beverageMixPct = beverageAttachPct;

    const cats = Object.entries(w.categoryRevenue || {}).sort((a, b) => b[1] - a[1]);
    const strongestCategory = cats[0]?.[0] || "—";
    const weakestCategory = cats.length > 1 ? cats[cats.length - 1][0] : "—";

    const focusPerformance = focusItems.map((label) => {
      const stat = w.focusStats[label] || { label, qty: 0, revenue: 0 };
      return { label, qty: stat.qty, revenue: stat.revenue };
    });

    return {
      ...w,
      primarySales,
      avgCheck,
      modifierAttachPct,
      dessertAttachPct,
      beverageAttachPct,
      foodMixPct,
      beverageMixPct,
      strongestCategory,
      weakestCategory,
      focusPerformance,
      role: w.role || resolveStaffRole(w.waiter),
      roleLabel: staffRoleLabel(w.waiter),
    };
  });

  const sorted = sortWaitersByMetric(list, salesMetric);
  const waitersOnly = sorted.filter((w) => w.role === "waiter");
  const managers = sorted.filter((w) => w.role === "manager" || w.role === "admin");
  const competition = waitersOnly;
  const maxSales = competition[0] ? waiterSalesValue(competition[0], salesMetric) : 1;

  return {
    all: sorted,
    waiters: competition,
    managers,
    salesMetric,
    topUpseller: competition[0] || null,
    dessertChampion: [...competition].sort((a, b) => b.dessertAttachPct - a.dessertAttachPct)[0] || null,
    beverageChampion: [...competition].sort((a, b) => b.beverageAttachPct - a.beverageAttachPct)[0] || null,
    radarTop: competition.map((w) => ({
      waiter: w.waiter.length > 12 ? `${w.waiter.slice(0, 10)}…` : w.waiter,
      revenue: waiterSalesValue(w, salesMetric),
      modifier: w.modifierAttachPct,
      dessert: w.dessertAttachPct,
      beverage: w.beverageAttachPct,
      foodMix: w.foodMixPct,
      avgCheck: w.avgCheck,
    })),
    maxSales,
    waiterCount: waitersOnly.length,
    managerCount: managers.length,
    expectedWaiterCount: EXPECTED_WAITERS.length,
    grandTotals: sorted.reduce(
      (acc, w) => ({
        gross_sales: acc.gross_sales + w.gross_sales,
        net_sales: acc.net_sales + w.net_sales,
        quantity: acc.quantity + w.quantity,
        row_count: acc.row_count + w.lines,
      }),
      { gross_sales: 0, net_sales: 0, quantity: 0, row_count: 0 },
    ),
  };
}
