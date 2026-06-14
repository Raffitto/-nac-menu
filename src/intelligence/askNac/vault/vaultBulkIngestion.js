/**
 * Bulk folder ingestion — async queue with per-file fault isolation.
 */

import { classifyVaultUpload, mergeAutoClassification } from "./vaultAutoClassifier";
import {
  VAULT_STORAGE_BUCKET,
  isSupportedVaultUploadFile,
  isLegacyDocFile,
  LEGACY_DOC_MESSAGE,
} from "./vaultConstants";
import { vaultCanUploadBrandWide } from "./vaultAccess";
import {
  findDuplicateByContentHash,
  findDuplicateByExternalId,
  resolveDuplicateAction,
  hashFileForIngestion,
  createFileVersion,
} from "./vaultDuplicateDetection";
import {
  runVaultFileIngestionPipeline,
  resolveVaultRegistrationStatus,
} from "./vaultUploadIngestion";

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function storagePathForUpload({ fileId, branch, department, filename }) {
  const safeName = String(filename || "upload")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 120);
  const branchSegment = branch === "brand" ? "brand" : branch;
  return `${branchSegment}/${department}/${fileId}/${safeName}`;
}

function isSupportedFile(file) {
  return isSupportedVaultUploadFile(file);
}

function walkFileList(fileList) {
  const entries = [];
  for (const file of fileList) {
    if (!file?.name) continue;
    const relativePath = file.webkitRelativePath || file.name;
    entries.push({ file, relativePath });
  }
  return entries.filter(({ file }) => isSupportedFile(file));
}

/** Split folder uploads into supported files vs legacy .doc (not ingested). */
export function partitionVaultUploadFiles(fileList) {
  const legacyDocFiles = [];
  const candidates = [];

  for (const file of fileList || []) {
    if (!file?.name) continue;
    if (isLegacyDocFile(file)) {
      legacyDocFiles.push(file);
      continue;
    }
    candidates.push(file);
  }

  return {
    legacyDocFiles,
    entries: walkFileList(candidates),
  };
}

export async function createBulkImportBatch(supabase, {
  files,
  label,
  defaultBranch,
  defaultDepartment,
  session,
  profile,
  vaultRole,
  ingestionSource = "bulk_import",
}) {
  const email = normalizeEmail(session?.user?.email || profile?.email);
  if (!email) return { ok: false, error: "Sign in to import folders." };

  const { legacyDocFiles, entries } = partitionVaultUploadFiles(files);
  if (!entries.length) {
    const legacyHint =
      legacyDocFiles.length > 0 ? ` ${LEGACY_DOC_MESSAGE}` : "";
    return {
      ok: false,
      error: `No supported files found in folder (PDF, XLSX, CSV, DOCX, TXT).${legacyHint}`,
      legacyDocSkipped: legacyDocFiles.length,
    };
  }

  const { data: batch, error: batchError } = await supabase
    .from("ask_nac_bulk_import_batches")
    .insert({
      label: label || `Folder import (${entries.length} files)`,
      total_files: entries.length,
      status: "queued",
      default_branch_id: defaultBranch || null,
      default_department: defaultDepartment || null,
      created_by: profile?.name || email.split("@")[0],
      uploader_email: email,
    })
    .select("id")
    .single();

  if (batchError) return { ok: false, error: batchError.message };

  const items = entries.map(({ file, relativePath }) => ({
    batch_id: batch.id,
    relative_path: relativePath,
    original_filename: file.name,
    status: "pending",
  }));

  const { error: itemsError } = await supabase.from("ask_nac_bulk_import_items").insert(items);
  if (itemsError) return { ok: false, error: itemsError.message, batchId: batch.id };

  const { data: insertedItems } = await supabase
    .from("ask_nac_bulk_import_items")
    .select("id,original_filename,relative_path")
    .eq("batch_id", batch.id)
    .order("created_at", { ascending: true });

  const entriesWithIds = entries.map((entry, idx) => ({
    ...entry,
    itemId: insertedItems?.[idx]?.id,
  }));

  return {
    ok: true,
    batchId: batch.id,
    totalFiles: entries.length,
    entries: entriesWithIds,
    email,
    vaultRole,
    ingestionSource,
    legacyDocSkipped: legacyDocFiles.length,
  };
}

