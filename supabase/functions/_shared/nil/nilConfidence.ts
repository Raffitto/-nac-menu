/** Edge-local confidence tiers (mirrors src/platform/contracts/dataConfidence). */
export const CONFIDENCE = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
} as const;

export const CONFIDENCE_LABELS: Record<string, string> = {
  [CONFIDENCE.HIGH]: "High confidence",
  [CONFIDENCE.MEDIUM]: "Medium confidence",
  [CONFIDENCE.LOW]: "Low confidence",
};

export function minConfidence(...levels: (string | undefined | null)[]) {
  const order: Record<string, number> = { [CONFIDENCE.HIGH]: 3, [CONFIDENCE.MEDIUM]: 2, [CONFIDENCE.LOW]: 1 };
  let min = CONFIDENCE.HIGH;
  for (const l of levels) {
    if (!l) continue;
    if ((order[l] || 0) < (order[min] || 3)) min = l as typeof CONFIDENCE.HIGH;
  }
  return min;
}
