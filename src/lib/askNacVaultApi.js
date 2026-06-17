/**
 * Ask NAC Data Vault registry + ingestion API.
 */

import { classifyVaultUpload, mergeAutoClassification } from "../intelligence/askNac/vault/vaultAutoClassifier";
import { VAULT_STORAGE_BUCKET } from "../intelligence/askNac/vault/vaultConstants";
import { vaultCanUploadBrandWide } from "../intelligence/askNac/vault/vaultAccess";
import {
  runVaultFileIngestionPipeline,
  resolveVaultUploadWarnings,
} from "../intelligence/askNac/vault/vaultUploadIngestion";
import { computeVaultKnowledgeTier } from "../intelligence/askNac/vault/vaultKnowledgeTier";
import {
  findDuplicateByContentHash,
  resolveDuplicateAction,
  hashFileForIngestion,
  createFileVersion,
} from "../intelligence/askNac/vault/vaultDuplicateDetection";
import {
  createBulkImportBatch,
  runBulkImportBatch,
  fetchBulkImportBatchStatus,
} from "../intelligence/askNac/vault/vaultBulkIngestion";
import { fetchCoverageDashboardData } from "../intelligence/askNac/vault/vaultCoverageDashboard";
import { sanitizeDriveApiResponse } from "./vaultDriveSecrets";
import {
  archiveVaultDocument,
  buildVaultDuplicateSkipResult,
  deleteVaultDocument,
  formatVaultDocumentManagementRow,
  rebuildVaultDocumentSearchIndex,
  rebuildVaultDocumentSearchIndexBulk,
  reindexExistingVaultDocument,
  vaultCanDeleteDocuments,
  vaultCanManageDocuments,
  isVaultJunkFilename,
} from "../intelligence/askNac/vault/vaultDocumentManagement";

export {
  createBulkImportBatch,
  runBulkImportBatch,
  fetchBulkImportBatchStatus,
  fetchCoverageDashboardData,
  archiveVaultDocument,
  buildVaultDuplicateSkipResult,
  deleteVaultDocument,
  formatVaultDocumentManagementRow,
  rebuildVaultDocumentSearchIndex,
  rebuildVaultDocumentSearchIndexBulk,
  reindexExistingVaultDocument,
  vaultCanDeleteDocuments,
  vaultCanManageDocuments,
  isVaultJunkFilename,
};

