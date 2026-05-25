/**
 * Operational insights grounded in unified truth metrics — specific, not generic filler.
 */

import { formatCategoryName, formatDuration } from "./formatters";
import { buildOperationalTruth, computePeakHourFromByHour } from "../../lib/unifiedOperationalTruth";

export function generateOperationalInsights(data) {
  if (!data || typeof data !== "object") return [];

  const truth = data._truth || buildOperationalTruth(data);
  const insights = [];
  const topItems = truth.topItems || [];
  const funnel = truth.funnel || {};

  if (topItems.length > 0) {
    const leader = topItems[0];
    const addonPairs = truth.topAddonPairs || [];
    const leaderAddons = addonPairs.filter(
      (p) =>
        (p.item || "").toLowerCase() === (leader.name || "").toLowerCase(),
    );
    const addonClicks = leaderAddons.reduce((s, p) => s + (Number(p.clicks) || 0), 0);

    if (leader.impressions >= 15 && leader.opens > 0 && addonClicks === 0) {
      insights.push({
        text: `${leader.name} dominates visibility (${leader.impressions} impressions) but shows weak add-on attachment — consider pairing modifiers in-modal.`,
        type: "opportunity",
      });
    } else if (leader.opens >= 5) {
      insights.push({
        text: `${leader.name} leads guest interest with ${leader.opens} item opens this period.`,
        type: "positive",
      });
    }
  }

  const highImpLowOpen = topItems.filter(
    (t) => (t.impressions || 0) >= 20 && (t.opens || 0) > 0 && (t.opens || 0) / (t.impressions || 1) < 0.08,
  );
  if (highImpLowOpen.length > 0) {
    const name = highImpLowOpen[0].name;
    insights.push({
      text: `${name} sees high impressions with low open rate — photo, price, or placement may be creating resistance.`,
      type: "warning",
    });
  }

  const cats = truth.topCategories || [];
  if (cats.length >= 2) {
    const weak = [...cats].sort((a, b) => (a.opens || 0) - (b.opens || 0))[0];
    const strong = cats[0];
    if (weak && strong && weak.id !== strong.id && (weak.opens || 0) < (strong.opens || 0) * 0.35) {
      insights.push({
        text: `${formatCategoryName(weak.id)} underperforms ${formatCategoryName(strong.id)} on category opens — review menu order and hero placement.`,
        type: "opportunity",
      });
    }
  }

  if ((truth.addonInteractions || 0) > 0 && (truth.topAddonPairs || []).length > 0) {
    const topPair = truth.topAddonPairs[0];
    if (topPair.item && topPair.addon) {
      insights.push({
        text: `${topPair.addon} on ${topPair.item} drives the strongest modifier interaction (${topPair.clicks} taps).`,
        type: "positive",
      });
    }
  } else if (truth.itemOpens >= 10 && truth.addonInteractions === 0) {
    insights.push({
      text: "Guests open items but rarely tap add-ons — upsell prompts may need stronger in-modal placement.",
      type: "opportunity",
    });
  }

  const peak =
    truth.peakHourLabel != null
      ? { label: truth.peakHourLabel, count: truth.peakHourCount }
      : computePeakHourFromByHour(truth.hourly || data.by_hour || []);
  if (peak.label && peak.count > 0) {
    const peakH = truth.peakHour ?? data.strongest_hour;
    const evening = typeof peakH === "number" && peakH >= 18;
    insights.push({
      text: evening
        ? `Evening menu activity peaks around ${peak.label} (${peak.count} events in that hour) — align staffing and dessert visibility for late service.`
        : `Peak menu activity around ${peak.label} (${peak.count} events) — matches hourly chart intensity.`,
      type: "neutral",
    });
  }

  if (truth.sessions > 0) {
    if (truth.bouncePct >= 25 && truth.bouncePct <= 55) {
      insights.push({
        text: `${truth.bouncePct}% bounce rate — typical for QR menu traffic; focus on first-screen category clarity.`,
        type: "neutral",
      });
    } else if (truth.bouncePct < 12 && truth.deepPct >= 8) {
      insights.push({
        text: `Strong exploration depth — only ${truth.bouncePct}% bounce with ${truth.deepPct}% deep sessions.`,
        type: "positive",
      });
    }
  }

  if (truth.returningGuests > 0 && truth.qrScans > 0) {
    const pct = Math.round((truth.returningGuests / truth.qrScans) * 100);
    if (pct >= 8) {
      insights.push({
        text: `${pct}% of sessions show returning guest behavior — loyalty signals are present in this period.`,
        type: pct >= 15 ? "positive" : "neutral",
      });
    }
  }

  const sq = truth.sessionQuality || {};
  const power = Number(sq.power) || 0;
  const bounceTier = Number(sq.bounce) || 0;
  if (power > 0 && truth.sessions > 0 && power / truth.sessions > 0.45) {
    insights.push({
      text: "Power-user share looks elevated — verify session duration caps if this period included long idle tabs.",
      type: "warning",
    });
  } else if (bounceTier > 0 && truth.avgTimeSpent > 0 && truth.avgTimeSpent <= 360) {
    insights.push({
      text: `Typical guest stay ${formatDuration(truth.avgTimeSpent)} — menu engagement aligns with casual dining QR behavior.`,
      type: "neutral",
    });
  }

  if (Number(funnel.item_opens) > 0 && Number(funnel.qr_scans) > 0) {
    const openRate = Math.round((funnel.item_opens / funnel.qr_scans) * 100);
    if (openRate < 25) {
      insights.push({
        text: `Only ${openRate}% of sessions open a dish — hero items and category rails may need stronger discovery cues.`,
        type: "opportunity",
      });
    }
  }

  return insights.slice(0, 8);
}
