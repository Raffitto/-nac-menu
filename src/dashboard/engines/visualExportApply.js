import { buildWaiterTargets } from "./waiterTargetEngine";

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

/** Apply export panel filters to intelligence payload */
export function applyVisualExportConfig(payload, config) {
  const cfg = config || {};
  const sections = cfg.sections || {};
  let waiters = payload.waiters;

  if (waiters?.waiters?.length) {
    let list = [...waiters.waiters];
    if (!cfg.allWaiters && cfg.selectedWaiters?.length) {
      const set = new Set(cfg.selectedWaiters.map((w) => w.toLowerCase()));
      list = list.filter((w) => set.has(w.waiter.toLowerCase()));
    }
    if (cfg.waiterSearch?.trim()) {
      const q = cfg.waiterSearch.trim().toLowerCase();
      list = list.filter((w) => w.waiter.toLowerCase().includes(q));
    }
    list = sortWaiters(list, cfg.waiterSort);
    waiters = {
      ...waiters,
      waiters: list,
      topUpseller: list[0] || null,
      dessertChampion: [...list].sort((a, b) => b.dessertAttachPct - a.dessertAttachPct)[0] || null,
      beverageChampion: [...list].sort((a, b) => b.beverageAttachPct - a.beverageAttachPct)[0] || null,
      radarTop: list.slice(0, 5).map((w) => ({
        waiter: w.waiter.length > 12 ? `${w.waiter.slice(0, 10)}…` : w.waiter,
        revenue: w.net_sales,
        modifier: w.modifierAttachPct,
        dessert: w.dessertAttachPct,
        beverage: w.beverageAttachPct,
        avgCheck: w.avgCheck,
      })),
    };
  }

  const waiterTargets = sections.waiterTargets !== false ? buildWaiterTargets(waiters) : [];
  const sortedProducts = sortProducts(payload.heat, payload.funnels, cfg.productSort);

  return {
    ...payload,
    waiters,
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
