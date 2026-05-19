/**
 * 30-second management summary for executive PDF cover.
 */

export function buildExecutiveSummary({
  waiters = {},
  team = {},
  awards = {},
  attachment = {},
  opsInsights = {},
}) {
  const list = waiters?.waiters || [];
  const grand = waiters?.grandTotals || {};
  const top = list[0] || awards?.ranked?.[0];
  const bfAward = awards?.awards?.find((a) => a.id === "breakfast");
  const pmAward = awards?.awards?.find((a) => a.id === "pm");
  const avgAward = awards?.awards?.find((a) => a.id === "avg_ticket");
  const modAward = awards?.awards?.find((a) => a.id === "modifier");
  const missed = attachment?.missedUpsells?.[0];
  const topRisk = opsInsights?.risks?.[0];
  const topWin = opsInsights?.wins?.[0];

  const missedRev = (attachment?.missedUpsells || []).reduce(
    (s, m) => s + (Number(m.estimatedLostRevenue) || 0),
    0,
  );

  return {
    totalRevenue: grand.gross_sales || 0,
    totalQty: grand.quantity || 0,
    topWaiter: top?.waiter || "—",
    topWaiterSales: top?.gross_sales || top?.primarySales || 0,
    strongestBreakfast: bfAward?.winner || "—",
    strongestPM: pmAward?.winner || "—",
    highestAvgTicket: avgAward?.winner || "—",
    highestAvgTicketValue: avgAward?.value || 0,
    bestModifier: modAward?.winner || "—",
    bestModifierPct: modAward?.value || 0,
    weakestModifierCategory:
      list.filter((w) => w.modifierAttachPct < 10).map((w) => w.waiter).slice(0, 2).join(", ") || "—",
    biggestMissedUpsell: missed?.label || "—",
    estimatedMissedRevenue: missedRev,
    premiumBevPenetration: team.premiumBevPct || 0,
    lowValueBevShare: team.lowValueBevPct || 0,
    bestWin: topWin?.title || "—",
    biggestConcern: topRisk?.title || "—",
    operationalScoreLeader: awards?.topOperational?.waiter || "—",
    operationalScore: awards?.topOperational?.operationalScore || 0,
  };
}
