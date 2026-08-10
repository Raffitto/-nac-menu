/**
 * Causal language policy — distinguish fact vs inference vs unsupported causation.
 */

import type { ClaimRecord, EvidenceRecord } from "./evidenceLedger.ts";

const CAUSAL_VERBS = /\b(caused|cause|causing|because of|due to|driven by|resulted from)\b/i;

export type CausalPolicyResult = {
  ok: boolean;
  violations: string[];
  sanitizedText?: string;
};

export function assessCausalLanguage(
  text: string,
  claims: ClaimRecord[] = [],
  evidence: EvidenceRecord[] = [],
): CausalPolicyResult {
  const violations: string[] = [];
  if (!CAUSAL_VERBS.test(text)) {
    return { ok: true, violations };
  }

  const hasStrongCausalClaim = claims.some((c) =>
    c.type === "VERIFIED_FACT"
    && CAUSAL_VERBS.test(c.statement)
    && c.evidenceIds.length >= 2
  );

  const hasAssociation = claims.some((c) =>
    c.type === "SUPPORTED_ASSOCIATION" || c.type === "PLAUSIBLE_HYPOTHESIS"
  );

  if (!hasStrongCausalClaim) {
    violations.push("unsupported_causal_wording");
    if (hasAssociation || evidence.length) {
      violations.push("downgrade_to_association_language");
    }
  }

  let sanitized = text;
  if (violations.includes("unsupported_causal_wording")) {
    sanitized = text
      .replace(/\bcaused\b/gi, "coincided with")
      .replace(/\bcause\b/gi, "factor related to")
      .replace(/\bbecause of\b/gi, "alongside")
      .replace(/\bdue to\b/gi, "alongside")
      .replace(/\bdriven by\b/gi, "associated with")
      .replace(/\bresulted from\b/gi, "followed");
  }

  return {
    ok: violations.length === 0,
    violations,
    sanitizedText: sanitized,
  };
}

export function allowedInferenceWording(): string {
  return "These issues coincided with the decline, but the available data does not prove they caused it.";
}
