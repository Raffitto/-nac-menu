/**
 * Mirror of Edge askNacNarrationSkip.ts for Jest (keep in sync).
 */

import { ASK_NAC_INTENTS } from "../intentRouter";

const VAULT_INTENTS = {
  CASH_UP: ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
  DOCUMENT_SEARCH: ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH,
  BUSINESS_REASONING: ASK_NAC_INTENTS.VAULT_BUSINESS_REASONING,
  TEACH_OPERATOR: ASK_NAC_INTENTS.VAULT_TEACH_OPERATOR,
  WEEKLY_DASHBOARD: ASK_NAC_INTENTS.VAULT_WEEKLY_DASHBOARD,
  PROVIDE_MANUAL_INPUT: ASK_NAC_INTENTS.VAULT_PROVIDE_MANUAL_INPUT,
  DRIVE_DISCOVER: ASK_NAC_INTENTS.VAULT_DRIVE_DISCOVER,
  DRIVE_APPROVE_RULES: ASK_NAC_INTENTS.VAULT_DRIVE_APPROVE_RULES,
  KNOWLEDGE_HEALTH: ASK_NAC_INTENTS.VAULT_KNOWLEDGE_HEALTH,
};

const DOCUMENT_SEARCH_MESSAGES = {
  NO_MATCH: "No matching information found in uploaded documents.",
  CONNECTION_FAILED: "Could not search uploaded documents — connection failed.",
  AUTH_FAILED: "You do not have access to search uploaded documents.",
};

const DOCUMENT_SEARCH_STATUS = {
  CONNECTION_ERROR: "connection_error",
  AUTH_ERROR: "auth_error",
};

function isPlainTextDirectAnswer(directAnswer) {
  return typeof directAnswer === "string" && directAnswer.trim().length > 0;
}

function hasDeterministicDocumentSearchAnswer(tool, deterministic) {
  const matches = tool?.matches || deterministic?.matches;
  if (Array.isArray(matches) && matches.length > 0) return true;

  const queryStatus = tool?.queryStatus;
  if (
    queryStatus === DOCUMENT_SEARCH_STATUS.CONNECTION_ERROR
    || queryStatus === DOCUMENT_SEARCH_STATUS.AUTH_ERROR
  ) {
    return false;
  }

  const directAnswer = String(deterministic?.directAnswer || "");
  if (!isPlainTextDirectAnswer(directAnswer)) return false;
  if (directAnswer.includes(DOCUMENT_SEARCH_MESSAGES.NO_MATCH)) return false;
  if (directAnswer.includes(DOCUMENT_SEARCH_MESSAGES.CONNECTION_FAILED)) return false;
  if (directAnswer.includes(DOCUMENT_SEARCH_MESSAGES.AUTH_FAILED)) return false;

  const insights = deterministic?.insights;
  const keyMetrics = deterministic?.keyMetrics;
  return Boolean(
    (Array.isArray(insights) && insights.length > 0)
    || (Array.isArray(keyMetrics) && keyMetrics.length > 0),
  );
}

export function shouldSkipAiNarration(
  intent,
  tool,
  vaultPeriod,
  deterministic,
) {
  if (intent === VAULT_INTENTS.BUSINESS_REASONING) return true;
  if (
    intent === VAULT_INTENTS.TEACH_OPERATOR
    || intent === VAULT_INTENTS.WEEKLY_DASHBOARD
    || intent === VAULT_INTENTS.PROVIDE_MANUAL_INPUT
    || intent === VAULT_INTENTS.DRIVE_DISCOVER
    || intent === VAULT_INTENTS.DRIVE_APPROVE_RULES
    || intent === VAULT_INTENTS.KNOWLEDGE_HEALTH
  ) {
    return true;
  }

  if (deterministic?.conversationDataset) return true;

  if (tool?.monthlyLogbookSummary || tool?.structuredLogbookReview) return true;

  if (intent === VAULT_INTENTS.CASH_UP) {
    if (vaultPeriod?.periodType === "year_to_date") return true;
    const dayCount = Number(tool?.aggregation?.dayCount) || 0;
    if (dayCount > 31) return true;
    const sources = tool?.sources || [];
    if (sources.some((s) => s.name === "get_vault_cash_up_range_aggregate")) return true;
    if (deterministic?.executiveBrief) return true;
    if (Array.isArray(deterministic?.keyMetrics) && deterministic.keyMetrics.length > 0) return true;
    if (isPlainTextDirectAnswer(deterministic?.directAnswer)) return true;
    return false;
  }

  if (intent === VAULT_INTENTS.DOCUMENT_SEARCH) {
    return hasDeterministicDocumentSearchAnswer(tool, deterministic);
  }

  return false;
}