function driveOAuthRedirectUri() {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${window.location.pathname}`;
}

const FILE_COLUMNS =
  "id,title,original_filename,storage_bucket,storage_path,primary_branch_id,brand_wide,department,report_type,data_layer,period_start,period_end,period_label,sensitivity_level,status,uploaded_by,uploader_email,classification_confidence,parser_version,chunk_count,search_status,searchable_at,created_at,updated_at";

const LIST_SELECT = `
  ${FILE_COLUMNS},
  jobs:ask_nac_ingestion_jobs(id, status, stage, stats, error, finished_at, created_at),
  coverage:ask_nac_data_coverage(id, fact_count, readiness_status, period_start, period_end, last_ingested_at)
`;

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

/** File record for ingestion/response without INSERT RETURNING (SELECT RLS can block RETURNING). */
export function vaultFileRecordFromRegistryRow(row) {
  return { ...row };
}

function storagePathForUpload({ fileId, branch, department, filename }) {
  const safeName = String(filename || "upload")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 120);
  const branchSegment = branch === "brand" ? "brand" : branch;
  return `${branchSegment}/${department}/${fileId}/${safeName}`;
}

function latestJob(row) {
  const jobs = row?.jobs || [];
  if (!jobs.length) return null;
  return [...jobs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
}

function primaryCoverage(row) {
  const rows = row?.coverage || [];
  return rows[0] || null;
}

export function enrichVaultFileRow(row) {
  const job = latestJob(row);
  const coverage = primaryCoverage(row);
  const stats = job?.stats || {};
  const preview = stats.preview || null;
  const enriched = {
    ...row,
    latestJob: job,
    coverage,
    parsingStatus: job?.status || "registered",
    parsingStage: job?.stage || null,
    parserConfidence: row.classification_confidence ?? stats.confidence ?? null,
    confidenceLevel: stats.confidenceLevel ?? preview?.confidenceLevel ?? null,
    needsMapping: Boolean(stats.needsMapping ?? preview?.needsMapping),
    factsExtracted: stats.factsExtracted ?? stats.factCount ?? coverage?.fact_count ?? 0,
    factsPersisted: stats.factsPersisted ?? coverage?.fact_count ?? 0,
    coveragePeriodStart: coverage?.period_start ?? row.period_start,
    coveragePeriodEnd: coverage?.period_end ?? row.period_end,
    readinessStatus: coverage?.readiness_status ?? "registered",
    parsePreview: preview,
    parseWarning:
      job?.error ||
      (stats.needsMapping || preview?.needsMapping ? "Needs mapping/review." : null),
    chunkCount: Number(row.chunk_count ?? stats.chunkCount ?? 0) || 0,
    searchStatus: row.search_status ?? stats.searchStatus ?? "not_searchable",
    searchableAt: row.searchable_at ?? null,
  };
  return {
    ...enriched,
    knowledgeTier: computeVaultKnowledgeTier(enriched),
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ limit?: number }} opts
 */
export async function listVaultFiles(supabase, { limit = 100, status = "active" } = {}) {
  if (!supabase) {
    return { files: [], error: "Supabase not configured" };
  }

  let query = supabase
    .from("ask_nac_files")
    .select(LIST_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;

  if (error) {
    return { files: [], error: error.message };
  }

  return { files: (data || []).map(enrichVaultFileRow), error: null };
}

/**
 * Register file metadata, storage object, and run prototype ingestion when supported.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function registerVaultUpload(supabase, { file, metadata, session, profile }) {
  if (!supabase) {
    return { ok: false, error: "Supabase not configured" };
  }
  if (!file) {
    return { ok: false, error: "Choose a file to upload." };
  }

  const email = normalizeEmail(session?.user?.email || profile?.email);
  if (!email) {
    return { ok: false, error: "Sign in to upload to the Data Vault." };
  }

  let vaultRole = metadata.vaultRole || null;
  if (!vaultRole) {
    const staff = await fetchVaultStaffRole(supabase);
    vaultRole = staff.role;
  }

  const brandWide = metadata.brandWide || metadata.branch === "brand";
  if (brandWide && !vaultCanUploadBrandWide(vaultRole)) {
    return {
      ok: false,
      error: "Brand-wide uploads require CEO, super admin, or marketing access.",
    };
  }

  const autoClassification = classifyVaultUpload({
    filename: file.name,
    metadata,
  });
  const mergedMetadata = mergeAutoClassification(metadata, autoClassification);

  const branch = mergedMetadata.brandWide ? null : mergedMetadata.branch;
  const branchScopeType = mergedMetadata.brandWide ? "brand_wide" : "single_branch";
  const primaryBranchId = mergedMetadata.brandWide ? null : branch;
  const storageBranch = mergedMetadata.brandWide ? "brand" : branch;

  const fileId = crypto.randomUUID();
  const contentHash = await hashFileForIngestion(file);

  const existingDuplicate = await findDuplicateByContentHash(supabase, {
    contentHash,
    uploaderEmail: email,
  });
  const duplicateDecision = resolveDuplicateAction({ existingFile: existingDuplicate, contentHash });

  if (duplicateDecision.action === "skip_duplicate") {
    return buildVaultDuplicateSkipResult({
      duplicateDecision,
      existingFile: existingDuplicate,
    });
  }

  const resolvedFileId =
    duplicateDecision.action === "new_version" ? duplicateDecision.existingFileId : fileId;

  const storagePath = storagePathForUpload({
    fileId: resolvedFileId,
    branch: storageBranch,
    department: mergedMetadata.department,
    filename: file.name,
  });

  const row = {
    id: resolvedFileId,
    title: mergedMetadata.title?.trim() || file.name,
    original_filename: file.name,
    storage_bucket: VAULT_STORAGE_BUCKET,
    storage_path: storagePath,
    branch_scope_type: branchScopeType,
    primary_branch_id: primaryBranchId,
    brand_wide: brandWide,
    department: mergedMetadata.department,
    report_type: mergedMetadata.reportType,
    data_layer: mergedMetadata.dataLayer,
    period_start: mergedMetadata.periodStart || null,
    period_end: mergedMetadata.periodEnd || null,
    period_label: mergedMetadata.periodLabel || null,
    sensitivity_level: mergedMetadata.sensitivity,
    status: "active",
    uploaded_by: profile?.name || email.split("@")[0],
    uploader_email: email,
    classification_confidence: autoClassification.classificationConfidence,
    content_hash: contentHash,
    ingestion_source: "manual_upload",
    notes: autoClassification.matchedRules?.length
      ? `Auto-detected ${autoClassification.detectedReportType} (${autoClassification.classificationConfidence}). Manual override allowed.`
      : null,
  };

  const { error: storageError } = await supabase.storage
    .from(VAULT_STORAGE_BUCKET)
    .upload(storagePath, file, {
      upsert: duplicateDecision.action === "new_version",
      contentType: file.type || undefined,
    });

  if (storageError) {
    return {
      ok: false,
      error: storageError.message,
      hint: "Ensure migrations are applied and bucket ask-nac-vault-originals exists.",
    };
  }

  if (duplicateDecision.action === "new_version") {
    const { error: updateError } = await supabase
      .from("ask_nac_files")
      .update(row)
      .eq("id", resolvedFileId);
    if (updateError) {
      return { ok: false, error: updateError.message };
    }
  } else {
    const { error: insertError } = await supabase.from("ask_nac_files").insert(row);
    if (insertError) {
      await supabase.storage.from(VAULT_STORAGE_BUCKET).remove([storagePath]);
      return { ok: false, error: insertError.message };
    }
  }

  const inserted = vaultFileRecordFromRegistryRow(row);

  const versionRow = await createFileVersion(supabase, {
    fileId: resolvedFileId,
    storagePath,
    contentHash,
    sizeBytes: file.size,
    mimeType: file.type || null,
  }).catch(async () => {
    const versionId = crypto.randomUUID();
    const { error } = await supabase.from("ask_nac_file_versions").insert({
      id: versionId,
      file_id: resolvedFileId,
      version_no: 1,
      storage_path: storagePath,
      size_bytes: file.size,
      mime_type: file.type || null,
      content_hash: contentHash,
    });
    if (error) return null;
    return { id: versionId };
  });

  const pipeline = await runVaultFileIngestionPipeline(supabase, {
    file,
    fileRecord: inserted,
    fileId: resolvedFileId,
    versionRowId: versionRow?.id || null,
    email,
    reportType: mergedMetadata.reportType,
  });

  if (pipeline.jobError) {
    return { ok: true, file: inserted, warning: pipeline.jobError };
  }

  if (duplicateDecision.action !== "new_version") {
    const { error: coverageError } = await supabase.from("ask_nac_data_coverage").insert({
      branch_id: primaryBranchId,
      brand_wide: brandWide,
      department: mergedMetadata.department,
      report_type: mergedMetadata.reportType,
      period_start: mergedMetadata.periodStart || null,
      period_end: mergedMetadata.periodEnd || null,
      source_file_id: resolvedFileId,
      fact_count: 0,
      readiness_status: "registered",
    });

    if (coverageError?.message) {
      return {
        ok: true,
        file: inserted,
        warning: resolveVaultUploadWarnings({
          jobError: coverageError.message,
          ingestion: pipeline.ingestion,
          chunking: pipeline.chunking,
        }),
      };
    }
  }

  await supabase.from("ask_nac_file_access_log").insert({
    file_id: resolvedFileId,
    user_email: email,
    action: "upload",
    detail: {
      report_type: mergedMetadata.reportType,
      department: mergedMetadata.department,
      data_layer: mergedMetadata.dataLayer,
      auto_classification: autoClassification,
    },
  });

  return {
    ok: true,
    file: inserted,
    ingestion: pipeline.ingestion,
    autoClassification,
    storedOnly: pipeline.storedOnly,
    chunking: pipeline.chunking,
    warning: resolveVaultUploadWarnings({
      jobError: pipeline.jobError,
      ingestion: pipeline.ingestion,
      chunking: pipeline.chunking,
    }),
  };
}

export async function fetchVaultStaffRole(supabase) {
  if (!supabase) return { role: null, error: "Supabase not configured" };

  const { data, error } = await supabase
    .from("ask_nac_staff")
    .select("vault_role, primary_branch_id")
    .maybeSingle();

  return {
    role: data?.vault_role || null,
    primaryBranchId: data?.primary_branch_id || null,
    error: error?.message || null,
  };
}

export async function runVaultRegistryQaChecks(supabase) {
  if (!supabase) {
    return { ok: false, checks: [], error: "Supabase not configured" };
  }

  const checks = [];

  const tablesProbe = await supabase.from("ask_nac_files").select("id", { count: "exact", head: true });
  checks.push({
    id: "schema",
    label: "Vault schema reachable",
    pass: !tablesProbe.error,
    detail: tablesProbe.error?.message || "ask_nac_files OK",
  });

  const staff = await fetchVaultStaffRole(supabase);
  checks.push({
    id: "staff_map",
    label: "Current user mapped in ask_nac_staff",
    pass: Boolean(staff.role),
    detail: staff.role ? `vault_role=${staff.role}` : staff.error || "No staff row — defaults to staff role server-side",
  });

  const list = await listVaultFiles(supabase, { limit: 5 });
  checks.push({
    id: "registry_list",
    label: "Registry list (RLS-filtered)",
    pass: !list.error,
    detail: list.error || `${list.files.length} visible file(s)`,
  });

  return {
    ok: checks.every((c) => c.pass || c.id === "staff_map"),
    checks,
  };
}

function vaultFunctionsBaseUrl() {
  const url = process.env.REACT_APP_SUPABASE_URL || "";
  return url ? `${url}/functions/v1` : null;
}

export async function fetchDriveSyncStatus(supabase, session) {
  const base = vaultFunctionsBaseUrl();
  if (!base || !session?.access_token) {
    return { connected: false, folders: [], error: "Drive sync unavailable" };
  }

  const res = await fetch(`${base}/vault-drive-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "status" }),
  });
  const data = sanitizeDriveApiResponse(await res.json());
  if (!res.ok) return { connected: false, folders: [], error: data.error || "Drive status failed" };
  return data;
}

