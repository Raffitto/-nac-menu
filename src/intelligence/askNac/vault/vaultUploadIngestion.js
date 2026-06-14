/**
 * Shared post-registry ingestion for Upload Files and Import Folder (CK-1).
 */

import { isVaultReportTypeParseable } from "./vaultConstants";
import { runVaultIngestion } from "./vaultIngestion";

/**
 * Queue ingestion job and run structured parser when report type is parseable.
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
    return { ok: false, storedOnly: !parseable, jobId, jobError: jobError.message, ingestion: null };
  }

  if (!parseable) {
    return { ok: true, storedOnly: true, jobId, jobError: null, ingestion: null };
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
  };
}

/** Bulk registry item status after storage (stored-only is success, not failure). */
export function resolveVaultRegistrationStatus({ storedOnly, ingestion }) {
  if (storedOnly) return "registered";
  if (ingestion?.ok) return "completed";
  if (ingestion) return "failed";
  return "registered";
}
