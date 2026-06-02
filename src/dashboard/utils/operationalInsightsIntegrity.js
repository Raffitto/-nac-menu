/**
 * Operational dashboard AI insights — confidence-gated, no empty placeholders.
 */

import { formatCategoryName } from "./formatters";
import { buildOperationalTruth, computePeakHourFromByHour } from "../../lib/unifiedOperationalTruth";
import {
  INSIGHT_MIN_CONFIDENCE,
  insightPassesConfidence,
} from "../../lib/operationalMetricsIntegrity";
import {
  filterCustomerFacingCategories,
  isSyntheticCategoryId,
} from "../../lib/customerFacingAnalytics";

function insight({ text, type, source, value, confidence }) {
  return { text, type, source, value, confidence };
}

export function generateOperationalDashboardInsights(data) {
  if (!data || typeof data !== "object") return [];

  const truth = data._truth || buildOperationalTruth(data);
  const out = [];

  const topCategories = filterCustomerFacingCategories(truth.topCategories || []);
  if (topCategories.length > 0 && Number(topCategories[0].opens) > 0) {
    const top = topCategories[0];
    if (!isSyntheticCategoryId(top.id)) {
      out.push(
        insight({
          text: `${formatCategoryName(top.id)} leads category engagement with ${Number(top.opens).toLocaleString()} opens.`,
          type: "positive",
          source: "top_categories[0].opens",
          value: top.opens,
          confidence: (truth.sessions || 0) >= 10 ? 0.85 : 0.7,
        }),
      );
    }
  }

  const topItems = (data.top_items || truth.topItems || []).filter(
    (t) => (Number(t.opens ?? t.modal_opens) || 0) > 0,
  );
  if (topItems.length > 0 && topItems[0].opens >= 3) {
    const leader = topItems[0];
    out.push(
      insight({
        text: `${leader.name} leads item interest with ${leader.opens} opens this period.`,
        type: "positive",
        source: "top_items[0].opens",
        value: leader.opens,
        confidence: 0.8,
      }),
    );
  }

  const sessions = truth.sessions || 0;
  if (sessions > 0) {
    const bounceRate = truth.bouncePct;
    if (bounceRate > 30) {
      out.push(
        insight({
          text: `${bounceRate}% of sessions bounce — consider improving first-screen category clarity.`,
          type: "warning",
          source: "bounce_sessions / total_sessions",
          value: bounceRate,
          confidence: sessions >= 15 ? 0.78 : 0.65,
        }),
      );
    } else if (bounceRate < 15 && bounceRate >= 0) {
      out.push(
        insight({
          text: `Low bounce rate at ${bounceRate}% — guests are exploring the menu.`,
          type: "positive",
          source: "bounce_sessions / total_sessions",
          value: bounceRate,
          confidence: sessions >= 15 ? 0.75 : 0.65,
        }),
      );
    }
  }

  const scanChart = data.scan_chart;
  if (scanChart?.usesQrEventsOnly && Array.isArray(scanChart.rows) && scanChart.rows.length) {
    const peak = computePeakHourFromByHour(scanChart.rows);
    if (peak.label && Number(peak.count) > 0) {
      out.push(
        insight({
          text: `Peak menu QR activity around ${peak.label} (${peak.count} scans in that bucket).`,
          type: "neutral",
          source: "by_hour_qr peak",
          value: peak.count,
          confidence: 0.72,
        }),
      );
    }
  }

  const lang = data.session_language;
  if (lang?.total_sessions >= 10 && lang.english_pct + lang.arabic_pct > 0) {
    out.push(
      insight({
        text: `Session language split: ${lang.english_pct}% English · ${lang.arabic_pct}% Arabic (${lang.total_sessions} sessions).`,
        type: "neutral",
        source: lang.source,
        value: lang.total_sessions,
        confidence: 0.8,
      }),
    );
  }

  const lost = data.lost_searches || [];
  if (lost.length > 0 && lost[0].query) {
    const q = lost[0].query || lost[0].term;
    const cnt = Number(lost[0].count ?? lost[0].sess_count) || 0;
    if (cnt >= 2) {
      out.push(
        insight({
          text: `Top unmet search: “${q}” (${cnt} sessions) — consider menu coverage.`,
          type: "opportunity",
          source: "lost_searches[0]",
          value: cnt,
          confidence: 0.7,
        }),
      );
    }
  }

  const funnel = truth.funnel || {};
  const menuQr = Number(funnel.qr_scans) || 0;
  const itemOpens = Number(funnel.item_opens) || 0;
  if (menuQr >= 20 && itemOpens > 0) {
    const openRate = Math.round((itemOpens / menuQr) * 100);
    if (openRate < 25) {
      out.push(
        insight({
          text: `Only ${openRate}% of menu QR sessions open a dish — strengthen discovery on the first screen.`,
          type: "opportunity",
          source: "funnel.item_opens / funnel.qr_scans",
          value: openRate,
          confidence: 0.74,
        }),
      );
    }
  }

  return out.filter(insightPassesConfidence).slice(0, 8);
}

export { INSIGHT_MIN_CONFIDENCE };
