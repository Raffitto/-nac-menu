import { formatCategoryName } from "../utils/formatters";
import {
  safePct,
  sanitizeFunnelRow,
  validateInsightData,
  clampMetric,
  safeNumber,
  hasVisibilityTracking,
  buildTopItemVisibilityMap,
  filterExecutiveRows,
} from "../utils/intelligenceSanity";
import { normalizeTopItems } from "../utils/topItemsNormalize";
import { classifyItemBehavior } from "../utils/itemBehaviorEngine";
import { buildSearchIntelligence as buildAdvancedSearch } from "./searchIntelligenceEngine";
import { buildCategoryGrades } from "./categoryGradeEngine";
import { buildPlacementIntelligence } from "./placementIntelligenceEngine";
import { detectCannibalization } from "./cannibalizationEngine";
import { buildOperationalIntelligence } from "./operationalIntelligenceEngine";
import { buildVisibilityDiagnostics } from "../utils/visibilityDiagnosticsEngine";
import { getBusinessDayRange, periodLabelFromHours } from "../utils/businessDay";

function grade(score) {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 45) return "C";
  return "D";
}

/** View → order funnel per item (menu + Foodics) */
export function buildItemFunnels(biData, conversionRows = []) {
  const topItems = biData?.top_items || [];
  const totalSessions = Math.max(1, safeNumber(biData?.total_sessions, 1));

  const fromFoodics = conversionRows.map((row) =>
    sanitizeFunnelRow({
      item_name: row.item_name,
      item_impressions: row.item_impressions,
      item_modal_opens: row.item_modal_opens,
      impressions: row.item_impressions,
      item_opens: row.item_modal_opens,
      orders: row.quantity_sold,
      net_sales: row.net_sales,
      conversion_pct: row.impression_conversion_pct ?? row.menu_conversion_pct,
      revenue_per_view: row.revenue_per_view,
      order_trend_pct: row.order_trend_pct,
      offline_driven: row.offline_driven,
      trust_label: row.trust_label,
      offline_ratio_pct: row.offline_ratio_pct,
      deep_interest_rate: row.deep_interest_rate,
      visible_duration_ms: row.visible_duration_ms,
      impression_sessions: row.impression_sessions,
      attention_score: row.attention_score,
    }),
  );

  const visMap = buildTopItemVisibilityMap(topItems);
  const extras = topItems
    .filter((t) => !conversionRows.some((r) => r.item_name?.toLowerCase() === t.name?.toLowerCase()))
    .map((t) => {
      const vis = visMap[t.name?.toLowerCase()] || { impressions: 0, opens: t.opens || 0, visibility: t.opens || 0 };
      return sanitizeFunnelRow({
        item_name: t.name,
        item_impressions: vis.impressions,
        item_modal_opens: vis.opens,
        impressions: vis.impressions,
        item_opens: vis.opens,
        orders: 0,
        net_sales: 0,
        impression_sessions: vis.impression_sessions,
        visible_duration_ms: vis.visible_duration_ms,
      });
    });

  return filterExecutiveRows([...fromFoodics, ...extras])
    .sort((a, b) => b.item_opens - a.item_opens)
    .slice(0, 40)
    .map((f) => {
      const behavior = classifyItemBehavior(f);
      return {
        ...f,
        ...behavior,
        revenue_per_session: safePct(f.orders * (f.revenue_per_view || 0), totalSessions),
      };
    });
}

/** Attention efficiency: elite, hidden gems, traps, dead weight */
export function buildAttentionScores(funnels = []) {
  if (!funnels.length) return { elite: [], hiddenGems: [], menuTraps: [], deadWeight: [] };

  const scored = funnels.map((f) => ({
    ...f,
    attention_score: f.attention_score ?? 0,
  }));

  const sorted = [...scored].sort((a, b) => b.attention_score - a.attention_score);
  const elite = sorted.filter((s) => s.attention_score >= 70 && s.orders > 0).slice(0, 5);
  const hiddenGems = sorted.filter((s) => s.item_opens < 15 && s.orders >= 8).slice(0, 5);
  const menuTraps = sorted
    .filter(
      (s) =>
        (s.impressions || s.item_opens) >= 25 &&
        s.conversion_allowed &&
        s.conversion_pct != null &&
        s.conversion_pct < 5 &&
        !s.offline_driven,
    )
    .slice(0, 5);
  const deadWeight = sorted.filter((s) => s.item_opens >= 15 && s.orders === 0).slice(0, 5);

  return { elite, hiddenGems, menuTraps, deadWeight, all: scored };
}

