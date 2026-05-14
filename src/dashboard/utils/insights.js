import { formatCategoryName, formatDuration } from "./formatters";

export function generateInsights(data) {
  if (!data || typeof data !== "object") return [];

  const insights = [];

  const topCategories = data.top_categories || [];
  if (topCategories.length > 0) {
    const top = topCategories[0];
    insights.push({
      text: `${formatCategoryName(top.id)} generates the highest category engagement with ${Number(top.opens).toLocaleString()} opens.`,
      type: "positive",
    });
  }

  const langBehavior = data.lang_behavior;
  if (langBehavior?.en && langBehavior?.ar) {
    const enAvg = Number(langBehavior.en.avg_events) || 0;
    const arAvg = Number(langBehavior.ar.avg_events) || 0;
    if (arAvg > 0 && enAvg > 0 && arAvg !== enAvg) {
      const higher = arAvg > enAvg ? "Arabic" : "English";
      const diff = Math.round((Math.abs(arAvg - enAvg) / Math.min(arAvg, enAvg)) * 100);
      if (diff > 0) {
        insights.push({
          text: `${higher} users explore ${diff}% more items per session.`,
          type: "neutral",
        });
      }
    }

    const enDur = Number(langBehavior.en.avg_duration) || 0;
    const arDur = Number(langBehavior.ar.avg_duration) || 0;
    if (enDur > 0 && arDur > 0) {
      insights.push({
        text: `Arabic users spend ${formatDuration(arDur)} on average vs English at ${formatDuration(enDur)}.`,
        type: "neutral",
      });
    }
  }

  const topAddonPairs = data.top_addon_pairs || [];
  if (topAddonPairs.length > 0) {
    const pair = topAddonPairs[0];
    if (pair.item && pair.addon) {
      insights.push({
        text: `${pair.item} has the strongest add-on conversion with ${pair.addon}.`,
        type: "positive",
      });
    }
  }

  const totalSessions = Number(data.total_sessions) || 0;
  const bounceSessions = Number(data.bounce_sessions) || 0;
  if (totalSessions > 0) {
    const bounceRate = Math.round((bounceSessions / totalSessions) * 100);
    if (bounceRate > 30) {
      insights.push({
        text: `${bounceRate}% of sessions bounce — consider improving landing experience.`,
        type: "warning",
      });
    } else if (bounceRate < 15) {
      insights.push({
        text: `Low bounce rate at ${bounceRate}% — guests are exploring the menu.`,
        type: "positive",
      });
    }
  }

  const sessionQuality = data.session_quality;
  if (sessionQuality) {
    const power = Number(sessionQuality.power) || 0;
    if (power > 0) {
      insights.push({
        text: `${power} power users explored 12+ events per session.`,
        type: "positive",
      });
    }
  } else {
    const deepSessions = Number(data.deep_sessions) || 0;
    if (deepSessions > 0) {
      insights.push({
        text: `${deepSessions} power users explored 8+ events per session.`,
        type: "positive",
      });
    }
  }

  const lostSearches = data.lost_searches || [];
  if (lostSearches.length > 0) {
    const top = lostSearches[0];
    const query = top.query || top.term || top.q;
    if (query) {
      insights.push({
        text: `Top unmet search: '${query}' — consider adding this to the menu.`,
        type: "opportunity",
      });
    }
  }

  const strongestHour = data.strongest_hour;
  if (strongestHour != null) {
    const d = new Date(strongestHour);
    const label = Number.isNaN(d.getTime())
      ? strongestHour
      : d.toLocaleString(undefined, { hour: "numeric", hour12: true });
    insights.push({
      text: `Peak menu activity at ${label} — consider optimizing staffing.`,
      type: "neutral",
    });
  } else {
    const byHour = data.by_hour || [];
    if (byHour.length > 0) {
      const peak = byHour.reduce(
        (best, h) => ((Number(h.count) || 0) > (Number(best.count) || 0) ? h : best),
        byHour[0],
      );
      if (peak.hour) {
        const pd = new Date(peak.hour);
        const pLabel = Number.isNaN(pd.getTime())
          ? peak.hour
          : pd.toLocaleString(undefined, { hour: "numeric", hour12: true });
        insights.push({
          text: `Peak menu activity at ${pLabel} — consider optimizing staffing.`,
          type: "neutral",
        });
      }
    }
  }

  const returningSessions = Number(data.returning_sessions) || 0;
  const byEventType = data.by_event_type || {};
  const qrStarts = Number(byEventType.qr_session_start) || 0;
  if (returningSessions > 0 && qrStarts > 0) {
    const returningPct = Math.round((returningSessions / qrStarts) * 100);
    insights.push({
      text: `${returningPct}% of visitors are returning customers.`,
      type: returningPct > 20 ? "positive" : "neutral",
    });
  }

  return insights;
}
