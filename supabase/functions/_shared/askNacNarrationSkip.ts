/**
 * When deterministic vault answers are complete, skip OpenAI narration.
 */

import { VAULT_INTENTS } from "./askNacVaultTools.ts";
import {
  DOCUMENT_SEARCH_MESSAGES,
  DOCUMENT_SEARCH_STATUS,
} from "./vaultDocumentSearchRetrieval.ts";

function isPlainTextDirectAnswer(directAnswer: unknown): boolean {
  return typeof directAnswer === "string" && directAnswer.trim().length > 0;
}

function hasDeterministicDocumentSearchAnswer(
  tool: Record<string, unknown> | null,
  deterministic: Record<string, unknown> | null | undefined,
): boolean {
  const matches = (tool?.matches as unknown[]) || (deterministic?.matches as unknown[]);
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

  const insights = deterministic?.insights as unknown[] | undefined;
  const keyMetrics = deterministic?.keyMetrics as unknown[] | undefined;
  return Boolean(
    (Array.isArray(insights) && insights.length > 0)
    || (Array.isArray(keyMetrics) && keyMetrics.length > 0),
  );
}

export function shouldSkipAiNarration(
  intent: string,
  tool: Record<string, unknown> | null,
  vaultPeriod?: { periodType?: string },
  deterministic?: Record<string, unknown> | null,
): boolean {
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

  if (intent === VAULT_INTENTS.CASH_UP) {
    if (vaultPeriod?.periodType === "year_to_date") return true;
    const aggregation = tool?.aggregation as Record<string, unknown> | undefined;
    const dayCount = Number(aggregation?.dayCount) || 0;
    if (dayCount > 31) return true;
    const sources = (tool?.sources as { name?: string }[]) || [];
    if (sources.some((s) => s.name === "get_vault_cash_up_range_aggregate")) return true;
    if (deterministic?.executiveBrief) return true;
    const keyMetrics = deterministic?.keyMetrics as unknown[] | undefined;
    if (Array.isArray(keyMetrics) && keyMetrics.length > 0) return true;
    if (isPlainTextDirectAnswer(deterministic?.directAnswer)) return true;
    return false;
  }

  if (intent === VAULT_INTENTS.DOCUMENT_SEARCH) {
    return hasDeterministicDocumentSearchAnswer(tool, deterministic);
  }

  return false;
}
