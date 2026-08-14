/**
 * Persistence-ready research-run contracts (no Temporal/LangGraph).
 * Enables future async deep research without redesigning intelligence.
 */

import type { ClaimRecord, EvidenceRecord } from "./evidenceLedger.ts";
import type { ResearchBudgetTier } from "./types.ts";

export type ResearchRunStatus =
  | "queued"
  | "planning"
  | "gathering"
  | "critiquing"
  | "synthesizing"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export type ResearchStepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export type ResearchStep = {
  id: string;
  runId: string;
  index: number;
  capability: string;
  status: ResearchStepStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: string | null;
  evidenceIds: string[];
};

export type ResearchRun = {
  id: string;
  threadId: string | null;
  question: string;
  status: ResearchRunStatus;
  budgetTier: ResearchBudgetTier;
  steps: ResearchStep[];
  evidence: EvidenceRecord[];
  claims: ClaimRecord[];
  checkpoint: Record<string, unknown>;
  cost: {
    paidModelCalls: number;
    estimatedUsd: number | null;
  };
  errors: string[];
  createdAt: string;
  updatedAt: string;
};

export function createResearchRun(input: {
  id: string;
  question: string;
  threadId?: string | null;
  budgetTier?: ResearchBudgetTier;
}): ResearchRun {
  const now = new Date().toISOString();
  return {
    id: input.id,
    threadId: input.threadId || null,
    question: input.question,
    status: "queued",
    budgetTier: input.budgetTier ?? 1,
    steps: [],
    evidence: [],
    claims: [],
    checkpoint: {},
    cost: { paidModelCalls: 0, estimatedUsd: null },
    errors: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function appendResearchStep(
  run: ResearchRun,
  step: Omit<ResearchStep, "runId" | "index"> & { index?: number },
): ResearchRun {
  const next: ResearchStep = {
    ...step,
    runId: run.id,
    index: step.index ?? run.steps.length,
    evidenceIds: step.evidenceIds || [],
  };
  return {
    ...run,
    steps: [...run.steps, next],
    updatedAt: new Date().toISOString(),
  };
}
