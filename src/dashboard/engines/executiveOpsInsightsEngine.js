/**
 * Team-level operational insights — percentages, comparisons, revenue impact.
 */

export function buildExecutiveOpsInsights({
  team = {},
  waiters = [],
  attachment = {},
  timeShift = null,
  awards = {},
}) {
  const insights = [];
  const risks = [];
  const wins = [];

  if (team.lowValueBevPct >= 50 && team.bevGross > 0) {
    risks.push({
      title: "Soft drinks dominate beverage mix",
      body: `Low-value beverages (Pepsi, 7Up, water) represent ${team.lowValueBevPct}% of drink revenue (${Math.round(team.lowValueBevGross).toLocaleString()} SAR). Premium mocktails and lemonades (~29 SAR) remain under-penetrated at ${team.premiumBevPct}%.`,
      impact: "Estimated margin gap: converting 20% of soft drink orders to premium drinks could add 4–8% beverage revenue.",
      severity: "high",
    });
  }

  if (team.premiumBevPct < 20 && team.bevGross > 5000) {
    risks.push({
      title: "Mocktail penetration critically low",
      body: `Premium beverage mix is ${team.premiumBevPct}% vs operational target of 25%+. Dinner and brunch tables are defaulting to cola and Pepsi instead of signature drinks.`,
      impact: "Priority coaching: premium beverage scripts on all PM shifts.",
      severity: "high",
    });
  }

  const weakMod = waiters.filter((w) => w.modifierAttachPct < 10 && w.quantity >= 400);
  if (weakMod.length) {
    risks.push({
      title: "Modifier monetization underperforms volume",
      body: `${weakMod.map((w) => w.waiter).join(", ")} run high guest counts with modifier attach below 10%. Revenue is volume-driven, not margin-optimized.`,
      impact: "Structured modifier timing required before ticket close on every main.",
      severity: "medium",
    });
  }

  if (team.breakfastPct >= 15) {
    wins.push({
      title: "Breakfast drives premium food conversion",
      body: `Breakfast and egg-line items contribute ${team.breakfastPct}% of gross (${Math.round(team.breakfastGross).toLocaleString()} SAR). Morning daypart is the strongest premium food conversion window.`,
      impact: "Protect AM staffing and breakfast upsell focus for morning-heavy servers.",
      severity: "low",
    });
  }

  const bfLeader = awards?.awards?.find((a) => a.id === "breakfast")?.winner;
  if (bfLeader) {
    wins.push({
      title: `${bfLeader} leads breakfast conversion`,
      body: "Breakfast and brunch items are concentrated on morning-shift performers — align coaching to daypart, not generic beverage pushes.",
      impact: null,
      severity: "low",
    });
  }

  (attachment?.missedUpsells || []).slice(0, 2).forEach((m) => {
    risks.push({
      title: `Missed upsell: ${m.label}`,
      body: `${m.attachmentRate}% attach vs ${m.expectedPct}% target on ${m.parentOrders} parent orders. Est. gap ~${Math.round(m.estimatedLostRevenue).toLocaleString()} SAR.`,
      impact: "Operational fix: pre-close modifier script on eligible mains.",
      severity: m.opportunityScore >= 50 ? "high" : "medium",
    });
  });

  if (timeShift?.peakDaypart) {
    wins.push({
      title: `${timeShift.peakDaypart.label} is peak revenue window`,
      body: "Align staffing, premium beverage prompts, and modifier coaching to this daypart.",
      impact: null,
      severity: "low",
    });
  }

  const topPrem = awards?.awards?.find((a) => a.id === "premium_bev");
  if (topPrem?.winner) {
    wins.push({
      title: `${topPrem.winner} leads premium beverage mix`,
      body: `Use as mentor for mocktail and lemonade upsell during ${timeShift?.peakDaypart?.label || "peak"} service.`,
      impact: null,
      severity: "low",
    });
  }

  [...risks, ...wins].forEach((item, i) => {
    insights.push({
      id: `ops-${i}`,
      type: item.severity === "high" ? "risk" : "win",
      confidence: item.severity === "high" ? "high" : "medium",
      title: item.title,
      body: item.body + (item.impact ? ` ${item.impact}` : ""),
      severity: item.severity,
    });
  });

  return { insights, risks, wins };
}
