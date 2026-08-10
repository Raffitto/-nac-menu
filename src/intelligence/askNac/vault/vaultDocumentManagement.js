/**
 * Company Knowledge document management — re-index, archive, soft delete.
 * Uses existing ask_nac_files.status and chunk replace pipeline (no schema migration).
 */

import { RBAC_ROLES } from "../../../dashboard/config/rbac";
import { VAULT_STORAGE_BUCKET } from "./vaultConstants";
import { runVaultDocumentChunking } from "../../../lib/vaultChunking";
import { computeVaultKnowledgeTier } from "./vaultKnowledgeTier";

export const VAULT_DOCUMENT_ADMIN_VAULT_ROLES = new Set(["super_admin", "ceo"]);
export const VAULT_BULK_REINDEX_MAX = 50;

export const VAULT_JUNK_FILE_PATTERNS = [
  /^verify-.*\.(txt|csv)$/i,
  /^folder-verify\./i,
  /^compiler-stage-/i,
  /^ck1-/i,
  /^p\.txt$/i,
  /^test[-_.]/i,
  /^tmp[-_.]/i,
];

export function isVaultJunkFilename(filename = "") {
  const name = String(filename || "").trim();
  if (!name) return false;
  return VAULT_JUNK_FILE_PATTERNS.some((re) => re.test(name));
}

const FILE_SELECT_COLUMNS =
  "id,title,original_filename,storage_bucket,storage_path,primary_branch_id,brand_wide,department,report_type,data_layer,period_start,period_end,period_label,sensitivity_level,status,uploaded_by,uploader_email,classification_confidence,content_hash,chunk_count,search_status,searchable_at,created_at,updated_at";

/**
 * Admin document management (registry actions). Developers via RBAC or vault CEO/super_admin.
 */
export function vaultCanManageDocuments({ vaultRole = null, rbacRole = null } = {}) {
  if (VAULT_DOCUMENT_ADMIN_VAULT_ROLES.has(vaultRole)) return true;
  return rbacRole === RBAC_ROLES.DEVELOPER || rbacRole === RBAC_ROLES.CEO;
}

/** Hard delete / quarantine — developer or vault super_admin only. */
export function vaultCanDeleteDocuments({ vaultRole = null, rbacRole = null } = {}) {
  if (vaultRole === "super_admin") return true;
  return rbacRole === RBAC_ROLES.DEVELOPER;
}

/**
 * @param {object} row
 */
export function formatVaultDocumentManagementRow(row = {}) {
  const tier = row.knowledgeTier || computeVaultKnowledgeTier(row);
  const parsingStatus = row.parsingStatus || row.parsing_status || "registered";
  const parsed =
    Number(tier.factsPersisted ?? 0) > 0
    || parsingStatus === "completed"
    || tier.tier === "parsed"
    || tier.tier === "ask_nac_ready";

  const filename = row.original_filename || row.title || "—";

  return {
    id: row.id,
    filename,
    isJunk: isVaultJunkFilename(filename),
    reportType: row.report_type || "—",
    branch: row.primary_branch_id || (row.brand_wide ? "brand" : "—"),
    uploadedAt: row.created_at || null,
    searchable: (row.search_status || row.searchStatus) === "searchable",
    chunkCount: Number(row.chunk_count ?? row.chunkCount ?? 0) || 0,
    parsed,
    lastIndexedAt: row.searchable_at ?? row.searchableAt ?? null,
    status: row.status || "active",
  };
}

/**
 * Duplicate skip payload for upload UI.
 */
