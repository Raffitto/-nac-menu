/**
 * Operational Dashboard data integrity — canonical metric definitions and guards.
 * Applied after BI + review merge; no placeholder or misleading derived metrics.
 */

import { mergeTopItemsByName } from "../platform/engines/menuAggregationEngine";
import {
  buildHourlyChartData,
  resolveChartGranularityForHours,
} from "../dashboard/utils/hourlyPipeline";
import { rangeToHours } from "../dashboard/utils/rangeState";
import {
  applyCanonicalMenuSessionsToPayload,
  resolveCanonicalMenuSessions,
  reconcileRollupFunnelWithSessions,
  SCAN_CHART_EMPTY_MESSAGE,
} from "./customerFacingAnalytics";

export const INSIGHT_MIN_CONFIDENCE = 0.62;

/** Menu QR = canonical menu session count (qr_session_start), same as Sessions KPI. */
export function extractQrScanKpis(payload = {}) {
  const review = payload.review_kpis || {};
  const canon = resolveCanonicalMenuSessions(payload);
  const menuQrScans = canon.menuQrScans;

  const reviewQrScans =
    Number(review.review_qr_scans) ||
    Number(review.qr_scans) ||
    0;

  return {
    menu_qr_scans: menuQrScans,
    review_qr_scans: reviewQrScans,
    total_qr_scans: menuQrScans + reviewQrScans,
  };
}

/** Top Items: opens > 0 only; never pad with zero-engagement rows. */
export function filterRankedTopItems(items = [], { limit = 10, logContext = null } = {}) {
  const merged = mergeTopItemsByName(items);
  const withEngagement = merged.filter((t) => {
    const opens = Number(t.opens ?? t.modal_opens ?? t.item_opens) || 0;
    const impressions = Number(t.impressions) || 0;
    return opens > 0 || impressions > 0;
  });

  const ranked = withEngagement
    .filter((t) => (Number(t.opens ?? t.modal_opens) || 0) > 0)
    .sort(
      (a, b) =>
        (Number(b.opens ?? b.modal_opens) || 0) - (Number(a.opens ?? a.modal_opens) || 0) ||
        (Number(b.impressions) || 0) - (Number(a.impressions) || 0),
    )
    .slice(0, limit);

  const droppedZeroOpens = merged.filter(
    (t) => (Number(t.opens ?? t.modal_opens) || 0) === 0 && (Number(t.impressions) || 0) > 0,
  );
  const droppedEmpty = merged.length - withEngagement.length;

  if (logContext && (droppedZeroOpens.length > 0 || droppedEmpty > 0)) {
    publishIntegrityDebug({
      topItems: {
        inputCount: items.length,
        mergedCount: merged.length,
        rankedCount: ranked.length,
        droppedImpressionOnly: droppedZeroOpens.length,
        droppedEmpty,
        impressionOnlySample: droppedZeroOpens.slice(0, 3).map((t) => t.name),
      },
      ...logContext,
    });
  }

  return ranked;
}

/**
 * Session-based language — first loaded menu language per session (lang_behavior from SQL),
 * not raw language event counts (by_language).
 */
export function resolveSessionLanguageStats(payload = {}) {
  const lb = payload.lang_behavior || {};
  const enSessions = Number(lb.en?.sessions) || 0;
  const arSessions = Number(lb.ar?.sessions) || 0;
  const unknownSessions = Number(lb.unknown?.sessions) || 0;
  let en = enSessions;
  let ar = arSessions;
  let unknown = unknownSessions;

  if (en + ar + unknown === 0) {
    const fallback = payload.by_language_sessions || payload.by_language || {};
    en = Number(fallback.en) || 0;
    ar = Number(fallback.ar) || 0;
    unknown = Number(fallback.unknown) || 0;
  }

  const total = en + ar + unknown;
  if (total <= 0) {
    return {
      en_sessions: 0,
      ar_sessions: 0,
      unknown_sessions: 0,
      total_sessions: 0,
      english_pct: 0,
      arabic_pct: 0,
      source: "none",
    };
  }

  const englishPct = Math.round((en / total) * 100);
  const arabicPct = Math.round((ar / total) * 100);

  return {
    en_sessions: en,
    ar_sessions: ar,
    unknown_sessions: unknown,
    total_sessions: total,
    english_pct: englishPct,
    arabic_pct: arabicPct,
    source: enSessions + arSessions > 0 ? "lang_behavior" : "by_language_sessions_fallback",
  };
}