async function registerSingleBulkFile(supabase, {
  file,
  relativePath,
  batchId,
  email,
  profile,
  vaultRole,
  defaultBranch,
  defaultDepartment,
  ingestionSource,
  externalSourceId = null,
  externalModifiedAt = null,
}) {
  const contentHash = await hashFileForIngestion(file);

  let existing =
    (externalSourceId
      ? await findDuplicateByExternalId(supabase, { externalSourceId, uploaderEmail: email })
      : null) ||
    (await findDuplicateByContentHash(supabase, { contentHash, uploaderEmail: email }));

  const duplicateDecision = resolveDuplicateAction({
    existingFile: existing,
    contentHash,
    externalModifiedAt,
  });

  if (duplicateDecision.action === "skip_duplicate") {
    return {
      ok: true,
      status: "skipped",
      skipReason: duplicateDecision.reason,
      fileId: duplicateDecision.existingFileId,
    };
  }

  const autoClassification = classifyVaultUpload({
    filename: relativePath || file.name,
    metadata: { branch: defaultBranch, department: defaultDepartment },
  });
  const mergedMetadata = mergeAutoClassification(
    { branch: defaultBranch, department: defaultDepartment, useAutoClassification: true },
    autoClassification,
  );

  const brandWide = mergedMetadata.brandWide || mergedMetadata.branch === "brand";
  if (brandWide && !vaultCanUploadBrandWide(vaultRole)) {
    return { ok: false, status: "failed", error: "Brand-wide upload not permitted." };
  }

  const branch = mergedMetadata.brandWide ? null : mergedMetadata.branch;
  const fileId =
    duplicateDecision.action === "new_version" ? duplicateDecision.existingFileId : crypto.randomUUID();

  const storagePath = storagePathForUpload({
    fileId,
    branch: mergedMetadata.brandWide ? "brand" : branch,
    department: mergedMetadata.department,
    filename: file.name,
  });

  const { error: storageError } = await supabase.storage
    .from(VAULT_STORAGE_BUCKET)
    .upload(storagePath, file, { upsert: duplicateDecision.action === "new_version", contentType: file.type || undefined });

  if (storageError) {
    return { ok: false, status: "failed", error: storageError.message };
  }

  const fileRow = {
    id: fileId,
    title: mergedMetadata.title?.trim() || file.name,
    original_filename: file.name,
    storage_bucket: VAULT_STORAGE_BUCKET,
    storage_path: storagePath,
    branch_scope_type: brandWide ? "brand_wide" : "single_branch",
    primary_branch_id: branch,
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
    ingestion_source: ingestionSource,
    external_source_id: externalSourceId,
    external_source_modified_at: externalModifiedAt,
    bulk_batch_id: batchId,
  };

  if (duplicateDecision.action === "new_version") {
    await supabase.from("ask_nac_files").update(fileRow).eq("id", fileId);
  } else {
    const { error: insertError } = await supabase.from("ask_nac_files").insert(fileRow);
    if (insertError) {
      await supabase.storage.from(VAULT_STORAGE_BUCKET).remove([storagePath]);
      return { ok: false, status: "failed", error: insertError.message };
    }
  }

  const versionRow = await createFileVersion(supabase, {
    fileId,
    storagePath,
    contentHash,
    sizeBytes: file.size,
    mimeType: file.type || null,
  }).catch(() => null);

  if (duplicateDecision.action !== "new_version") {
    await supabase.from("ask_nac_data_coverage").insert({
      branch_id: branch,
      brand_wide: brandWide,
      department: mergedMetadata.department,
      report_type: mergedMetadata.reportType,
      period_start: mergedMetadata.periodStart || null,
      period_end: mergedMetadata.periodEnd || null,
      source_file_id: fileId,
      fact_count: 0,
      readiness_status: "registered",
    });
  }

  const pipeline = await runVaultFileIngestionPipeline(supabase, {
    file,
    fileRecord: fileRow,
    fileId,
    versionRowId: versionRow?.id || null,
    email,
    reportType: mergedMetadata.reportType,
  });

  const registrationStatus = resolveVaultRegistrationStatus(pipeline);

  return {
    ok: true,
    status: registrationStatus,
    fileId,
    ingestion: pipeline.ingestion,
    autoClassification,
    isNewVersion: duplicateDecision.action === "new_version",
    storedOnly: pipeline.storedOnly,
  };
}

