/**
 * Calibrated team insights — confidence-gated, no fake wins on low-margin behavior.
 */
import {
  CONFIDENCE,
  gateTeamInsight,
  downgradeEstimatedImpact,
  isLowValueBeverageDominant,
} from "./intelligenceCalibration";

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
  const calibratedTeam = team;
  const bevConf = calibratedTeam.hasReliableBevData ? CONFIDENCE.HIGH : CONFIDENCE.MODERATE;

  if (calibratedTeam.lowValueBevPct >= 50 && calibratedTeam.bevGross > 0) {
    const item = gateTeamInsight({
      confidence: bevConf,
      minConfidence: CONFIDENCE.MODERATE,
      title: "Soft drinks dominate beverage mix",
      body: `Low-value beverages (Pepsi, 7Up, water) are ${calibratedTeam.lowValueBevPct}% of drink revenue (${Math.round(calibratedTeam.lowValueBevGross).toLocaleString()} SAR). Premium mocktails and lemonades sit at ${calibratedTeam.premiumBevPct}% — this is a margin issue, not a volume win.`,
      impact: downgradeEstimatedImpact(
        "Converting a share of soft drink orders to premium drinks improves beverage margin mix.",
        bevConf,
      ),
      severity: "high",
    });
    if (item) risks.push(item);
  }

  if (calibratedTeam.premiumBevPct < 20 && calibratedTeam.bevGross > 5000 && bevConf !== CONFIDENCE.LOW) {
    const item = gateTeamInsight({
      confidence: CONFIDENCE.MODERATE,
      minConfidence: CONFIDENCE.MODERATE,
      title: "Premium beverage penetration below target",
      body: `Premium drink mix is ${calibratedTeam.premiumBevPct}% vs operational target ~25%+. PM and brunch tables are still defaulting to cola and Pepsi where mocktails are available.`,
      impact: "Floor priority: premium beverage first suggestion on dinner and weekend covers.",
      severity: "high",
    });
    if (item) risks.push(item);
  }

  const weakMod = waiters.filter(
    (w) => w.modifierAttachPct < 10 && w.quantity >= 400 && (w.confidence?.modifier || CONFIDENCE.MODERATE) !== CONFIDENCE.LOW,
  );
  if (weakMod.length >= 2) {
    const item = gateTeamInsight({
      confidence: CONFIDENCE.HIGH,
      minConfidence: CONFIDENCE.MODERATE,
      title: "Modifier monetization underperforms volume",
      body: `${weakMod.map((w) => w.waiter).join(", ")} run high covers with modifier attach below 10%. Gross is volume-driven, not margin-optimized.`,
      impact: "Require paid add-on attempt before ticket close on every main.",
      severity: "medium",
    });
    if (item) risks.push(item);
  }

  const volumeThin = waiters.filter((w) => (w.revenueQualityScore || 0) < 45 && (w.quantity || 0) >= 450);
  if (volumeThin.length) {
    const item = gateTeamInsight({
      confidence: CONFIDENCE.MODERATE,
      minConfidence: CONFIDENCE.MODERATE,
      title: "High quantity, weak revenue quality",
      body: `${volumeThin.map((w) => w.waiter).join(", ")} show elevated units with low revenue quality scores — Pepsi-heavy or thin avg checks are diluting gross.`,
      impact: "Coach margin levers (premium bev + modifiers), not more covers.",
      severity: "medium",
    });
    if (item) risks.push(item);
  }

  const topRq = [...waiters].sort((a, b) => (b.revenueQualityScore || 0) - (a.revenueQualityScore || 0))[0];
  if (topRq && (topRq.revenueQualityScore || 0) >= 58 && !isLowValueBeverageDominant(topRq)) {
    const item = gateTeamInsight({
      confidence: CONFIDENCE.HIGH,
      minConfidence: CONFIDENCE.MODERATE,
      title: `${topRq.waiter} leads revenue quality`,
      body: `Revenue quality score ${topRq.revenueQualityScore}/100 — premium mix, modifiers, and avg check align. Use as benchmark for floor standards.`,
      impact: null,
      severity: "low",
    });
    if (item) wins.push(item);
  }

  if (calibratedTeam.breakfastPct >= 18 && calibratedTeam.hasReliableShiftData) {
    const item = gateTeamInsight({
      confidence: CONFIDENCE.MODERATE,
      minConfidence: CONFIDENCE.MODERATE,
      title: "Breakfast contributes meaningful food gross",
      body: `Breakfast and egg-line items are ${calibratedTeam.breakfastPct}% of team gross (${Math.round(calibratedTeam.breakfastGross).toLocaleString()} SAR). Morning daypart supports premium food conversion when staffed correctly.`,
      impact: "Protect AM coverage; coach premium conversion within breakfast traffic — not generic beverage pushes on AM servers.",
      severity: "low",
    });
    if (item) wins.push(item);
  }

  const bfLeader = awards?.awards?.find((a) => a.id === "breakfast");
  if (bfLeader?.winner && calibratedTeam.hasReliableShiftData) {
    const winner = waiters.find((w) => w.waiter === bfLeader.winner);
    if (winner && !winner.calibration?.shouldNotCelebrateBreakfast) {
      const item = gateTeamInsight({
        confidence: CONFIDENCE.MODERATE,
        title: `${bfLeader.winner} leads breakfast gross`,
        body: "Breakfast sales concentration is notable — align coaching to premium conversion within that traffic.",
        impact: null,
        severity: "low",
      });
      if (item) wins.push(item);
    }
  }

  (attachment?.missedUpsells || []).slice(0, 2).forEach((m) => {
    if ((m.parentOrders || 0) < 30) return;
    const item = gateTeamInsight({
      confidence: m.parentOrders >= 80 ? CONFIDENCE.HIGH : CONFIDENCE.MODERATE,
      minConfidence: CONFIDENCE.MODERATE,
      title: `Attachment gap: ${m.label}`,
      body: `${m.attachmentRate}% attach vs ${m.expectedPct}% target on ${m.parentOrders} parent orders.`,
      impact: `Observed gap ~${Math.round(m.estimatedLostRevenue).toLocaleString()} SAR — validate against next Foodics export before treating as fixed loss.`,
      severity: m.opportunityScore >= 50 ? "high" : "medium",
    });
    if (item) risks.push(item);
  });

  if (timeShift?.peakDaypart && calibratedTeam.hasReliableBevData) {
    const item = gateTeamInsight({
      confidence: CONFIDENCE.MODERATE,
      title: `${timeShift.peakDaypart.label} is peak imported window`,
      body: "Staff premium beverage and modifier coaching should align to this window — not generic all-day scripts.",
      impact: null,
      severity: "low",
    });
    if (item) wins.push(item);
  }

  const topPrem = awards?.awards?.find((a) => a.id === "premium_bev");
  if (topPrem?.winner) {
    const w = waiters.find((x) => x.waiter === topPrem.winner);
    if (w && !isLowValueBeverageDominant(w) && (w.ops?.premiumBevPct || 0) >= 15) {
      const item = gateTeamInsight({
        confidence: w.confidence?.beverageMix || CONFIDENCE.MODERATE,
        title: `${topPrem.winner} leads premium beverage mix`,
        body: `${w.ops?.premiumBevPct}% premium drink revenue — credible margin behavior, not raw drink count.`,
        impact: null,
        severity: "low",
      });
      if (item) wins.push(item);
    }
  }

  [...risks, ...wins].filter(Boolean).forEach((item, i) => {
    insights.push({
      id: `ops-${i}`,
      type: item.severity === "high" ? "risk" : "win",
      confidence: item.confidence,
      confidenceLabel: item.confidenceLabel,
      title: item.title,
      body: item.body + (item.impact ? ` ${item.impact}` : ""),
      severity: item.severity,
    });
  });

  return { insights, risks: risks.filter(Boolean), wins: wins.filter(Boolean) };
}