/** Menu friction insights */
export function buildFrictionInsights(biData, funnels = []) {
  const insights = [];
  const bounce = Number(biData?.bounce_sessions) || 0;
  const sessions = Number(biData?.total_sessions) || 0;
  const bounceRate = safePct(bounce, sessions);

  funnels
    .filter(
      (f) =>
        f.item_opens >= 20 &&
        f.conversion_allowed &&
        f.conversion_pct != null &&
        f.conversion_pct < 4 &&
        !f.offline_driven,
    )
    .forEach((f) => {
      insights.push({
        id: `friction-${f.item_name}`,
        title: `Guests hesitate on ${f.item_name}`,
        explanation: `${f.item_impressions ?? f.item_opens} impressions with ${f.conversion_pct}% visibility-to-sales. Description or price may create resistance.`,
        action: "Improve photo, shorten description, test price positioning, or staff recommendation.",
        severity: "high",
      });
    });

  if (bounceRate > 35 && sessions >= 10) {
    insights.push({
      id: "friction-bounce",
      title: "High early exit rate",
      explanation: `${bounceRate}% of sessions bounce quickly after scanning.`,
      action: "Improve landing category and first-screen item appeal.",
      severity: "high",
    });
  }

  const lost = biData?.lost_searches || [];
  lost.slice(0, 2).forEach((s) => {
    const q = s.query || s.q;
    if (q) {
      insights.push({
        id: `search-friction-${q}`,
        title: `Search friction: "${q}"`,
        explanation: "Guests search but may not find a matching item.",
        action: "Guests repeatedly search for terms that do not return strong results. Add Arabic/English synonyms to improve search success.",
        severity: "medium",
      });
    }
  });

  return insights;
}

/** Offline / waiter-driven sellers */
export function buildOfflineSellers(funnels = []) {
  return funnels
    .filter((f) => f.offline_driven || (f.item_opens < 8 && f.orders >= 12))
    .map((f) => ({
      item_name: f.item_name,
      orders: f.orders,
      views: f.item_opens,
      label: f.trust_label || (f.item_opens === 0 ? "Offline-driven seller" : "Waiter-driven item"),
      suggestion: "Increase digital visibility — item sells well without menu discovery.",
    }));
}

/** Category health grades */
export function buildCategoryHealth(biData) {
  const topCats = biData?.top_categories || [];
  const deadZones = biData?.dead_zones || [];
  const dzMap = Object.fromEntries(
    (deadZones || []).map((d) => [d.category_id || d.category, d]),
  );

  return topCats.map((cat) => {
    const opens = Number(cat.opens) || 0;
    const dz = dzMap[cat.id];
    const engagement = dz
      ? clampMetric(Number(dz.engagement_ratio) || safePct(dz.item_opens, dz.opens), 0, 100)
      : 50;
    const score = Math.min(100, Math.round(opens * 0.4 + engagement * 0.6));
    return {
      category_id: cat.id,
      category_name: formatCategoryName(cat.id),
      opens,
      engagement_pct: engagement,
      grade: grade(score),
      score,
    };
  });
}

/** Search intelligence */
export function buildSearchIntelligence(biData) {
  const top = biData?.top_searches || [];
  const lost = biData?.lost_searches || [];
  return {
    topSearches: top.slice(0, 8),
    lostSearches: lost.slice(0, 8),
    insights: [
      ...lost.slice(0, 3).map((s) => ({
        type: "unmet",
        query: s.query || s.q,
        count: s.count || s.sessions,
        message: `Guests searched "${s.query || s.q}" without finding a match.`,
      })),
      ...top.slice(0, 2).map((s) => ({
        type: "popular",
        query: s.query,
        count: s.count,
        message: `"${s.query}" is a top search term.`,
      })),
    ],
  };
}

/** Hourly intelligence */
export function buildTimeIntelligence(biData) {
  const byHour = biData?.by_hour || [];
  const peak = biData?.strongest_hour;
  const peakRow = byHour.length
    ? byHour.reduce((a, b) => (Number(a.count) > Number(b.count) ? a : b))
    : null;
  return {
    strongest_hour: peak,
    peak_bucket: peakRow,
    hourly: byHour,
    insight: peak != null
      ? `Peak menu activity around hour ${peak}:00. Align staffing and featured items to this window.`
      : "Collect more hourly data for peak-time recommendations.",
  };
}

