/**
 * Bulk folder ingestion — async queue with per-file fault isolation.
 */

import { classifyVaultUpload, mergeAutoClassification } from "./vaultAutoClassifier";
import { VAULT_STORAGE_BUCKET } from "./vaultConstants";
import { vaultCanUploadBrandWide } from "./vaultAccess";
import {
  findDuplicateByContentHash,
  findDuplicateByExternalId,
  resolveDuplicateAction,
  hashFileForIngestion,
  createFileVersion,
} from "./vaultDuplicateDetection";
import { runVaultIngestion } from "./vaultIngestion";

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".xlsx",
  ".xls",
  ".csv",
  ".doc",
  ".docx",
  ".txt",
]);

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
  const name = String(file?.name || "").toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  return SUPPORTED_EXTENSIONS.has(ext);
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

  const entries = walkFileList(files);
  if (!entries.length) {
    return { ok: false, error: "No supported files found in folder (PDF, XLSX, CSV, DOCX, TXT)." };
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

  const { data: jobRow } = await supabase
    .from("ask_nac_ingestion_jobs")
    .insert({
      file_id: fileId,
      file_version_id: versionRow?.id || null,
      status: "queued",
      stage: "parse",
    })
    .select("id")
    .single();

  const ingestion = jobRow?.id
    ? await runVaultIngestion(supabase, {
        file,
        fileRecord: fileRow,
        jobId: jobRow.id,
        email,
      })
    : null;

  return {
    ok: true,
    status: ingestion?.ok ? "completed" : ingestion ? "failed" : "registered",
    fileId,
    ingestion,
    autoClassification,
    isNewVersion: duplicateDecision.action === "new_version",
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
