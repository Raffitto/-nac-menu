/**
 * Daily executive operational briefing — rules-only, consulting tone.
 */

import { branchDisplayName } from "../utils/rangeState";

function pickStrongest(statusRows = []) {
  return [...statusRows]
    .filter((b) => b.operational_score != null)
    .sort((a, b) => b.operational_score - a.operational_score)[0];
}

function pickWeakest(statusRows = []) {
  return [...statusRows]
    .filter((b) => b.operational_score != null)
    .sort((a, b) => a.operational_score - b.operational_score)[0];
}

function topPerformerToday(staffByBranch = {}, comparison = []) {
  let best = null;
  comparison.forEach((row) => {
    const staff = staffByBranch[row.branch_id] || [];
    staff.forEach((s) => {
      const score = (s.google || 0) * 2 + (s.scans || 0);
      if (!best || score > best.score) {
        best = {
          name: s.name,
          branch_id: row.branch_id,
          branch_name: branchDisplayName(row.branch_id),
          google: s.google || 0,
          scans: s.scans || 0,
          score,
        };
      }
    });
  });
  return best;
}

/**
 * @param {object} input
 */
export function buildDailyExecutiveBrief(input = {}) {
  const status = input.branchStatus || [];
  const momentum = input.momentum || {};
  const staffInsights = input.staffInsights || [];
  const networkScore = input.networkScore;
  const comparison = input.branchComparison || [];
  const staffByBranch = input.staffByBranch || {};

  const strongest = pickStrongest(status);
  const weakest = pickWeakest(status);
  const topStaff = topPerformerToday(staffByBranch, comparison);

  const monthGain = momentum.monthly_review_gain;
  const monthLine =
    monthGain != null && !momentum.insufficient_data
      ? `Network review growth estimate: ${monthGain >= 0 ? "+" : ""}${monthGain} this month.`
      : "Review growth tracking requires more snapshot history.";

  const coaching = staffInsights.find((i) => i.severity === "high") || staffInsights[0];
  const coachingFocus = coaching
    ? coaching.text
    : momentum.momentum === "Declining"
      ? "Prioritize bill-close Google redirect coaching network-wide."
      : "Sustain balanced staff participation and verbal CTA discipline.";

  const concern =
    weakest?.health?.id === "critical" || weakest?.health?.id === "risk"
      ? `${weakest.branch_name} is the primary operational concern (score ${weakest.operational_score}).`
      : weakest?.insufficient_data
        ? "One or more branches lack sufficient handoff volume for scoring."
        : "Monitor conversion breadth where participation is high but Google completion lags.";

  const recommended =
    strongest?.branch_name && weakest?.branch_name
      ? `Replicate ${strongest.branch_name} handoff discipline in ${weakest.branch_name} this period.`
      : "Expand card presentation coverage during peak service windows.";

  return {
    strongest_branch: strongest
      ? `${strongest.branch_name} (score ${strongest.operational_score}, ${strongest.tier_label || strongest.health?.label})`
      : "Building baseline — not enough branch scores yet",
    weakest_branch: weakest
      ? `${weakest.branch_name} (score ${weakest.operational_score})`
      : "Building baseline — not enough branch scores yet",
    momentum_summary: momentum.insufficient_data
      ? "Insufficient historical data for momentum forecast."
      : `Network momentum ${momentum.momentum}. Redirect pace vs prior: ${
          momentum.redirect_pace_vs_last_week != null
            ? `${momentum.redirect_pace_vs_last_week >= 0 ? "+" : ""}${momentum.redirect_pace_vs_last_week}%`
            : "stable"
        }.`,
    coaching_focus: coachingFocus,
    network_review_growth: monthLine,
    operational_concern: concern,
    recommended_focus: recommended,
    network_operational_score: networkScore,
    top_performer_today: topStaff
      ? `${topStaff.name} (${topStaff.branch_name}) — ${topStaff.google} Google redirects, ${topStaff.scans} card taps`
      : null,
    generated_tone: "executive_operations",
  };
}
