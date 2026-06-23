/**
 * Document search intent detection — must beat vault analytics and Google review metrics.
 */

import {
  isVaultDocumentSummaryQuery,
} from "./vaultDocumentSummaryRouting";
import { isSalesPerformanceExecutiveQuery } from "./vaultSalesPerformanceIntelligence";
import { isVaultOperationalReviewQuery } from "./vaultOperationalIntelligence";

const DOC_SEARCH_ACTION =
  /\b(find|search|look up|show|list|summarize|summary|show references? to|mentions? of|contains?|entries?)\b/i;
const DOC_SEARCH_SCOPE =
  /\b(company knowledge|data vault|uploaded documents?|uploaded reports?|uploaded files?|documents?|logbooks?|daily logbooks?|document search|vault)\b/i;
const EXPLICIT_DOCUMENT_SCOPE =
  /\b(logbooks?|daily logbooks?|uploaded reports?|uploaded documents?|documents?|vault|company knowledge)\b/i;

export function isVaultDocumentSearchQuery(q = "") {
  const text = String(q || "").trim().toLowerCase();
  if (!text) return false;
  if (isVaultDocumentSummaryQuery(text)) return false;
  if (isSalesPerformanceExecutiveQuery(text)) return false;
  if (/\bsearch company knowledge for cash[\s-]?up\b/.test(text)) return false;
  if (!DOC_SEARCH_ACTION.test(text) && isVaultOperationalReviewQuery(text)) return false;
  if (/\b(historical weekly dashboards?|weekly dashboards?|executive reports?)\b/.test(text)) return true;
  if (/\b(show|list|summarize|everything learned from|learned from)\b/.test(text) && /\bweekly dashboard\b/.test(text)) return true;
  if (/\bfind mentions of\b/.test(text)) return true;
  if (/\bsearch company knowledge\b/.test(text)) return true;
  if (/\bsearch uploaded documents\b/.test(text)) return true;
  if (/\bsearch uploaded reports for\b/.test(text)) return true;
  if (/\bsummarize (the )?(uploaded )?(document|report|logbook)\b/.test(text)) return false;
  if (/\bsummarize the\b/.test(text) && /\blogbook\b/.test(text)) return false;
  if (/\blatest uploaded logbook\b/.test(text)) return true;
  if (DOC_SEARCH_ACTION.test(text) && DOC_SEARCH_SCOPE.test(text)) return true;
  if (DOC_SEARCH_ACTION.test(text) && EXPLICIT_DOCUMENT_SCOPE.test(text)) return true;
  if (/\b(find|search|summarize)\b/.test(text) && /\blogbook\b/.test(text)) return true;
  if (
    /\b(find|search|look up|mentions? of|contains?)\b/.test(text) &&
    /\b(uploaded|document|file|report|vault|knowledge|sop)\b/.test(text)
  ) {
    return true;
  }
  if (/\b(find|search)\b/.test(text) && /\b(waste|complaint|terrace|ac)\b/.test(text)) return true;
  return false;
}

export function scoreVaultDocumentSearchIntent(q = "") {
  const text = String(q || "").trim().toLowerCase();
  if (!isVaultDocumentSearchQuery(text)) return 0;
  if (/\b(historical weekly dashboards?|everything learned from)\b/.test(text)) return 32;
  if (/\b(show|list|summarize|learned from)\b/.test(text) && /\bweekly dashboard\b/.test(text)) return 31;
  if (/\bfind mentions of\b/.test(text)) return 30;
  if (/\bsearch company knowledge\b/.test(text)) return 30;
  if (/\bsearch uploaded documents\b/.test(text)) return 30;
  if (/\bsearch uploaded reports for\b/.test(text)) return 30;
  if (DOC_SEARCH_ACTION.test(text) && EXPLICIT_DOCUMENT_SCOPE.test(text)) return 30;
  if (/\bsummarize (the )?(uploaded )?(document|report|logbook)\b/.test(text)) return 0;
  if (/\bsummarize the\b/.test(text) && /\blogbook\b/.test(text)) return 0;
  if (/\blatest uploaded logbook\b/.test(text)) return 29;
  if (/\b(find|search|summarize)\b/.test(text) && /\blogbook\b/.test(text)) return 28;
  if (DOC_SEARCH_ACTION.test(text) && DOC_SEARCH_SCOPE.test(text)) return 27;
  return 26;
}

/** Strip intent phrasing to raw keyword query for FTS. */
export function extractDocumentSearchTerms(question = "") {
  let q = String(question || "").trim();
  q = q.replace(/^show me everything learned from historical weekly dashboards\.?\s*/i, "");
  q = q.replace(/^everything learned from historical weekly dashboards\.?\s*/i, "");
  q = q.replace(/^show me everything learned from\s+/i, "");
  q = q.replace(/^search company knowledge for\s+/i, "");
  q = q.replace(/^search uploaded documents for\s+/i, "");
  q = q.replace(/^search uploaded reports for\s+/i, "");
  q = q.replace(/^summarize (the )?(uploaded )?(document|report|logbook)\s+/i, "");
  q = q.replace(/^summarize (the )?/i, "");
  q = q.replace(/^(please\s+)?(find|search|look up|show references? to)\s+(mentions?\s+of\s+)?/i, "");
  q = q.replace(
    /\b(in uploaded (files|documents|reports)|from (the )?vault|in company knowledge|from company knowledge|in (the )?data vault)\b/gi,
    "",
  );
  return q.replace(/\?$/, "").trim();
}