export function buildVaultDuplicateSkipResult({ duplicateDecision, existingFile }) {
  const existingFileId = duplicateDecision?.existingFileId || existingFile?.id || null;
  return {
    ok: true,
    skipped: true,
    reason: duplicateDecision?.reason || "Skipped: already exists.",
    skipMessage: "Skipped: already exists",
    fileId: existingFileId,
    existingFile: existingFile
      ? {
          id: existingFile.id,
          title: existingFile.title || existingFile.original_filename,
          originalFilename: existingFile.original_filename,
        }
      : null,
    duplicateAction: duplicateDecision?.action || "skip_duplicate",
    canReindex: Boolean(existingFileId),
    canUploadNewVersion: false,
  };
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

async function fetchActiveVaultFile(supabase, fileId) {
  const { data, error } = await supabase
    .from("ask_nac_files")
    .select(FILE_SELECT_COLUMNS)
    .eq("id", fileId)
    .eq("status", "active")
    .maybeSingle();

  if (error) return { file: null, error: error.message };
  if (!data) return { file: null, error: "Document not found or not active." };
  return { file: data, error: null };
}

async function fetchLatestFileVersionId(supabase, fileId) {
  const { data } = await supabase
    .from("ask_nac_file_versions")
    .select("id")
    .eq("file_id", fileId)
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

/**
 * Download stored original as a File for chunking.
 */
export async function downloadVaultOriginalFile(supabase, fileRecord) {
  const bucket = fileRecord.storage_bucket || VAULT_STORAGE_BUCKET;
  const path = fileRecord.storage_path;
  if (!path) {
    return { file: null, error: "Document has no storage path." };
  }

  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) {
    return { file: null, error: error?.message || "Could not download original file." };
  }

  const blob = data instanceof Blob ? data : new Blob([data]);
  const name = fileRecord.original_filename || fileRecord.title || "document";
  const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
  return { file, error: null };
}

async function logVaultFileAccess(supabase, { fileId, email, action, detail = {} }) {
  await supabase.from("ask_nac_file_access_log").insert({
    file_id: fileId,
    user_email: email,
    action,
    detail,
  });
}

async function executeVaultDocumentReindex(supabase, { fileId, email }) {
  const { file, error: fetchError } = await fetchActiveVaultFile(supabase, fileId);
  if (fetchError) return { ok: false, error: fetchError, fileId };

  const { file: originalFile, error: downloadError } = await downloadVaultOriginalFile(supabase, file);
  if (downloadError) return { ok: false, error: downloadError, fileId };

  const versionRowId = await fetchLatestFileVersionId(supabase, fileId);

  const chunking = await runVaultDocumentChunking(supabase, {
    file: originalFile,
    fileRecord: file,
    fileId,
    versionRowId,
  });

  await logVaultFileAccess(supabase, {
    fileId,
    email,
    action: "reindex",
    detail: {
      chunkCount: chunking.chunkCount ?? 0,
      ok: Boolean(chunking.ok),
      error: chunking.error || null,
    },
  });

  if (!chunking.ok) {
    return {
      ok: false,
      fileId,
      error: chunking.error || "Search index rebuild failed.",
      chunkCount: chunking.chunkCount ?? 0,
    };
  }

  return {
    ok: true,
    fileId,
    chunkCount: chunking.chunkCount ?? 0,
    searchableAt: chunking.searchableAt || null,
  };
}

/**
 * Rebuild search index for one document from stored original.
 */
export async function rebuildVaultDocumentSearchIndex(
  supabase,
  { fileId, session, profile, vaultRole, rbacRole },
) {
  if (!supabase || !fileId) {
    return { ok: false, error: "Missing supabase client or file id." };
  }

  const email = normalizeEmail(session?.user?.email || profile?.email);
  if (!email) {
    return { ok: false, error: "Sign in to rebuild the search index." };
  }

  if (!vaultCanManageDocuments({ vaultRole, rbacRole })) {
    return { ok: false, error: "Document management requires admin or developer access." };
  }

  return executeVaultDocumentReindex(supabase, { fileId, email });
}

/**
 * Bulk rebuild with per-file results (max 50).
 */
export async function rebuildVaultDocumentSearchIndexBulk(
  supabase,
  { fileIds = [], session, profile, vaultRole, rbacRole, onProgress },
) {
  const ids = [...new Set((fileIds || []).filter(Boolean))];
  if (!ids.length) {
    return { ok: false, error: "Select at least one document.", results: [] };
  }
  if (ids.length > VAULT_BULK_REINDEX_MAX) {
    return {
      ok: false,
      error: `Maximum ${VAULT_BULK_REINDEX_MAX} documents per batch.`,
      results: [],
    };
  }

  const results = [];
  for (let index = 0; index < ids.length; index += 1) {
    const fileId = ids[index];
    onProgress?.({
      current: index + 1,
      total: ids.length,
      fileId,
      phase: "reindex",
    });

    const result = await rebuildVaultDocumentSearchIndex(supabase, {
      fileId,
      session,
      profile,
      vaultRole,
      rbacRole,
    });

    results.push({
      fileId,
      ok: Boolean(result.ok),
      error: result.error || null,
      chunkCount: result.chunkCount ?? 0,
    });
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;

  return {
    ok: failed === 0,
    results,
    succeeded,
    failed,
  };
}

/**
 * Archive document — preserve registry + storage, remove search chunks.
 */
export async function archiveVaultDocument(
  supabase,
  { fileId, session, profile, vaultRole, rbacRole },
) {
  if (!vaultCanManageDocuments({ vaultRole, rbacRole })) {
    return { ok: false, error: "Document management requires admin or developer access." };
  }

  const email = normalizeEmail(session?.user?.email || profile?.email);
  const { file, error: fetchError } = await fetchActiveVaultFile(supabase, fileId);
  if (fetchError) return { ok: false, error: fetchError };

  const { error: chunkError } = await supabase
    .from("ask_nac_document_chunks")
    .delete()
    .eq("file_id", fileId);

  if (chunkError) {
    return { ok: false, error: chunkError.message };
  }

  const { error: updateError } = await supabase
    .from("ask_nac_files")
    .update({
      status: "archived",
      search_status: "not_searchable",
      chunk_count: 0,
      searchable_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", fileId)
    .eq("status", "active");

  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  await logVaultFileAccess(supabase, {
    fileId,
    email,
    action: "delete",
    detail: { mode: "archive", title: file.title, original_filename: file.original_filename },
  });

  return { ok: true, fileId, archived: true };
}

/**
 * Soft delete — quarantine registry row, remove chunks and storage object.
 * No hard DELETE on ask_nac_files (RLS has no delete grant).
 */
export async function deleteVaultDocument(
  supabase,
  { fileId, session, profile, vaultRole, rbacRole },
) {
  if (!vaultCanDeleteDocuments({ vaultRole, rbacRole })) {
    return { ok: false, error: "Delete requires developer or super admin access." };
  }

  const email = normalizeEmail(session?.user?.email || profile?.email);
  const { file, error: fetchError } = await fetchActiveVaultFile(supabase, fileId);
  if (fetchError) return { ok: false, error: fetchError };

  await supabase.from("ask_nac_document_chunks").delete().eq("file_id", fileId);

  if (file.storage_path) {
    await supabase.storage
      .from(file.storage_bucket || VAULT_STORAGE_BUCKET)
      .remove([file.storage_path]);
  }

  const { error: updateError } = await supabase
    .from("ask_nac_files")
    .update({
      status: "quarantined",
      search_status: "not_searchable",
      chunk_count: 0,
      searchable_at: null,
      notes: `Quarantined by ${email} on ${new Date().toISOString()}`,
      updated_at: new Date().toISOString(),
    })
    .eq("id", fileId)
    .eq("status", "active");

  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  await logVaultFileAccess(supabase, {
    fileId,
    email,
    action: "delete",
    detail: { mode: "quarantine", title: file.title, original_filename: file.original_filename },
  });

  return { ok: true, fileId, quarantined: true };
}

/**
 * Re-index after duplicate skip — uploader can rebuild their own document.
 */
export async function reindexExistingVaultDocument(
  supabase,
  { fileId, session, profile, vaultRole, rbacRole },
) {
  if (!supabase || !fileId) {
    return { ok: false, error: "Missing supabase client or file id." };
  }

  const email = normalizeEmail(session?.user?.email || profile?.email);
  if (!email) {
    return { ok: false, error: "Sign in to re-index this document." };
  }

  if (vaultCanManageDocuments({ vaultRole, rbacRole })) {
    return executeVaultDocumentReindex(supabase, { fileId, email });
  }

  const { file, error: fetchError } = await fetchActiveVaultFile(supabase, fileId);
  if (fetchError) return { ok: false, error: fetchError };

  if (normalizeEmail(file.uploader_email) !== email) {
    return { ok: false, error: "You can only re-index documents you uploaded." };
  }

  return executeVaultDocumentReindex(supabase, { fileId, email });
}