export async function startDriveOAuth(session, redirectUri = driveOAuthRedirectUri()) {
  const base = vaultFunctionsBaseUrl();
  if (!base || !session?.access_token) {
    return { ok: false, error: "Drive sync unavailable" };
  }

  const res = await fetch(`${base}/vault-drive-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "authorize", redirectUri }),
  });
  const data = sanitizeDriveApiResponse(await res.json());
  if (!res.ok) return { ok: false, error: data.error || "OAuth start failed" };
  return { ok: true, authorizeUrl: data.authorizeUrl };
}

export async function completeDriveOAuth(session, { code, redirectUri = driveOAuthRedirectUri() }) {
  const base = vaultFunctionsBaseUrl();
  if (!base || !session?.access_token || !code) {
    return { ok: false, error: "Drive OAuth callback unavailable" };
  }

  const res = await fetch(`${base}/vault-drive-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "callback", code, redirectUri }),
  });
  const data = sanitizeDriveApiResponse(await res.json());
  if (!res.ok) return { ok: false, error: data.error || "OAuth callback failed" };
  return { ok: true, googleAccountEmail: data.googleAccountEmail };
}

export async function registerDriveSyncFolder(supabase, session, {
  folderId,
  folderName,
  defaultBranchId,
  branchId,
  department,
  reportType,
  sensitivity,
  autoIngest = false,
  schedule,
}) {
  const base = vaultFunctionsBaseUrl();
  if (!base || !session?.access_token) {
    return { ok: false, error: "Drive sync unavailable" };
  }

  const res = await fetch(`${base}/vault-drive-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "register_folder",
      folderId,
      folderName,
      defaultBranchId,
      branchId,
      department,
      reportType,
      sensitivity,
      autoIngest,
      schedule,
    }),
  });
  const data = sanitizeDriveApiResponse(await res.json());
  if (!res.ok) return { ok: false, error: data.error || "Register folder failed" };
  return { ok: true, folder: data.folder };
}

export async function triggerDriveSync(session, { folderRowId, triggerType = "manual" }) {
  const base = vaultFunctionsBaseUrl();
  if (!base || !session?.access_token) {
    return { ok: false, error: "Drive sync unavailable" };
  }

  const res = await fetch(`${base}/vault-drive-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "sync", folderId: folderRowId, triggerType }),
  });
  const data = sanitizeDriveApiResponse(await res.json());
  if (!res.ok) return { ok: false, error: data.error || "Sync failed" };
  return { ok: true, ...data };
}

