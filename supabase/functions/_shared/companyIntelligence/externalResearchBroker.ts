/**
 * Bounded external research broker — no unrestricted browsing.
 */

import { createEvidence, type EvidenceRecord } from "./evidenceLedger.ts";
import type { DateRange } from "./types.ts";

export type ResearchSourceCategory =
  | "historical_weather"
  | "official_calendar"
  | "local_events"
  | "economic_context"
  | "news"
  | "political_security";

export type ResearchRequest = {
  purpose: string;
  geography?: string | null;
  dateRange?: DateRange | null;
  sourceCategories: ResearchSourceCategory[];
  maxResults: number;
  maxCostUsd: number;
  authorityRequirements?: string[];
};

export type ResearchResult = {
  ok: boolean;
  request: ResearchRequest;
  evidence: EvidenceRecord[];
  truncated: boolean;
  provider: string;
  error?: string | null;
};

export interface ExternalResearchProvider {
  id: string;
  search(request: ResearchRequest): Promise<ResearchResult>;
}

/** Stub/mock provider — no paid research in this phase. */
export function createStubResearchProvider(): ExternalResearchProvider {
  return {
    id: "stub",
    async search(request) {
      return {
        ok: true,
        request,
        evidence: [],
        truncated: false,
        provider: "stub",
        error: null,
      };
    },
  };
}

export function createExternalResearchBroker(
  provider: ExternalResearchProvider = createStubResearchProvider(),
) {
  return {
    providerId: provider.id,
    async research(request: ResearchRequest): Promise<ResearchResult> {
      const normalized: ResearchRequest = {
        purpose: String(request.purpose || "").slice(0, 500),
        geography: request.geography || null,
        dateRange: request.dateRange || null,
        sourceCategories: (request.sourceCategories || []).slice(0, 5),
        maxResults: Math.min(Math.max(Number(request.maxResults) || 3, 1), 10),
        maxCostUsd: Math.min(Math.max(Number(request.maxCostUsd) || 0, 0), 1),
        authorityRequirements: request.authorityRequirements || [],
      };

      if (!normalized.sourceCategories.length) {
        return {
          ok: false,
          request: normalized,
          evidence: [],
          truncated: false,
          provider: provider.id,
          error: "no_source_categories",
        };
      }

      // Hard block paid research in foundation phase.
      if (normalized.maxCostUsd > 0 && provider.id !== "stub") {
        return {
          ok: false,
          request: normalized,
          evidence: [],
          truncated: false,
          provider: provider.id,
          error: "paid_research_disabled_in_foundation_phase",
        };
      }

      const result = await provider.search(normalized);
      const evidence = (result.evidence || []).slice(0, normalized.maxResults).map((ev) =>
        createEvidence({
          ...ev,
          domain: "EXTERNAL",
        })
      );

      return {
        ...result,
        request: normalized,
        evidence,
        truncated: (result.evidence || []).length > normalized.maxResults,
      };
    },
  };
}
