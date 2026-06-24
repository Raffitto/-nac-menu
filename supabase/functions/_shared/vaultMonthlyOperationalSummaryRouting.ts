/**
 * Monthly operational logbook summary routing — recovered structured facts, not chunk RAG.
 */

import {
  monthBoundsFromToken,
  parseVaultPeriodFromQuestion,
} from "./vaultPeriodParser.ts";

const MONTH_TOKEN = "(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)";

const OPERATIONAL_SUMMARY_SIGNAL =
  /\b(operations?|operationally|logbooks?|highlights?|recurring issues?|main issues?|main operational|what happened|executive operational summary|operational themes?|guest complaints?)\b/i;

const NON_OPERATIONAL_BLOCK =
  /\b(menu qr|menu sessions?|net sales|gross sales|foodics|cash[\s-]?up|visualize it|top items?|best sell)\b/i;

export function isVaultMonthlyOperationalSummaryQuery(question = "") {
  const text = String(question || "").trim().toLowerCase();
  if (!text) return false;

  const period = parseVaultPeriodFromQuestion(question);
  if (period?.isSingleDay) return false;

  if (/\bcompare\b/.test(text) && /\b(top items?|best sell|sales|revenue|category|items?)\b/.test(text)) {
    return false;
  }

  if (/\bon\s+\d{1,2}\b/.test(text) || /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/.test(text)) {
    return false;
  }

  if (NON_OPERATIONAL_BLOCK.test(text) && !OPERATIONAL_SUMMARY_SIGNAL.test(text)) return false;

  if (/\bcompare\b/.test(text) && /\b(vs|versus)\b/.test(text) && new RegExp(MONTH_TOKEN, "i").test(text)) {
    return OPERATIONAL_SUMMARY_SIGNAL.test(text) || /\boperational\b/.test(text);
  }

  if (/\b(summarize|summary|give me|what happened|main operational|recurring issues?|operational themes?)\b/.test(text)
    && new RegExp(`\\b${MONTH_TOKEN}\\b`, "i").test(text)
    && (OPERATIONAL_SUMMARY_SIGNAL.test(text) || /\boperations?\b/.test(text))) {
    return true;
  }

  if (/\b(logbook highlights?|executive operational summary)\b/.test(text)
    && new RegExp(`\\b${MONTH_TOKEN}\\b`, "i").test(text)) {
    return true;
  }

  if (/\b${MONTH_TOKEN}\s+operations?\b/i.test(text)) return true;
  if (/\boperations?\s+(?:in|for|during)\s+${MONTH_TOKEN}\b/i.test(text)) return true;
  if (/\boperationally\s+(?:in|for|during)\s+${MONTH_TOKEN}\b/i.test(text)) return true;

  if (/\b(daily logbook|logbook)\b/.test(text)
    && /\b(highlights?|summarize|summary)\b/.test(text)
    && new RegExp(`\\b${MONTH_TOKEN}\\b`, "i").test(text)) {
    return true;
  }

  return false;
}

export function detectMonthlyOperationalMode(question = "") {
  const text = String(question || "").trim().toLowerCase();
  if (/\bcompare\b/.test(text) && /\b(vs|versus)\b/.test(text)) return "compare";
  if (/\brecurring\b/.test(text)) return "recurring";
  if (/\b(main|biggest|top)\b.*\b(issues?|problems?|complaints?)\b/.test(text)) return "issues";
  if (/\bhighlights?\b/.test(text)) return "highlights";
  if (/\bexecutive operational summary\b/.test(text)) return "executive";
  if (/\bwhat happened\b/.test(text)) return "narrative";
  return "summary";
}

export function extractOperationalMonthPeriod(question = "", referenceDate = new Date()) {
  const parsed = parseVaultPeriodFromQuestion(question, referenceDate);
  if (parsed?.isMonth) return parsed;

  const text = String(question || "").trim().toLowerCase();
  if (!text) return null;

  const patterns = [
    new RegExp(`\\b(?:summarize|summary|give me|review)\\b[^?]*?\\b(${MONTH_TOKEN})\\b(?:\\s+(20\\d{2}))?`, "i"),
    new RegExp(`\\b(${MONTH_TOKEN})\\b(?:\\s+(20\\d{2}))?\\s+operations?\\b`, "i"),
    new RegExp(`\\boperations?\\s+(?:in|for|during)\\s+(${MONTH_TOKEN})\\b(?:\\s+(20\\d{2}))?`, "i"),
    new RegExp(`\\boperationally\\s+(?:in|for|during)\\s+(${MONTH_TOKEN})\\b(?:\\s+(20\\d{2}))?`, "i"),
    new RegExp(`\\b(?:in|during|for)\\s+(${MONTH_TOKEN})\\b(?:\\s+(20\\d{2}))?`, "i"),
    new RegExp(`\\b(${MONTH_TOKEN})\\b(?:\\s+(20\\d{2}))?\\s+(?:operational|logbook)`, "i"),
  ];

  for (const re of patterns) {
    const match = text.match(re);
    if (!match) continue;
    const period = monthBoundsFromToken(match[1], match[2], referenceDate);
    if (period) return period;
  }

  return null;
}

export function parseMonthlyOperationalComparePeriods(question = "", referenceDate = new Date()) {
  const text = String(question || "").trim().toLowerCase();
  if (!text || !/\bcompare\b/.test(text) || !/\b(vs|versus)\b/.test(text)) return null;

  const match = text.match(
    new RegExp(`\\b(?:compare\\s+)?(${MONTH_TOKEN})\\b(?:\\s+(20\\d{2}))?\\s+(?:vs|versus)\\s+(${MONTH_TOKEN})\\b(?:\\s+(20\\d{2}))?`, "i"),
  );
  if (!match) return null;

  const current = monthBoundsFromToken(match[1], match[2], referenceDate);
  const previous = monthBoundsFromToken(match[3], match[4] || match[2], referenceDate);
  if (!current || !previous) return null;

  return {
    current,
    previous,
    periodType: "month_compare",
    isComparison: true,
  };
}

export function scoreVaultMonthlyOperationalSummaryIntent(question = "") {
  if (!isVaultMonthlyOperationalSummaryQuery(question)) return 0;
  const text = String(question || "").trim().toLowerCase();
  const mode = detectMonthlyOperationalMode(text);

  if (mode === "compare") return 40;
  if (/\bsummarize\b.*\boperations?\b/.test(text)) return 39;
  if (/\bwhat happened operationally\b/.test(text)) return 38;
  if (mode === "recurring" || mode === "issues") return 38;
  if (/\blogbook highlights?\b/.test(text)) return 37;
  if (/\bexecutive operational summary\b/.test(text)) return 37;
  return 36;
}

export function preferredMonthlyOperationalIntent(question = "") {
  const text = String(question || "").trim().toLowerCase();
  if (/\b(highlights?|executive operational summary)\b/.test(text)
    && /\blogbook\b/.test(text)) {
    return "vault_document_summary";
  }
  return "vault_operational_review";
}
