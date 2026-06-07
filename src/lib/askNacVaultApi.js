/**
 * Ask NAC Data Vault registry + ingestion API.
 */

import { classifyVaultUpload, mergeAutoClassification } from "../intelligence/askNac/vault/vaultAutoClassifier";
import { VAULT_STORAGE_BUCKET } from "../intelligence/askNac/vault/vaultConstants";
import { vaultCanUploadBrandWide } from "../intelligence/askNac/vault/vaultAccess";
import { PARSEABLE_REPORT_TYPES, runVaultIngestion } from "../intelligence/askNac/vault/vaultIngestion";

const FILE_COLUMNS =
  "id,title,original_filename,storage_bucket,storage_path,primary_branch_id,brand_wide,department,report_type,data_layer,period_start,period_end,period_label,sensitivity_level,status,uploaded_by,uploader_email,classification_confidence,parser_version,created_at,updated_at";

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
  return {
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
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ limit?: number }} opts
 */
export async function listVaultFiles(supabase, { limit = 50 } = {}) {
  if (!supabase) {
    return { files: [], error: "Supabase not configured" };
  }

  const { data, error } = await supabase
    .from("ask_nac_files")
    .select(LIST_SELECT)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(limit);

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
  const storagePath = storagePathForUpload({
    fileId,
    branch: storageBranch,
    department: mergedMetadata.department,
    filename: file.name,
  });

  const row = {
    id: fileId,
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
    notes: autoClassification.matchedRules?.length
      ? `Auto-detected ${autoClassification.detectedReportType} (${autoClassification.classificationConfidence}). Manual override allowed.`
      : null,
  };

  const { error: storageError } = await supabase.storage
    .from(VAULT_STORAGE_BUCKET)
    .upload(storagePath, file, { upsert: false, contentType: file.type || undefined });

  if (storageError) {
    return {
      ok: false,
      error: storageError.message,
      hint: "Ensure migrations are applied and bucket ask-nac-vault-originals exists.",
    };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("ask_nac_files")
    .insert(row)
    .select(FILE_COLUMNS)
    .single();

  if (insertError) {
    await supabase.storage.from(VAULT_STORAGE_BUCKET).remove([storagePath]);
    return { ok: false, error: insertError.message };
  }

  const { data: versionRow, error: versionError } = await supabase
    .from("ask_nac_file_versions")
    .insert({
      file_id: fileId,
      version_no: 1,
      storage_path: storagePath,
      size_bytes: file.size,
      mime_type: file.type || null,
    })
    .select("id")
    .single();

  if (versionError) {
    return { ok: true, file: inserted, warning: versionError.message };
  }

  const parseable = PARSEABLE_REPORT_TYPES.includes(mergedMetadata.reportType);
  const { data: jobRow, error: jobError } = await supabase
    .from("ask_nac_ingestion_jobs")
    .insert({
      file_id: fileId,
      file_version_id: versionRow?.id || null,
      status: parseable ? "queued" : "registered",
      stage: parseable ? "parse" : "registry_only",
      stats: { note: parseable ? "Prototype parser queued" : "No parser for this report type yet" },
    })
    .select("id")
    .single();

  if (jobError) {
    return { ok: true, file: inserted, warning: jobError.message };
  }

  const { error: coverageError } = await supabase.from("ask_nac_data_coverage").insert({
    branch_id: primaryBranchId,
    brand_wide: brandWide,
    department: mergedMetadata.department,
    report_type: mergedMetadata.reportType,
    period_start: mergedMetadata.periodStart || null,
    period_end: mergedMetadata.periodEnd || null,
    source_file_id: fileId,
    fact_count: 0,
    readiness_status: "registered",
  });

  await supabase.from("ask_nac_file_access_log").insert({
    file_id: fileId,
    user_email: email,
    action: "upload",
    detail: {
      report_type: mergedMetadata.reportType,
      department: mergedMetadata.department,
      data_layer: mergedMetadata.dataLayer,
      auto_classification: autoClassification,
    },
  });

  let ingestion = null;
  if (parseable && jobRow?.id) {
    ingestion = await runVaultIngestion(supabase, {
      file,
      fileRecord: inserted,
      jobId: jobRow.id,
      email,
    });
  }

  return {
    ok: true,
    file: inserted,
    ingestion,
    autoClassification,
    warning: coverageError?.message || ingestion?.warning || null,
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
