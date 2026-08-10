/**
 * Central source-authority registry. LLM must not decide precedence.
 */

import type { SourceAuthority } from "./types.ts";

export type SourceAuthorityRecord = {
  sourceId: string;
  authority: SourceAuthority;
  domain: string;
  mayOverrideCanonical: boolean;
  notes: string;
};

export const SOURCE_AUTHORITY_REGISTRY: Record<string, SourceAuthorityRecord> = Object.freeze({
  cash_up: {
    sourceId: "cash_up",
    authority: "CANONICAL_STRUCTURED",
    domain: "branch_sales",
    mayOverrideCanonical: false,
    notes: "Primary commercial structured metrics",
  },
  foodics: {
    sourceId: "foodics",
    authority: "LEGACY_EXTERNAL_EVIDENCE",
    domain: "external_pos",
    mayOverrideCanonical: false,
    notes: "Legacy external evidence only",
  },
  foodics_menu_engineering_cost: {
    sourceId: "foodics_menu_engineering_cost",
    authority: "LEGACY_FOODICS_COMPARISON_ONLY",
    domain: "menu_cost_compare",
    mayOverrideCanonical: false,
    notes: "Must not override canonical culinary/cost data",
  },
  logbook: {
    sourceId: "logbook",
    authority: "OPERATIONAL_RECORDED_EVIDENCE",
    domain: "operations",
    mayOverrideCanonical: false,
    notes: "In-range qualitative operational evidence",
  },
  historical_weather: {
    sourceId: "historical_weather",
    authority: "EXTERNAL_CONTEXT",
    domain: "weather",
    mayOverrideCanonical: false,
    notes: "External context only",
  },
  web_news: {
    sourceId: "web_news",
    authority: "SECONDARY_EXTERNAL_CONTEXT",
    domain: "news",
    mayOverrideCanonical: false,
    notes: "Secondary external context",
  },
  business_timeline: {
    sourceId: "business_timeline",
    authority: "COMPANY_HISTORICAL",
    domain: "branch_timeline",
    mayOverrideCanonical: false,
    notes: "Structural company facts (openings, closures)",
  },
});

export function getSourceAuthority(sourceId: string): SourceAuthorityRecord {
  return SOURCE_AUTHORITY_REGISTRY[sourceId] || {
    sourceId,
    authority: "UNKNOWN",
    domain: "unknown",
    mayOverrideCanonical: false,
    notes: "Unregistered source",
  };
}

/** Foodics must never replace Cash Up as canonical branch sales. */
export function canSourceOverride(
  challengerSourceId: string,
  incumbentSourceId = "cash_up",
): boolean {
  const challenger = getSourceAuthority(challengerSourceId);
  const incumbent = getSourceAuthority(incumbentSourceId);
  if (incumbent.authority === "CANONICAL_STRUCTURED") {
    return false;
  }
  return challenger.mayOverrideCanonical;
}

export function preferCanonicalSource(sourceIds: string[]): string | null {
  for (const id of sourceIds) {
    if (getSourceAuthority(id).authority === "CANONICAL_STRUCTURED") return id;
  }
  return sourceIds[0] || null;
}