/** QR scan events only — prefers by_hour_qr from RPC; never scales generic event volume. */
export function resolveScanChartBuckets(payload = {}, hours = 24) {
  const qrRaw = Array.isArray(payload.by_hour_qr) ? payload.by_hour_qr : null;
  const hasQrBuckets = qrRaw && qrRaw.some((r) => (Number(r.count) || 0) > 0);

  const sourceRows = hasQrBuckets ? qrRaw : [];
  const chart = buildHourlyChartData(sourceRows, hours);
  const gran = resolveChartGranularityForHours(hours);

  let title;
  if (gran === "hour") {
    title = "Menu QR scans by hour (today)";
  } else if (hours >= 720) {
    title = "Menu QR scans per day (month)";
  } else {
    title = "Menu QR scans per day (7D)";
  }

  return {
    rows: chart.rows,
    granularity: chart.granularity,
    title,
    usesQrEventsOnly: hasQrBuckets,
    emptyReason: hasQrBuckets ? null : SCAN_CHART_EMPTY_MESSAGE,
  };
}

function mapStageMetrics(stages, menuQr) {
  const MENU_KEYS = new Set(["qr_scans", "category_opens", "item_opens", "addon_clicks"]);
  const maxVal = Math.max(...stages.map((s) => s.value), 1);

  return stages.map((stage, i) => {
    const prev = i > 0 ? stages[i - 1].value : null;
    let convPct = null;
    let dropPct = null;
    let convNote = "entry";

    if (MENU_KEYS.has(stage.key) && i > 0 && prev > 0) {
      convPct = Math.min(100, Math.max(0, (stage.value / prev) * 100));
      dropPct = Math.max(0, 100 - convPct);
      convNote = "step";
      if (stage.value > prev) {
        convNote = "parallel";
        convPct = Math.min(100, (stage.value / menuQr) * 100);
        dropPct = null;
      }
    } else if (stage.key === "review_redirect" && menuQr > 0) {
      convPct = Math.min(100, (stage.value / menuQr) * 100);
      convNote = "of menu QR";
    } else if (stage.key === "google_review_open") {
      const rr = Number(stages.find((s) => s.key === "review_redirect")?.value) || 0;
      const denom = rr > 0 ? rr : menuQr;
      if (denom > 0) {
        convPct = Math.min(100, (stage.value / denom) * 100);
        convNote = rr > 0 ? "of review redirects" : "of menu QR";
      }
    }

    return {
      ...stage,
      widthPct: (stage.value / maxVal) * 100,
      convPct,
      dropPct,
      convNote,
    };
  });
}

/** Menu journey — unique sessions per stage. */
export function buildMenuFunnelStageMetrics(funnel = {}) {
  const menuQr = Number(funnel.qr_scans) || 0;
  const stages = [
    { key: "qr_scans", label: "QR Scan", value: menuQr },
    { key: "category_opens", label: "Category Open", value: Number(funnel.category_opens) || 0 },
    { key: "item_opens", label: "Item Open", value: Number(funnel.item_opens) || 0 },
    { key: "addon_clicks", label: "Add-on Interaction", value: Number(funnel.addon_clicks) || 0 },
  ];
  return mapStageMetrics(stages, menuQr);
}

/** Review funnel — separate path (not sequential menu steps). */
export function buildReviewFunnelStageMetrics(funnel = {}) {
  const menuQr = Number(funnel.qr_scans) || 0;
  const stages = [
    {
      key: "review_redirect",
      label: "Review Redirect",
      value: Number(funnel.review_redirect) || 0,
    },
    {
      key: "google_review_open",
      label: "Google Review Open",
      value: Number(funnel.google_review_open) || 0,
    },
  ];
  return mapStageMetrics(stages, menuQr);
}

/** @deprecated Use buildMenuFunnelStageMetrics + buildReviewFunnelStageMetrics */
export function buildFunnelStageMetrics(funnel = {}) {
  return [
    ...buildMenuFunnelStageMetrics(funnel),
    ...buildReviewFunnelStageMetrics(funnel),
  ];
}

