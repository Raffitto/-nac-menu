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
  sourceFreshness: string | null;
  lineage?: CommerceLineage;
};

export function buildEvidenceSummary(input: {
  dataThrough?: string | null;
  sessionsAnalyzed?: number | null;
  mappingQuality?: number | null;
  sourceFreshness?: string | null;
  coverage?: string | null;
  lineage?: CommerceLineage;
}): EvidenceSummary {
  return {
    dataThrough: input.dataThrough || null,
    salesSource: "Cash Up",
    sessionSource: "canonical commerce sessions",
    sessionsAnalyzed: input.sessionsAnalyzed ?? null,
    coverage: input.coverage || null,
    mappingQuality: input.mappingQuality ?? null,
    sourceFreshness: input.sourceFreshness || null,
    lineage: input.lineage,
  };
}

export function dataUsedAnswer(summary: EvidenceSummary): string {
  const through = summary.dataThrough || "unknown";
  const sessions = summary.sessionsAnalyzed != null ? `${summary.sessionsAnalyzed} dine-in sessions` : "no published sessions";
  const map = summary.mappingQuality != null ? `${(summary.mappingQuality * 100).toFixed(0)}% mapped` : "mapping not measured";
  return (
    `This answer uses ${summary.sessionSource} through ${through} (${sessions}; ${map}). `
    + `Headline sales remain ${summary.salesSource}. `
    + (summary.sourceFreshness ? `Commerce freshness: ${summary.sourceFreshness}.` : "")
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
  error?: string | null;
}): string {
  const map = input.mappingQuality != null ? `${(input.mappingQuality * 100).toFixed(0)}%` : "n/a";
  return (
    `Foodics commerce is ${input.status}. Latest complete commerce date: ${input.dataThrough || "missing"}. `
    + `Orders: ${input.ordersStatus || "unknown"}; items: ${input.itemsStatus || "unknown"}; `
    + `session publication: ${input.publicationStatus || "unknown"}; mapping quality: ${map}. `
    + `Last successful ingest: ${input.lastIngestAt || "none"}.`
    + (input.error ? ` Current error: ${input.error}.` : "")
  );
}
