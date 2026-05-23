/**
 * Executive operational observations — consulting-style, rules-only.
 */

import { dedupeExecutiveInsights } from "../../platform/engines/executiveNarrativeEngine";

function bestByScore(scores = []) {
  return [...scores]
    .filter((s) => s.score != null)
    .sort((a, b) => b.score - a.score)[0];
}

function worstByScore(scores = []) {
  return [...scores]
    .filter((s) => s.score != null)
    .sort((a, b) => a.score - b.score)[0];
}

/**
 * @param {object} input
 */
export function buildExecutiveOperationalInsights(input = {}) {
  const scores = input.branchScores || [];
  const comparison = input.branchComparison || [];
  const staffInsights = input.staffInsights || [];
  const momentum = input.momentum || {};
  const insights = [];

  const leader = bestByScore(scores);
  const laggard = worstByScore(scores);

  if (leader?.branch_id) {
    insights.push({
      priority: 1,
      text: `${leader.branch_name} continues to outperform the network in redirect efficiency (score ${leader.score}).`,
    });
  }

  if (laggard?.branch_id && laggard.branch_id !== leader?.branch_id) {
    const row = comparison.find((c) => c.branch_id === laggard.branch_id);
    if (row && row.qr_scans >= 15 && (row.conversion_pct || 0) < 40) {
      insights.push({
        priority: 2,
        text: `${laggard.branch_name} participation volume is healthy but Google completion remains weak.`,
      });
    } else if (laggard.weaknesses?.length) {
      insights.push({
        priority: 2,
        text: `${laggard.branch_name}: ${laggard.weaknesses[0].toLowerCase()}.`,
      });
    }
  }

  const participationRisk = staffInsights.find((i) => i.type === "participation");
  if (participationRisk) {
    insights.push({
      priority: 3,
      text: participationRisk.text.replace(/\.$/, "") + " across active staff.",
    });
  } else {
    const lowBreadth = scores.find(
      (s) => s.factors?.staffParticipation != null && s.factors.staffParticipation < 50,
    );
    if (lowBreadth) {
      insights.push({
        priority: 3,
        text: `${lowBreadth.branch_name} shows low participation breadth across active staff.`,
      });
    }
  }

  if (momentum.momentum === "Rising" && !momentum.insufficient_data) {
    insights.push({
      priority: 4,
      text: `Network redirect momentum is rising; sustain verbal Google CTA coaching this period.`,
    });
  } else if (momentum.momentum === "Declining") {
    insights.push({
      priority: 4,
      text: `Redirect pace is declining week-on-week; prioritize bill-close handoff discipline.`,
    });
  }

  const eliteCount = scores.filter((s) => s.tier === "elite").length;
  if (eliteCount >= 2) {
    insights.push({
      priority: 5,
      text: `${eliteCount} branches hold Elite operational scores — replicate ${leader?.branch_name || "top"} playbook.`,
    });
  }

  return dedupeExecutiveInsights(
    insights
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 6),
  )
    .slice(0, 5)
    .map((item, i) => ({ ...item, id: item.id || `exec-${i}` }));
}
