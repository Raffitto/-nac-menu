import { estimatePremiumBeverageOpportunity } from "./waiterVisualEngine";
import { rankAttachmentOpportunities } from "./operationalImportance";
import { EXECUTIVE_LABELS } from "../config/executiveVisualLanguage";

/**
 * Executive financial aggregation — money impact, not fragmented percentages.
 */
export function buildFinancialAggregation({
  attachment = {},
  waiters = [],
  beverageOpportunity = null,
}) {
  const rankedMissed = rankAttachmentOpportunities(attachment.missedUpsells || attachment.pairs || []).filter(
    (p) => p.underperforming || (p.weightedLostRevenue || 0) > 0,
  );

  const attachmentLeakage = rankedMissed.reduce((s, m) => s + (m.weightedLostRevenue || m.estimatedLostRevenue || 0), 0);
  const bevOpp = beverageOpportunity || estimatePremiumBeverageOpportunity(waiters);
  const beverageOpportunityTotal = bevOpp.teamTotal || 0;

  const totalRecoverable = Math.round(attachmentLeakage + beverageOpportunityTotal);

  const topLeaks = rankedMissed.slice(0, 5).map((m) => ({
    label: m.label,
    amount: m.weightedLostRevenue || m.estimatedLostRevenue,
    attachRate: m.attachmentRate,
    targetRate: m.expectedPct,
    strategicallyPrioritized: m.strategicallyPrioritized,
  }));

  return {
    totalRecoverable,
    attachmentLeakage: Math.round(attachmentLeakage),
    beverageOpportunity: Math.round(beverageOpportunityTotal),
    beverageMethodology: bevOpp.methodology,
    topLeaks,
    headlineLabel: EXECUTIVE_LABELS.recoverableOpportunity,
    lines: [
      {
        label: EXECUTIVE_LABELS.attachmentLeakage,
        value: Math.round(attachmentLeakage),
        format: "sar",
      },
      {
        label: EXECUTIVE_LABELS.beverageOpportunity,
        value: Math.round(beverageOpportunityTotal),
        format: "sar",
      },
      {
        label: EXECUTIVE_LABELS.recoverableOpportunity,
        value: totalRecoverable,
        format: "sar",
        primary: true,
      },
    ],
    validateNote: "Validate against next Foodics export before treating as fixed recoverable revenue.",
  };
}
