import { buildWaiterCoaching } from "./waiterCoachingEngine";
import { buildFoodicsWaiterIntelligence } from "./foodicsWaiterScoreEngine";
import { buildStaffAwards } from "./staffAwardsEngine";
import { buildExecutiveOpsInsights } from "./executiveOpsInsightsEngine";
import { buildExecutiveSummary } from "./executiveSummaryEngine";
import { calibrateWaiterProfiles, calibrateTeamContext } from "./intelligenceCalibration";
import { enrichWaitersForVisuals } from "./waiterVisualEngine";
import { buildFinancialAggregation } from "./financialAggregationEngine";
import { buildVisualInsights } from "./visualInsightEngine";
import { partitionStaffByRole, staffNamesMatch } from "../config/staffRoles";
import { waiterSalesValue } from "../utils/waiterSalesMetric";

function sortWaiters(list, sortBy, salesMetric = "gross") {
  const copy = [...(list || [])];
  const key = sortBy || "gross_sales";
  if (key === "gross_sales" || key === "primarySales") {
    copy.sort((a, b) => waiterSalesValue(b, salesMetric) - waiterSalesValue(a, salesMetric));
    return copy;
  }
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

function rebuildWaiterIntel(base, list, salesMetric = "gross") {
  const sorted = [...list];
  const maxSales = sorted[0] ? waiterSalesValue(sorted[0], salesMetric) : 1;
  return {
    ...base,
    waiters: sorted,
    salesMetric,
    topUpseller: sorted[0] || null,
    dessertChampion: [...sorted].sort((a, b) => b.dessertAttachPct - a.dessertAttachPct)[0] || null,
    beverageChampion:
      [...sorted].sort((a, b) => (b.ops?.premiumBevPct || 0) - (a.ops?.premiumBevPct || 0))[0] || null,
    radarTop: sorted.map((w) => ({
      waiter: w.waiter.length > 12 ? `${w.waiter.slice(0, 10)}…` : w.waiter,
      revenue: waiterSalesValue(w, salesMetric),
      modifier: w.modifierAttachPct,
      dessert: w.dessertAttachPct,
      beverage: w.beverageAttachPct,
      foodMix: w.foodMixPct,
      avgCheck: w.avgCheck,
    })),
    maxSales,
  };
}

function filterSelectedWaiters(list, cfg) {
  if (cfg.allWaiters || !cfg.selectedWaiters?.length) {
    return list;
  }
  const selected = cfg.selectedWaiters || [];
  if (!selected.length) return list;

  return list.filter((w) =>
    selected.some((name) => staffNamesMatch(name, w.waiter)),
  );
}

/** Apply export panel filters — waiter-only competitions unless includeManagers */
export function applyVisualExportConfig(payload, config) {
  const cfg = config || {};
  const sections = cfg.sections || {};
  const includeManagers = cfg.includeManagers === true;
  const focusItems = cfg.weeklyFocusItems || [];
  const salesMetric = cfg.waiterSalesMetric || "gross";

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

  competitionList = filterSelectedWaiters(competitionList, cfg);

  if (cfg.waiterSearch?.trim()) {
    const q = cfg.waiterSearch.trim().toLowerCase();
    competitionList = competitionList.filter((w) =>
      w.waiter.toLowerCase().includes(q),
    );
  }

  competitionList = sortWaiters(competitionList, cfg.waiterSort, salesMetric);
  waiters = rebuildWaiterIntel(waiters, competitionList, salesMetric);

  const salesItems = payload.waiterSalesItems || [];
  const opsIntel = buildFoodicsWaiterIntelligence(salesItems, waiters, payload.timeShift);
  const calibratedTeam = calibrateTeamContext(opsIntel.team, opsIntel.waiters);
  const calibratedWaiters = calibrateWaiterProfiles(opsIntel.waiters, calibratedTeam);

  const staffAwards = buildStaffAwards(calibratedWaiters, calibratedTeam);
  const scoredWaiters = enrichWaitersForVisuals(
    calibratedWaiters.map((w) => {
      const ranked = staffAwards.ranked.find((r) => r.waiter === w.waiter);
      return { ...w, operationalScore: ranked?.operationalScore ?? w.operationalScore };
    }),
  );
  const financial = buildFinancialAggregation({
    attachment: payload.attachment,
    waiters: scoredWaiters,
  });
  waiters = {
    ...waiters,
    waiters: scoredWaiters,
    beverageChampion:
      [...scoredWaiters].sort((a, b) => (b.ops?.premiumBevPct || 0) - (a.ops?.premiumBevPct || 0))[0] || null,
  };

  const opsInsights = buildExecutiveOpsInsights({
    team: calibratedTeam,
    waiters: scoredWaiters,
    attachment: payload.attachment,
    timeShift: payload.timeShift,
    awards: staffAwards,
  });

  const summary = buildExecutiveSummary({
    waiters,
    team: calibratedTeam,
    awards: staffAwards,
    attachment: payload.attachment,
    opsInsights,
    financial,
  });

  const legacyInsights = buildVisualInsights({
    attachment: payload.attachment,
    timeShift: payload.timeShift,
    heat: payload.heat,
    menuEngineering: payload.menuEngineering,
    waiters,
  });

  const insights = [...opsInsights.insights, ...legacyInsights.filter((i) => !opsInsights.insights.some((o) => o.title === i.title))].slice(0, 12);

  const waiterTargets =
    sections.waiterTargets !== false
      ? buildWaiterCoaching(scoredWaiters, { focusItems, team: calibratedTeam })
      : [];
  const sortedProducts = sortProducts(payload.heat, payload.funnels, cfg.productSort);

  return {
    ...payload,
    waiters,
    managers: partitioned.managers,
    staffOverview,
    waiterTargets,
    staffAwards,
    opsIntel: { ...opsIntel, team: calibratedTeam, waiters: scoredWaiters },
    executiveSummary: summary,
    opsInsights,
    financial,
    insights,
    sortedProducts,
    weeklyFocusItems: focusItems,
    exportConfig: cfg,
    exportMeta: {
      ...(payload.exportMeta || {}),
      title: payload.exportMeta?.title || "NAC Visual Intelligence",
      period: `${cfg.dateFrom || "—"} → ${cfg.dateTo || "—"}`,
      branch: cfg.branch || "all",
      targetMode: cfg.targetMode,
      salesMetric: cfg.waiterSalesMetric || "gross",
      weeklyFocus: focusItems.join(", ") || "General food & add-on upsell",
    },
    sections,
  };
}