export async function triggerDriveSyncAndIngest(session, {
  folderRowId = null,
  triggerType = "manual",
  onlyAutoIngest = true,
} = {}) {
  const base = vaultFunctionsBaseUrl();
  if (!base || !session?.access_token) {
    return { ok: false, error: "Drive ingestion unavailable" };
  }

  const res = await fetch(`${base}/vault-drive-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "sync_ingest",
      folderId: folderRowId,
      triggerType,
      onlyAutoIngest,
    }),
  });
  const data = sanitizeDriveApiResponse(await res.json());
  if (!res.ok) return { ok: false, error: data.error || "Drive ingestion failed" };
  return { ok: true, ...data };
}

export async function fetchDriveIngestionRunStatus(session, runId) {
  const base = vaultFunctionsBaseUrl();
  if (!base || !session?.access_token || !runId) {
    return { ok: false, error: "Drive run status unavailable" };
  }

  const res = await fetch(`${base}/vault-drive-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "run_status", runId }),
  });
  const data = sanitizeDriveApiResponse(await res.json());
  if (!res.ok) return { ok: false, error: data.error || "Drive run status failed" };
  return { ok: true, ...data };
}

export async function retryDriveIngestionFile(session, { folderRowId, driveFileId }) {
  const base = vaultFunctionsBaseUrl();
  if (!base || !session?.access_token) {
    return { ok: false, error: "Drive retry unavailable" };
  }

  const res = await fetch(`${base}/vault-drive-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "retry_file", folderId: folderRowId, driveFileId }),
  });
  const data = sanitizeDriveApiResponse(await res.json());
  if (!res.ok) return { ok: false, error: data.error || "Drive retry failed" };
  return { ok: true, ...data };
}

export async function startFolderBulkImport(supabase, {
  fileList,
  label,
  defaultBranch,
  defaultDepartment,
  session,
  profile,
  vaultRole,
  onProgress,
}) {
  const batch = await createBulkImportBatch(supabase, {
    files: fileList,
    label,
    defaultBranch,
    defaultDepartment,
    session,
    profile,
    vaultRole,
  });

  if (!batch.ok) return batch;

  const result = await runBulkImportBatch(supabase, {
    batchId: batch.batchId,
    entries: batch.entries,
    email: batch.email,
    profile,
    vaultRole,
    defaultBranch,
    defaultDepartment,
    onProgress,
    legacyDocSkipped: batch.legacyDocSkipped || 0,
  });

  return { ...result, batchId: batch.batchId, legacyDocSkipped: batch.legacyDocSkipped || 0 };
}
