import { buildWaiterTargets } from "./waiterTargetEngine";
import { partitionStaffByRole } from "../config/staffRoles";

function sortWaiters(list, sortBy) {
  const copy = [...(list || [])];
  const key = sortBy || "net_sales";
  copy.sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0));
  return copy;
}

function sortProducts(heatItems, funnels, sortBy) {
  const items = heatItems?.items?.length ? [...heatItems.items] : [];
  if (sortBy === "highInterest") {
    return items.filter((i) => i.tag === "high_interest_low_sales");
  }
  if (sortBy === "conversion") {
    return [...(funnels || [])]
      .sort((a, b) => (b.conversion_pct || 0) - (a.conversion_pct || 0))
      .map((f) => ({
        item_name: f.item_name,
        heatIndex: f.conversion_pct,
        orders: f.orders,
        views: f.item_opens,
        revenue: f.net_sales,
      }));
  }
  if (sortBy === "quantity") {
    return items.sort((a, b) => (b.orders || 0) - (a.orders || 0));
  }
  if (sortBy === "heatIndex") {
    return items.sort((a, b) => (b.heatIndex || 0) - (a.heatIndex || 0));
  }
  return items.sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
}

function rebuildWaiterIntel(base, list) {
  const sorted = [...list];
  return {
    ...base,
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

/** Apply export panel filters — waiter-only competitions unless includeManagers */
export function applyVisualExportConfig(payload, config) {
  const cfg = config || {};
  const sections = cfg.sections || {};
  const includeManagers = cfg.includeManagers === true;

  let waiters = payload.waiters;
  let staffOverview = {
    waiterCount: waiters?.waiterCount ?? 0,
    managerCount: waiters?.managerCount ?? 0,
  };

  const sourceList = waiters?.all?.length ? waiters.all : waiters?.waiters || [];
  const partitioned = partitionStaffByRole(sourceList, { includeManagers });

  staffOverview = {
    waiterCount: partitioned.waiterCount,
    managerCount: partitioned.managerCount,
    includeManagers,
  };

  let competitionList = includeManagers ? partitioned.all : partitioned.waiters;

  if (!cfg.allWaiters && cfg.selectedWaiters?.length) {
    const set = new Set(cfg.selectedWaiters.map((w) => w.toLowerCase()));
    competitionList = competitionList.filter((w) => set.has(w.waiter.toLowerCase()));
  }
  if (cfg.waiterSearch?.trim()) {
    const q = cfg.waiterSearch.trim().toLowerCase();
    competitionList = competitionList.filter((w) => w.waiter.toLowerCase().includes(q));
  }

  competitionList = sortWaiters(competitionList, cfg.waiterSort);
  waiters = rebuildWaiterIntel(waiters, competitionList);

  const waiterTargets = sections.waiterTargets !== false ? buildWaiterTargets(waiters) : [];
  const sortedProducts = sortProducts(payload.heat, payload.funnels, cfg.productSort);

  return {
    ...payload,
    waiters,
    managers: partitioned.managers,
    staffOverview,
    waiterTargets,
    sortedProducts,
    exportConfig: cfg,
    exportMeta: {
      ...(payload.exportMeta || {}),
      title: payload.exportMeta?.title || "NAC Visual Intelligence",
      period: `${cfg.dateFrom || "—"} → ${cfg.dateTo || "—"}`,
      branch: cfg.branch || "all",
      targetMode: cfg.targetMode,
    },
    sections,
  };
}
