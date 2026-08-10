/**
 * Cost / telemetry architecture — no secrets or raw prompts.
 */

import type { ModelProviderId } from "./modelGateway.ts";
import type { ResearchBudgetTier } from "./types.ts";

export type IntelligenceTelemetry = {
  requestCategory: string | null;
  budgetTier: ResearchBudgetTier | null;
  deterministicRouteUsed: boolean;
  plannerUsed: boolean;
  plannerCallCount: number;
  synthesisCallCount: number;
  critiqueModelCallCount: number;
  localModelCalls: number;
  cloudModelCalls: number;
  modelProvider: ModelProviderId | null;
  modelName: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  estimatedCostUsd: number | null;
  latencyMs: number | null;
  toolsCalled: string[];
  cloudEscalationReason: string | null;
  verifierOk: boolean | null;
  paidModelCallsPerAnswer: number;
  maxPaidCallsPerAnswer: number;
};

export function createEmptyTelemetry(): IntelligenceTelemetry {
  return {
    requestCategory: null,
    budgetTier: null,
    deterministicRouteUsed: false,
    plannerUsed: false,
    plannerCallCount: 0,
    synthesisCallCount: 0,
    critiqueModelCallCount: 0,
    localModelCalls: 0,
    cloudModelCalls: 0,
    modelProvider: null,
    modelName: null,
    promptTokens: null,
    completionTokens: null,
    estimatedCostUsd: null,
    latencyMs: null,
    toolsCalled: [],
    cloudEscalationReason: null,
    verifierOk: null,
    paidModelCallsPerAnswer: 0,
    maxPaidCallsPerAnswer: 2,
  };
}

export function estimateOpenAiMiniCostUsd(promptTokens: number, completionTokens: number): number {
  // Approximate public gpt-4o-mini ballpark; telemetry only — not billing.
  const inCost = (promptTokens / 1_000_000) * 0.15;
  const outCost = (completionTokens / 1_000_000) * 0.6;
  return Math.round((inCost + outCost) * 1_000_000) / 1_000_000;
}
