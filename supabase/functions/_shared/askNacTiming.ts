/**
 * Coarse Edge timing buckets for Ask NAC responses (no secrets / SQL).
 */

export type AskNacTimingMs = {
  total: number;
  routeIntent: number;
  selectedTool: number;
  vaultTool: number;
  executiveEvidenceV2: number;
  openAiNarration: number;
  datasetReuse: number;
  knowledgeHealth: number;
};

export function emptyAskNacTimingMs(): AskNacTimingMs {
  return {
    total: 0,
    routeIntent: 0,
    selectedTool: 0,
    vaultTool: 0,
    executiveEvidenceV2: 0,
    openAiNarration: 0,
    datasetReuse: 0,
    knowledgeHealth: 0,
  };
}

export function buildAskNacTimingMs(
  partial: Partial<AskNacTimingMs> & { total: number },
): AskNacTimingMs {
  const base = emptyAskNacTimingMs();
  return { ...base, ...partial };
}

export function attachResponseMeta(
  payload: Record<string, unknown>,
  timingMs: AskNacTimingMs,
  narrationSkipped: boolean,
): Record<string, unknown> {
  return {
    ...payload,
    responseMeta: {
      timingMs,
      narrationSkipped,
    },
  };
}
