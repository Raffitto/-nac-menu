/**
 * Operational narrative insights for Visual Intelligence OS.
 */
export function buildVisualInsights({
  attachment,
  timeShift,
  heat,
  menuEngineering,
  waiters,
}) {
  const insights = [];

  (attachment?.missedUpsells || []).slice(0, 3).forEach((m) => {
    insights.push({
      id: `missed-${m.id}`,
      type: "opportunity",
      confidence: m.opportunityScore >= 50 ? "high" : "medium",
      title: `Missed upsell: ${m.label}`,
      body: `${m.parentOrders.toLocaleString()} parent orders · ${m.attachmentRate}% attachment vs ${m.expectedPct}% expected. Est. gap ~${m.estimatedLostRevenue.toLocaleString()} SAR.`,
      trend: "down",
    });
  });

  if (timeShift?.peakDaypart) {
    insights.push({
      id: "peak-daypart",
      type: "pattern",
      confidence: "high",
      title: `${timeShift.peakDaypart.label} drives revenue`,
      body: `Peak daypart by imported sales volume. Align staffing and modifier prompts for this window.`,
      trend: "up",
    });
  }

  const lateDessert = (timeShift?.conversionByHour || []).filter((h) => h.hour >= 21 && h.conversion > 0);
  if (lateDessert.length) {
    insights.push({
      id: "late-dessert",
      type: "pattern",
      confidence: "medium",
      title: "Late-night conversion signal",
      body: "Menu-to-sales conversion strengthens after 9 PM — prioritize dessert and beverage prompts.",
      trend: "up",
    });
  }

  (heat?.highInterestLowSales || []).slice(0, 2).forEach((h) => {
    insights.push({
      id: `hil-${h.item_name}`,
      type: "warning",
      confidence: "medium",
      title: `High interest · low sales: ${h.item_name}`,
      body: `${h.views} menu opens with only ${h.orders} orders — investigate pricing, placement, or photography.`,
      trend: "flat",
    });
  });

  const stars = (menuEngineering || []).filter((m) => m.quadrant === "Star").slice(0, 1);
  stars.forEach((s) => {
    insights.push({
      id: `star-${s.item_name}`,
      type: "win",
      confidence: "high",
      title: `Star performer: ${s.item_name}`,
      body: s.suggestion || "Feature prominently across menu surfaces.",
      trend: "up",
    });
  });

  if (waiters?.topUpseller) {
    insights.push({
      id: "top-waiter",
      type: "win",
      confidence: "high",
      title: `Top upseller: ${waiters.topUpseller.waiter}`,
      body: `${waiters.topUpseller.net_sales.toLocaleString()} SAR · ${waiters.topUpseller.modifierAttachPct}% modifier attachment.`,
      trend: "up",
    });
  }

  if (!insights.length) {
    insights.push({
      id: "collecting",
      type: "pattern",
      confidence: "low",
      title: "Collecting intelligence signals",
      body: "Import Foodics sales and accumulate menu sessions to unlock richer attachment and heat insights.",
      trend: "flat",
    });
  }

  return insights;
}