export function insightPassesConfidence(insight) {
  if (!insight || typeof insight !== "object") return false;
  const conf = Number(insight.confidence);
  if (!Number.isFinite(conf)) return false;
  if (conf < INSIGHT_MIN_CONFIDENCE) return false;
  const text = String(insight.text || "").trim();
  if (!text || text.includes("—") || text.includes("undefined")) return false;
  if (!insight.source || insight.value == null) return false;
  return true;
}

export function filterDisplayInsights(insights = []) {
  return insights.filter(insightPassesConfidence);
}

export function publishIntegrityDebug(fragment) {
  if (typeof window === "undefined") return;
  window.__NAC_PIPELINE_DEBUG__ = window.__NAC_PIPELINE_DEBUG__ || {};
  window.__NAC_DASHBOARD_AUDIT__ = {
    ...(window.__NAC_DASHBOARD_AUDIT__ || {}),
    updatedAt: new Date().toISOString(),
    ...fragment,
  };
}

/**
 * Full payload hydration for operational dashboard integrity.
 */
export function applyOperationalIntegrityToPayload(payload = {}, options = {}) {
  if (!payload || typeof payload !== "object") return payload;

  const hours = options.hours ?? rangeToHours("today");
  const withCanon = applyCanonicalMenuSessionsToPayload(payload);
  const funnel = {
    ...withCanon.funnel,
    review_redirect: Number(payload.funnel?.review_redirect) || 0,
    google_review_open: Number(payload.funnel?.google_review_open) || 0,
  };

  const qrKpis = extractQrScanKpis({ ...withCanon, funnel });
  const langStats = resolveSessionLanguageStats(payload);
  const top_items = filterRankedTopItems(payload.top_items || [], {
    limit: 10,
    logContext: { hours, branch: options.branch },
  });
  const scanChart = resolveScanChartBuckets(payload, hours);

  const enriched = {
    ...withCanon,
    funnel,
    ...qrKpis,
    session_language: langStats,
    top_items,
    scan_chart: scanChart,
    funnel_stage_metrics: {
      menu: buildMenuFunnelStageMetrics(funnel),
      review: buildReviewFunnelStageMetrics(funnel),
    },
  };

  publishDashboardTrustAudit(enriched, { hours, ...options });

  return enriched;
}

export function publishDashboardTrustAudit(data, options = {}) {
  const qr = extractQrScanKpis(data);
  const lang = resolveSessionLanguageStats(data);
  const scanChart = data.scan_chart || resolveScanChartBuckets(data, options.hours);

  const widgets = [
    {
      widget: "Executive — Menu QR Scans",
      source: "menu_events.funnel.qr_scans",
      aggregation: "distinct session_id",
      sampleCount: qr.menu_qr_scans,
      confidence: qr.menu_qr_scans > 0 ? "high" : "none",
    },
    {
      widget: "Executive — Review QR Scans",
      source: "review_events.qr_scan",
      aggregation: "count qr_scan",
      sampleCount: qr.review_qr_scans,
      confidence: qr.review_qr_scans > 0 ? "high" : "none",
    },
    {
      widget: "Scans by Hour/Day chart",
      source: scanChart.usesQrEventsOnly ? "menu_events.by_hour_qr" : "unavailable",
      aggregation: "qr_session_start per bucket",
      sampleCount: scanChart.rows.reduce((s, r) => s + (Number(r.count) || 0), 0),
      confidence: scanChart.usesQrEventsOnly ? "high" : "none",
      note: scanChart.emptyReason,
    },
    {
      widget: "Top Items",
      source: "menu_events item_open",
      aggregation: "count opens; filter opens > 0",
      sampleCount: (data.top_items || []).length,
      confidence: (data.top_items || []).length > 0 ? "high" : "none",
    },
    {
      widget: "Language Usage",
      source: lang.source,
      aggregation: "first session language (lang_behavior.sessions)",
      sampleCount: lang.total_sessions,
      confidence: lang.total_sessions >= 5 ? "high" : lang.total_sessions > 0 ? "medium" : "none",
    },
    {
      widget: "Customer Journey funnel",
      source: "menu funnel (sessions) + review_events",
      aggregation: "distinct sessions; review path separate",
      sampleCount: Number(data.funnel?.qr_scans) || 0,
      confidence: "medium",
    },
    {
      widget: "AI Insights",
      source: "operationalInsights + guards",
      aggregation: "thresholded confidence",
      sampleCount: null,
      confidence: "guarded",
    },
  ];

  publishIntegrityDebug({ widgets, hours: options.hours });
}
