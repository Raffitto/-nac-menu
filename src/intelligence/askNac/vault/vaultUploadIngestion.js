/**
 * Shared post-registry ingestion for Upload Files and Import Folder (CK-1 + CK-3).
 */

import { runVaultDocumentChunking } from "../../../lib/vaultChunking";
import { isVaultReportTypeParseable } from "./vaultConstants";
import { runVaultIngestion } from "./vaultIngestion";

/**
 * Queue ingestion job, chunk for search, and run structured parser when report type is parseable.
 */
export async function runVaultFileIngestionPipeline(supabase, {
  file,
  fileRecord,
  fileId,
  versionRowId = null,
  email,
  reportType,
  jobId = crypto.randomUUID(),
}) {
  const parseable = isVaultReportTypeParseable(reportType);

  const { error: jobError } = await supabase.from("ask_nac_ingestion_jobs").insert({
    id: jobId,
    file_id: fileId,
    file_version_id: versionRowId,
    status: parseable ? "queued" : "registered",
    stage: parseable ? "parse" : "registry_only",
    stats: {
      note: parseable
        ? "Structured parser queued"
        : "Stored — no structured parser for this report type",
    },
  });

  if (jobError) {
    return { ok: false, storedOnly: !parseable, jobId, jobError: jobError.message, ingestion: null, chunking: null };
  }

  const chunking = await runVaultDocumentChunking(supabase, {
    file,
    fileRecord,
    fileId,
    versionRowId,
    jobId,
  });

  if (!parseable) {
    return {
      ok: true,
      storedOnly: true,
      jobId,
      jobError: null,
      ingestion: null,
      chunking,
    };
  }

  const ingestion = await runVaultIngestion(supabase, {
    file,
    fileRecord,
    jobId,
    email,
  });

  return {
    ok: Boolean(ingestion?.ok),
    storedOnly: false,
    jobId,
    jobError: null,
    ingestion,
    chunking,
  };
}

const CHUNKING_SEARCH_WARNING_BASE =
  "File was stored, but search indexing failed. It will not appear in Ask NAC document search until re-uploaded or re-indexed.";

/**
 * Non-blocking warning when upload succeeded but document chunks were not indexed.
 * @param {{ ok?: boolean, chunkCount?: number, error?: string|null }|null} chunking
 * @returns {string|null}
 */
export function buildVaultChunkingSearchWarning(chunking) {
  if (!chunking) return null;
  if (chunking.ok && Number(chunking.chunkCount ?? 0) > 0) return null;

  const reason = String(chunking.error || "").trim();
  if (reason) {
    return `${CHUNKING_SEARCH_WARNING_BASE} Reason: ${reason}`;
  }
  return CHUNKING_SEARCH_WARNING_BASE;
}

/**
 * Merge upload warnings without failing the registry write.
 */
export function resolveVaultUploadWarnings({ jobError = null, ingestion = null, chunking = null } = {}) {
  const warnings = [];
  if (jobError) warnings.push(String(jobError).trim());
  if (ingestion?.warning) warnings.push(String(ingestion.warning).trim());
  const chunkWarning = buildVaultChunkingSearchWarning(chunking);
  if (chunkWarning) warnings.push(chunkWarning);
  return warnings.filter(Boolean).join(" ") || null;
}

/** Bulk registry item status after storage (stored-only is success, not failure). */
export function resolveVaultRegistrationStatus({ storedOnly, ingestion }) {
  if (storedOnly) return "registered";
  if (ingestion?.ok) return "completed";
  if (ingestion) return "failed";
  return "registered";
}
