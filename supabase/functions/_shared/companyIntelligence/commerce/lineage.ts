import type { CommerceQuality } from "./quality.ts";
import { qualityNarrative } from "./quality.ts";

export type CommerceLineage = {
  rawBatchIds: string[];
  exportRequestIds: string[];
  acquisitionModes: string[];
  checksums: string[];
  canonicalIngestRunId: string | null;
  derivationVersion: string;
};

export const COMMERCE_DERIVATION_VERSION = "commerce-sessions-v1";

export function createLineage(partial: Partial<CommerceLineage> = {}): CommerceLineage {
  return {
    rawBatchIds: partial.rawBatchIds || [],
    exportRequestIds: partial.exportRequestIds || [],
    acquisitionModes: partial.acquisitionModes || [],
    checksums: partial.checksums || [],
    canonicalIngestRunId: partial.canonicalIngestRunId || null,
    derivationVersion: partial.derivationVersion || COMMERCE_DERIVATION_VERSION,
  };
}

export type EvidenceSummary = {
  dataThrough: string | null;
  salesSource: string;
  sessionSource: string;
  sessionsAnalyzed: number | null;
  coverage: string | null;
  mappingQuality: number | null;
  quality?: CommerceQuality | null;
  sourceFreshness: string | null;
  lineage?: CommerceLineage;
  batchId?: string | null;
};

export function buildEvidenceSummary(input: {
  dataThrough?: string | null;
  sessionsAnalyzed?: number | null;
  mappingQuality?: number | null;
  quality?: CommerceQuality | null;
  sourceFreshness?: string | null;
  coverage?: string | null;
  lineage?: CommerceLineage;
  batchId?: string | null;
}): EvidenceSummary {
  return {
    dataThrough: input.dataThrough || null,
    salesSource: "Cash Up",
    sessionSource: "canonical commerce sessions",
    sessionsAnalyzed: input.sessionsAnalyzed ?? null,
    coverage: input.coverage || null,
    mappingQuality: input.mappingQuality ?? null,
    quality: input.quality || null,
    sourceFreshness: input.sourceFreshness || null,
    lineage: input.lineage,
    batchId: input.batchId || null,
  };
}

export function dataUsedAnswer(summary: EvidenceSummary): string {
  const through = summary.dataThrough || "unknown";
  const sessions = summary.sessionsAnalyzed != null ? `${summary.sessionsAnalyzed} dine-in sessions` : "no published sessions";
  const quality = summary.quality
    ? qualityNarrative(summary.quality)
    : (summary.mappingQuality != null
      ? `${(summary.mappingQuality * 100).toFixed(1)}% of sessions were classifiable.`
      : "mapping dimensions were not measured.");
  return (
    `This answer uses ${summary.sessionSource} through ${through} (${sessions}). `
    + `${quality} `
    + `Headline sales remain ${summary.salesSource} from ask_nac_structured_facts. `
    + `Session classification is not the same as product-UUID mapping coverage. `
    + (summary.sourceFreshness ? `Commerce freshness: ${summary.sourceFreshness}.` : "")
    + (summary.batchId ? ` Batch ${summary.batchId}.` : "")
  ).trim();
}

export function freshnessAnswer(input: {
  dataThrough: string | null;
  lastIngestAt: string | null;
  status: string;
  ordersStatus?: string;
  itemsStatus?: string;
  publicationStatus?: string;
  mappingQuality?: number | null;
  quality?: CommerceQuality | null;
  error?: string | null;
}): string {
  const quality = input.quality ? qualityNarrative(input.quality) : "";
  return (
    `Foodics commerce is ${input.status}. Latest complete commerce date: ${input.dataThrough || "missing"}. `
    + `Orders: ${input.ordersStatus || "unknown"}; items: ${input.itemsStatus || "unknown"}; `
    + `session publication: ${input.publicationStatus || "unknown"}. `
    + (quality ? `${quality} ` : "")
    + `Last successful ingest: ${input.lastIngestAt || "none"}. `
    + `Official async mailbox delivery is still an external-access gap; current transport may be authenticated_read_fallback.`
    + (input.error ? ` Current error: ${input.error}.` : "")
  );
}

export function trustAnswer(summary: EvidenceSummary): string {
  return (
    `You can trust the published commerce snapshot for session/basket questions through ${summary.dataThrough || "the last complete date"}, `
    + `with separate quality dimensions: ${summary.quality ? qualityNarrative(summary.quality) : "quality not measured"}. `
    + `Headline sales still come from Cash Up, not Foodics check totals. Differences are expected when VAT/scope differ.`
  );
}
