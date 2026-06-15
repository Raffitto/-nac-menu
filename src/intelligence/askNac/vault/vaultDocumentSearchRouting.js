/**
 * Document search intent detection — must beat vault analytics and Google review metrics.
 */

const DOC_SEARCH_ACTION =
  /\b(find|search|look up|summarize|summary|show references? to|mentions? of|contains?)\b/i;
const DOC_SEARCH_SCOPE =
  /\b(company knowledge|data vault|uploaded documents?|uploaded reports?|uploaded files?|document search|vault)\b/i;

export function isVaultDocumentSearchQuery(q = "") {
  const text = String(q || "").trim().toLowerCase();
  if (!text) return false;
  if (/\bfind mentions of\b/.test(text)) return true;
  if (/\bsearch company knowledge\b/.test(text)) return true;
  if (/\bsearch uploaded documents\b/.test(text)) return true;
  if (/\bsearch uploaded reports for\b/.test(text)) return true;
  if (/\bsummarize (the )?(uploaded )?(document|report|logbook)\b/.test(text)) return true;
  if (/\bsummarize the\b/.test(text) && /\blogbook\b/.test(text)) return true;
  if (/\blatest uploaded logbook\b/.test(text)) return true;
  if (DOC_SEARCH_ACTION.test(text) && DOC_SEARCH_SCOPE.test(text)) return true;
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
  if (/\bfind mentions of\b/.test(text)) return 30;
  if (/\bsearch company knowledge\b/.test(text)) return 30;
  if (/\bsearch uploaded documents\b/.test(text)) return 30;
  if (/\bsearch uploaded reports for\b/.test(text)) return 30;
  if (/\bsummarize (the )?(uploaded )?(document|report|logbook)\b/.test(text)) return 29;
  if (/\bsummarize the\b/.test(text) && /\blogbook\b/.test(text)) return 29;
  if (/\blatest uploaded logbook\b/.test(text)) return 29;
  if (/\b(find|search|summarize)\b/.test(text) && /\blogbook\b/.test(text)) return 28;
  if (DOC_SEARCH_ACTION.test(text) && DOC_SEARCH_SCOPE.test(text)) return 27;
  return 26;
}

/** Strip intent phrasing to raw keyword query for FTS. */
export function extractDocumentSearchTerms(question = "") {
  let q = String(question || "").trim();
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
