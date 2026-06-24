/**
 * Document summary intent — summarize uploaded chunks, not structured_facts or metrics.
 */

import {
  isVaultMonthlyOperationalSummaryQuery,
  scoreVaultMonthlyOperationalSummaryIntent,
  preferredMonthlyOperationalIntent,
} from "./vaultMonthlyOperationalSummaryRouting";

const SEARCH_PREFIX =
  /\b(search company knowledge|search uploaded documents|search uploaded reports|find mentions of|look up)\b/i;

const DOCUMENT_SCOPE =
  /\b(logbooks?|daily logbooks?|uploaded reports?|uploaded documents?|documents?|files?|vault|company knowledge)\b/i;
const CASH_UP_INTENT_SIGNAL =
  /\b(cash[\s-]?up|cashup|cash report|daily cash report|cash reconciliation|cash[\s-]?up sales)\b/i;

export function isVaultDocumentSummaryQuery(q = "", documentContext = null) {
  const text = String(q || "").trim().toLowerCase();
  if (!text) return false;

  if (documentContext?.fileIds?.length && isDocumentSummaryFollowUp(text)) return true;

  if (SEARCH_PREFIX.test(text)) return false;
  if (CASH_UP_INTENT_SIGNAL.test(text)) return false;

  if (isVaultMonthlyOperationalSummaryQuery(text)
    && preferredMonthlyOperationalIntent(text) === "vault_document_summary") {
    return true;
  }

  if (/\bsummarize\b/.test(text) && DOCUMENT_SCOPE.test(text)) return true;
  if (/\bsummarize (this|that|the) (document|report|logbook|file|upload)\b/.test(text)) return true;
  if (/\b(provide|give me) (an? )?executive summary\b/.test(text)) return true;
  if (/\bexecutive summary\b/.test(text)) return true;
  if (/\bkey takeaways?\b/.test(text)) return true;
  if (/\bwhat should management know\b/.test(text) && !/\b(logbooks?|uploaded logbooks)\b/.test(text)) return true;
  if (/\bsummarize the\b/.test(text) && /\b(logbook|document|report|upload)\b/.test(text)) return true;
  if (/\bsummarize\b/.test(text) && /\b(june|july|august|september|october|november|december|january|february|march|april|may)\b/.test(text)) {
    if (/\b(branch|operation|operational|cash[\s-]?up|what happened)\b/.test(text)) return false;
    if (/\b(logbook|document|report|upload|file|khobar|riyadh|jeddah)\b/.test(text)) return true;
    return false;
  }
  if (/\bsummarize\b/.test(text) && /\b(khobar|riyadh|jeddah)\b/.test(text) && /\blogbook\b/.test(text)) {
    return true;
  }
  return false;
}

export function isDocumentSummaryFollowUp(q = "") {
  const text = String(q || "").trim().toLowerCase();
  if (!text) return false;
  if (/\b(summarize|summary|executive|takeaways?|management know|brief me|overview)\b/.test(text)) return true;
  if (/^(provide an? executive summary|key takeaways|what should management know)\b/.test(text)) return true;
  return false;
}

export function scoreVaultDocumentSummaryIntent(q = "", documentContext = null) {
  const monthlyScore = scoreVaultMonthlyOperationalSummaryIntent(q);
  if (monthlyScore && preferredMonthlyOperationalIntent(q) === "vault_document_summary") {
    return monthlyScore;
  }

  if (!isVaultDocumentSummaryQuery(q, documentContext)) return 0;
  if (CASH_UP_INTENT_SIGNAL.test(q)) return 0;
  if (documentContext?.fileIds?.length && isDocumentSummaryFollowUp(q)) return 34;
  if (/\bsummarize\b/.test(q) && DOCUMENT_SCOPE.test(q)) return 34;
  if (/\bwhat should management know\b/.test(q)) return 33;
  if (/\bexecutive summary\b/.test(q)) return 33;
  if (/\bkey takeaways?\b/.test(q)) return 32;
  if (/\bsummarize (this|that|the) (document|report|logbook|file)\b/.test(q)) return 32;
  if (/\bsummarize the\b/.test(q) && /\blogbook\b/.test(q)) return 31;
  return 30;
}

/** Subject phrase used to locate uploaded file(s) by name when no conversation context. */
export function extractDocumentSummarySubject(question = "") {
  let q = String(question || "").trim();
  q = q.replace(/^summarize (this|that|the) (document|report|logbook|file|upload)\s*/i, "");
  q = q.replace(/^summarize\s+(the\s+)?/i, "");
  q = q.replace(/^(please\s+)?(provide|give me) (an? )?executive summary (of|for|on|about)?\s*/i, "");
  q = q.replace(/^executive summary (of|for|on|about)?\s*/i, "");
  q = q.replace(/^key takeaways (from|for|on|about)?\s*/i, "");
  q = q.replace(/^what should management know (about|from|regarding)?\s*/i, "");
  q = q.replace(/^summarize (the )?/i, "");
  q = q.replace(/\b(from (the )?vault|in company knowledge|uploaded documents?)\b/gi, "");
  return q.replace(/\?$/, "").trim();
}