/** Language intelligence */
export function buildLanguageIntelligence(biData) {
  const byLang = biData?.by_language || {};
  const lb = biData?.lang_behavior || {};
  const en = Number(byLang.en) || 0;
  const ar = Number(byLang.ar) || 0;
  const total = en + ar || 1;
  const arPct = safePct(ar, total);
  const enDur = Number(lb.en?.avg_duration) || 0;
  const arDur = Number(lb.ar?.avg_duration) || 0;
  const longer = arDur > enDur ? "Arabic" : "English";
  return {
    arabic_pct: arPct,
    english_pct: clampMetric(100 - arPct, 0, 100),
    longer_sessions: longer,
    insights: [
      arPct > 55 ? "Arabic guests dominate — keep Arabic UX as priority." : "Balanced bilingual audience.",
      `${longer} sessions last longer on average.`,
    ],
  };
}

/** Add-on intelligence */
export function buildAddonIntelligence(biData) {
  const byType = biData?.by_event_type || {};
  const itemOpens = Number(byType.item_open) || 0;
  const addonClicks = Number(byType.add_on_click) || 0;
  const pairs = biData?.top_addon_pairs || [];
  const rate = safePct(addonClicks, itemOpens);
  return {
    conversion_rate: rate,
    top_pairs: pairs.slice(0, 6),
    insight: rate < 12
      ? "Add-on conversion is low — improve visual upsell prompts."
      : "Add-on engagement is healthy — test premium pairings.",
  };
}

/** Full restaurant intelligence bundle */
export function buildRestaurantIntelligence(biData, foodicsContext = null, options = {}) {
  if (!biData) return null;

  const validation = validateInsightData(biData);
  const topItems = normalizeTopItems(biData?.top_items || []);
  const conversionRows = foodicsContext?.conversionRows || [];
  const funnels = buildItemFunnels({ ...biData, top_items: topItems }, conversionRows);
  const attention = buildAttentionScores(funnels);
  const searchAdvanced = buildAdvancedSearch(biData);
  const categoryGrades = buildCategoryGrades(biData, funnels, searchAdvanced);
  const placement = buildPlacementIntelligence(biData);
  const cannibalization = detectCannibalization(funnels);
  const operational = buildOperationalIntelligence(funnels, biData);
  const visibilityDiagnostics = buildVisibilityDiagnostics(biData);

  const visibilityReady = hasVisibilityTracking(topItems, biData?.by_event_type);
  const businessDay = biData?.business_day || {
    key: getBusinessDayRange().key,
    note: "Operational day 03:00 – 02:59 (Asia/Riyadh)",
  };
  const periodHours = options.periodHours ?? 0;

  return {
    funnels,
    attention,
    friction: buildFrictionInsights(biData, funnels),
    offlineSellers: buildOfflineSellers(funnels),
    categoryHealth: buildCategoryHealth(biData),
    categoryGrades,
    search: {
      ...buildSearchIntelligence(biData),
      advanced: searchAdvanced,
    },
    placement,
    cannibalization,
    operational,
    visibilityDiagnostics,
    time: buildTimeIntelligence(biData),
    language: buildLanguageIntelligence(biData),
    addons: buildAddonIntelligence(biData),
    visibilityReady,
    visibilityMessage: visibilityReady
      ? null
      : "Collecting visibility signals — impression data will sharpen guest attention metrics. Deep interest (opens) is used until then.",
    businessDay,
    periodLabel: periodLabelFromHours(periodHours),
    kpis: {
      sessions: validation.sessions,
      events: validation.events,
      impressions: Number(biData?.by_event_type?.item_impression) || 0,
      modal_opens: Number(biData?.by_event_type?.item_open) || 0,
      qr: Number(biData.by_event_type?.qr_session_start) || 0,
      today_qr: Number(biData?.today_qr_sessions) || 0,
      today_sessions: Number(biData?.today_unique_sessions) || 0,
      bounce_pct: safePct(Number(biData.bounce_sessions), validation.sessions),
      avg_time: Number(biData.avg_time_spent) || 0,
    },
    validation,
    hasFoodics: Boolean(foodicsContext?.hasImports),
    foodicsCompared: Boolean(foodicsContext?.previousBatch),
    generated_at: new Date().toISOString(),
  };
}
