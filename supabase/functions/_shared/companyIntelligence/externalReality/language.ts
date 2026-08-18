import { assessCausalLanguage } from "../causalPolicy.ts";
import type { AssociationStrength } from "./types.ts";

export const ASSOCIATION_LANGUAGE: Record<AssociationStrength, string> = {
  strong_temporal_association: "coincided with",
  moderate_association: "is consistent with",
  weak_possible_contributor: "may have contributed",
  no_meaningful_signal: "does not appear to explain much of the movement",
};

const FORBIDDEN = /\b(caused|cause|causing)\b/i;

export function associationPhrase(strength: AssociationStrength): string {
  return ASSOCIATION_LANGUAGE[strength];
}

export function sanitizeExternalProse(text: string): string {
  const causal = assessCausalLanguage(text);
  let out = causal.sanitizedText || text;
  if (FORBIDDEN.test(out) && !/does not appear|unlikely|not prove/i.test(out)) {
    out = out.replace(/\bcaused\b/gi, "coincided with").replace(/\bcause\b/gi, "factor related to");
  }
  return out;
}

export function strengthFromOverlap(overlap: number, extreme = false): AssociationStrength {
  if (overlap <= 0.02) return "no_meaningful_signal";
  if (overlap >= 0.45 && extreme) return "strong_temporal_association";
  if (overlap >= 0.25 || extreme) return "moderate_association";
  if (overlap >= 0.08) return "weak_possible_contributor";
  return "no_meaningful_signal";
}
