/**
 * NAC-owned immutable raw acquisition envelope. No cookies or secrets.
 */

export type RawSourceBatch = {
  source: "foodics" | "nac_pos";
  dataset: string;
  branchId: string;
  periodStart: string;
  periodEnd: string;
  acquisitionMode: "direct_download" | "async_email" | "authenticated_read";
  sourceRequestId: string | null;
  requestedAt: string | null;
  receivedAt: string;
  originalFilename: string | null;
  originalReference: string | null;
  checksum: string;
  schemaFingerprint: string | null;
  rowCount: number;
  sourceMetadata: Record<string, unknown>;
  status: "received" | "validated" | "quarantined" | "superseded";
  retryCount: number;
};

export function schemaFingerprint(headers: string[]): string {
  return headers.map((h) => String(h || "").trim().toLowerCase()).filter(Boolean).sort().join("|");
}

export function createRawSourceBatch(input: Omit<RawSourceBatch, "receivedAt" | "retryCount" | "status"> & {
  receivedAt?: string;
  retryCount?: number;
  status?: RawSourceBatch["status"];
}): RawSourceBatch {
  if (!input.checksum) throw new Error("raw_batch_missing_checksum");
  if (!input.dataset || !input.branchId) throw new Error("raw_batch_missing_scope");
  return {
    ...input,
    receivedAt: input.receivedAt || new Date().toISOString(),
    retryCount: input.retryCount || 0,
    status: input.status || "received",
    sourceMetadata: input.sourceMetadata || {},
  };
}
