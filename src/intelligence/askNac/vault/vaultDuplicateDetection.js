/**
 * Duplicate detection and version supersession for vault files.
 */

import { computeFileContentHash } from "./vaultContentHash";

const FILE_LOOKUP_COLUMNS =
  "id,title,original_filename,content_hash,primary_branch_id,report_type,period_start,period_end,status";

/**
 * Find an existing active file with the same content hash for this uploader scope.
 */
export async function findDuplicateByContentHash(supabase, { contentHash, uploaderEmail }) {
  if (!supabase || !contentHash) return null;

  const { data, error } = await supabase
    .from("ask_nac_files")
    .select(`${FILE_LOOKUP_COLUMNS}, versions:ask_nac_file_versions(id,version_no,content_hash)`)
    .eq("content_hash", contentHash)
    .eq("status", "active")
    .eq("uploader_email", uploaderEmail)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

/**
 * Find existing Drive-synced file by external id.
 */
export async function findDuplicateByExternalId(supabase, { externalSourceId, uploaderEmail }) {
  if (!supabase || !externalSourceId) return null;

  const { data } = await supabase
    .from("ask_nac_files")
    .select(FILE_LOOKUP_COLUMNS)
    .eq("external_source_id", externalSourceId)
    .eq("uploader_email", uploaderEmail)
    .eq("status", "active")
    .maybeSingle();

  return data || null;
}

/**
 * Decide duplicate action: skip, new_version, or ingest_new.
 */
export function resolveDuplicateAction({ existingFile, contentHash, externalModifiedAt }) {
  if (!existingFile) return { action: "ingest_new" };

  if (existingFile.content_hash === contentHash) {
    return {
      action: "skip_duplicate",
      reason: "Identical content already ingested.",
      existingFileId: existingFile.id,
    };
  }

  const existingModified = existingFile.external_source_modified_at
    ? new Date(existingFile.external_source_modified_at).getTime()
    : 0;
  const incomingModified = externalModifiedAt ? new Date(externalModifiedAt).getTime() : Date.now();

  if (incomingModified <= existingModified && existingFile.content_hash) {
    return {
      action: "skip_duplicate",
      reason: "Older or unchanged Drive revision.",
      existingFileId: existingFile.id,
    };
  }

  return {
    action: "new_version",
    reason: "Modified report — creating new version while preserving history.",
    existingFileId: existingFile.id,
  };
}

/**
 * Register a new file version superseding prior content.
 */
export async function createFileVersion(supabase, {
  fileId,
  storagePath,
  contentHash,
  sizeBytes,
  mimeType,
  supersedesVersionId = null,
}) {
  const { data: latest } = await supabase
    .from("ask_nac_file_versions")
    .select("id, version_no")
    .eq("file_id", fileId)
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  const versionNo = (latest?.version_no || 0) + 1;

  const { data: versionRow, error } = await supabase
    .from("ask_nac_file_versions")
    .insert({
      file_id: fileId,
      version_no: versionNo,
      storage_path: storagePath,
      size_bytes: sizeBytes,
      mime_type: mimeType,
      content_hash: contentHash,
      supersedes_version_id: supersedesVersionId || latest?.id || null,
    })
    .select("id, version_no")
    .single();

  if (error) throw new Error(error.message);

  await supabase
    .from("ask_nac_files")
    .update({
      content_hash: contentHash,
      storage_path: storagePath,
      updated_at: new Date().toISOString(),
    })
    .eq("id", fileId);

  return versionRow;
}

export async function hashFileForIngestion(file) {
  return computeFileContentHash(file);
}