/**
 * Process bulk batch asynchronously with progress callbacks.
 */
export async function runBulkImportBatch(supabase, {
  batchId,
  entries,
  email,
  profile,
  vaultRole,
  defaultBranch,
  defaultDepartment,
  ingestionSource = "bulk_import",
  onProgress,
  legacyDocSkipped = 0,
}) {
  const startedAt = new Date().toISOString();
  await supabase
    .from("ask_nac_bulk_import_batches")
    .update({ status: "processing", started_at: startedAt })
    .eq("id", batchId);

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const results = [];

  for (const { file, relativePath, itemId } of entries) {
    await supabase
      .from("ask_nac_bulk_import_items")
      .update({ status: "processing" })
      .eq("id", itemId);

    let result;
    try {
      result = await registerSingleBulkFile(supabase, {
        file,
        relativePath,
        batchId,
        email,
        profile,
        vaultRole,
        defaultBranch,
        defaultDepartment,
        ingestionSource,
      });
    } catch (err) {
      result = { ok: false, status: "failed", error: err?.message || "Unknown error" };
    }

    processed += 1;
    if (result.status === "skipped") skipped += 1;
    else if (result.ok) succeeded += 1;
    else failed += 1;

    await supabase
      .from("ask_nac_bulk_import_items")
      .update({
        status: result.status === "skipped" ? "duplicate" : result.ok ? "completed" : "failed",
        skip_reason: result.skipReason || null,
        error: result.error || null,
        file_id: result.fileId || null,
        finished_at: new Date().toISOString(),
        stats: { ingestion: result.ingestion?.stats || null },
      })
      .eq("id", itemId);

    if (onProgress) {
      onProgress({
        processed,
        total: entries.length,
        succeeded,
        failed,
        skipped,
        currentFile: relativePath || file.name,
      });
    }

    results.push(result);
  }

  const finishedAt = new Date().toISOString();
  await supabase
    .from("ask_nac_bulk_import_batches")
    .update({
      status: failed === entries.length ? "failed" : "completed",
      processed_files: processed,
      succeeded_files: succeeded,
      failed_files: failed,
      skipped_files: skipped,
      finished_at: finishedAt,
      stats: { succeeded, failed, skipped },
    })
    .eq("id", batchId);

  return {
    ok: failed < entries.length,
    batchId,
    processed,
    succeeded,
    failed,
    skipped,
    legacyDocSkipped,
    results,
  };
}

export async function fetchBulkImportBatchStatus(supabase, batchId) {
  if (!supabase || !batchId) return null;

  const [{ data: batch }, { data: items }] = await Promise.all([
    supabase.from("ask_nac_bulk_import_batches").select("*").eq("id", batchId).maybeSingle(),
    supabase
      .from("ask_nac_bulk_import_items")
      .select("id,original_filename,relative_path,status,skip_reason,error,file_id")
      .eq("batch_id", batchId)
      .order("created_at", { ascending: true }),
  ]);

  return { batch, items: items || [] };
}

export { walkFileList, isSupportedFile };
