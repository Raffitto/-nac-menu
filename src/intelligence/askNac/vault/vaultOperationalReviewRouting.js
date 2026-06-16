/**
 * Cross-document operational review intent routing.
 */

import { parseVaultPeriodFromQuestion } from "./vaultPeriodParser";
import { isVaultDocumentSearchQuery } from "./vaultDocumentSearchRouting";
import { isVaultDocumentSummaryQuery } from "./vaultDocumentSummaryRouting";
import { isVaultOperationalReviewQuery } from "./vaultOperationalIntelligence";

export { isVaultOperationalReviewQuery };

export function scoreVaultOperationalReviewIntent(q = "") {
  const text = String(q || "").trim();
  if (!text) return 0;
  if (isVaultDocumentSummaryQuery(text)) return 0;
  if (!isVaultOperationalReviewQuery(text)) return 0;

  if (/\bwhat complaints happened\b/.test(text)) return 24;
  if (/\bwhat should management know\b/.test(text) && !/\blogbook/.test(text)) return 24;
  if (/\bany recurring issues?\b/.test(text)) return 23;
  if (/\bfood quality complaints?\b/.test(text)) return 23;
  if (/\bstaff absence\b/.test(text)) return 23;
  if (/\bsummarize.*logbooks?\b/.test(text)) return 22;

  const period = parseVaultPeriodFromQuestion(text);
  if (period?.isWeek) return 22;
  return 21;
}

export function isVaultOperationalReviewBlockedByDocumentSearch(q = "") {
  return isVaultOperationalReviewQuery(q) && !isVaultDocumentSearchQuery(q);
}
