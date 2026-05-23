/**
 * Confidence tiers for intelligence outputs — avoid fake certainty on sparse data.
 */

export const CONFIDENCE = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
};

export const CONFIDENCE_LABELS = {
  [CONFIDENCE.HIGH]: "High confidence",
  [CONFIDENCE.MEDIUM]: "Medium confidence",
  [CONFIDENCE.LOW]: "Low confidence",
};

export const PROVISIONAL_PREFIX = {
  [CONFIDENCE.HIGH]: "",
  [CONFIDENCE.MEDIUM]: "Directional estimate — ",
  [CONFIDENCE.LOW]: "Provisional — limited data — ",
};

/** User-safe phrase for predictive / executive copy. */
export function provisionalPhrase(confidence, text) {
  const level = confidence || CONFIDENCE.LOW;
  const prefix = PROVISIONAL_PREFIX[level] || PROVISIONAL_PREFIX[CONFIDENCE.LOW];
  if (!text) return "";
  return `${prefix}${text}`;
}

/** Pick lowest confidence from a list. */
export function minConfidence(...levels) {
  const order = { [CONFIDENCE.HIGH]: 3, [CONFIDENCE.MEDIUM]: 2, [CONFIDENCE.LOW]: 1 };
  let min = CONFIDENCE.HIGH;
  for (const l of levels) {
    if (!l) continue;
    if ((order[l] || 0) < (order[min] || 3)) min = l;
  }
  return min;
}
