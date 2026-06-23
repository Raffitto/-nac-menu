import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  FolderOpen,
  Loader2,
  Database,
  FileText,
  AlertCircle,
  RefreshCw,
  FolderInput,
  Cloud,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Link2,
  BarChart3,
  Settings2,
  Unplug,
  Archive,
  Trash2,
  RotateCw,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { useRbacOptional } from "../context/RbacContext";
import {
  listVaultFiles,
  registerVaultUpload,
  fetchVaultStaffRole,
  runVaultRegistryQaChecks,
  startFolderBulkImport,
  fetchCoverageDashboardData,
  fetchDriveSyncStatus,
  browseDriveFolder,
  startDriveOAuth,
  completeDriveOAuth,
  registerDriveSyncFolder,
  triggerDriveSync,
  triggerDriveSyncAndIngest,
  fetchDriveIngestionRunStatus,
  processDriveIngestionRuns,
  retryDriveIngestionFile,
  rebuildVaultDocumentSearchIndex,
  rebuildVaultDocumentSearchIndexBulk,
  archiveVaultDocument,
  deleteVaultDocument,
  reindexExistingVaultDocument,
  formatVaultDocumentManagementRow,
  vaultCanManageDocuments,
  vaultCanDeleteDocuments,
} from "../../lib/askNacVaultApi";
import {
  VAULT_DEPARTMENTS,
  VAULT_REPORT_TYPES,
  VAULT_SENSITIVITY_LEVELS,
  VAULT_DATA_LAYERS,
  VAULT_INGESTION_STATUS_LABELS,
  VAULT_UPLOAD_ACCEPT,
  LEGACY_DOC_MESSAGE,
  isLegacyDocFile,
  isSupportedVaultUploadFile,
  PARSEABLE_REPORT_TYPES,
  defaultVaultUploadForm,
  vaultBranchOptionsForProfile,
} from "../../intelligence/askNac/vault/vaultConstants";
import {
  VAULT_KNOWLEDGE_TIER,
  computeVaultSearchIndexStats,
  computeVaultKnowledgeTier,
} from "../../intelligence/askNac/vault/vaultKnowledgeTier";
import {
  collectFilesFromDataTransfer,
  resolveUploadFileSelection,
} from "../../intelligence/askNac/vault/vaultUploadFileCollection";
import {
  applyBulkResultsToUploadQueue,
  buildUploadQueueFromFiles,
  markUploadQueueProcessing,
  summarizeUploadQueue,
} from "../../intelligence/askNac/vault/vaultUploadQueue";
import { partitionVaultUploadFiles } from "../../intelligence/askNac/vault/vaultBulkIngestion";
import { branchDashboardName } from "../config/branchDisplayConfig";
import "../styles/ask-nac-data-vault.css";

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatLastSync(value) {
  if (!value) return "Never";
  try {
    const d = new Date(value);
    const now = new Date();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return `Today ${time}`;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return value;
  }
}

function formatLastUpdated(value) {
  if (!value) return "Not yet";
  return formatLastSync(value);
}

function branchLabel(row) {
  if (row.brand_wide) return "Brand-wide";
  if (row.primary_branch_id) return branchDashboardName(row.primary_branch_id);
  return "—";
}

function CollapsibleSection({ id, title, icon: Icon, summary, open, onToggle, children, className = "" }) {
  return (
    <section className={`nac-vault-section ${className}`.trim()} aria-labelledby={id}>
      <button
        type="button"
        id={id}
        className="nac-vault-section__toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="nac-vault-section__toggle-main">
          {Icon ? <Icon size={16} aria-hidden /> : null}
          <span>
            <strong>{title}</strong>
            {summary ? <span className="nac-vault-section__summary">{summary}</span> : null}
          </span>
        </span>
        {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
      </button>
      {open ? <div className="nac-vault-section__body">{children}</div> : null}
    </section>
  );
}

export default function AskNacDataVaultPanel({ session }) {
  const rbac = useRbacOptional();
  const profile = rbac?.profile ?? null;
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const [form, setForm] = useState(() => defaultVaultUploadForm(profile));
  const [selectedFile, setSelectedFile] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null);
  const [uploadQueue, setUploadQueue] = useState([]);
  const [coverageData, setCoverageData] = useState(null);
  const [, setCoverageAttempted] = useState(false);
  const [registryAttempted, setRegistryAttempted] = useState(false);
  const [statusNotice, setStatusNotice] = useState("");
  const [driveStatus, setDriveStatus] = useState(null);
  const [driveFolderId, setDriveFolderId] = useState("");
  const [driveFolderName, setDriveFolderName] = useState("");
  const [driveAutoIngest, setDriveAutoIngest] = useState(false);
  const [driveActionKey, setDriveActionKey] = useState(null);
  const [driveBrowserFolderId, setDriveBrowserFolderId] = useState("root");
  const [driveBrowserResult, setDriveBrowserResult] = useState(null);
  const [driveIngestRun, setDriveIngestRun] = useState(null);
  const [driveIngestRunIds, setDriveIngestRunIds] = useState([]);
  const [driveRunFiles, setDriveRunFiles] = useState([]);
  const [driveRunStale, setDriveRunStale] = useState(false);
  const [lastDriveSyncSummary, setLastDriveSyncSummary] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [vaultRole, setVaultRole] = useState(null);
  const [schemaReady, setSchemaReady] = useState(null);
  const [qaChecks, setQaChecks] = useState(null);
  const [qaLoading, setQaLoading] = useState(false);
  const [uploadPreview, setUploadPreview] = useState(null);
  const [showAdvancedUpload, setShowAdvancedUpload] = useState(false);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState(() => new Set());
  const [managementBusy, setManagementBusy] = useState(false);
  const [bulkReindexProgress, setBulkReindexProgress] = useState(null);
  const [bulkReindexResults, setBulkReindexResults] = useState([]);
  const [duplicatePrompt, setDuplicatePrompt] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState(null);

  const branchOptions = useMemo(
    () => vaultBranchOptionsForProfile(profile),
    [profile],
  );

  const runRegistryQa = useCallback(async () => {
    if (!supabase) return;
    setQaLoading(true);
    const result = await runVaultRegistryQaChecks(supabase);
    setQaChecks(result);
    setQaLoading(false);
  }, []);

  const uploadBranchOptions = useMemo(
    () => branchOptions.filter((o) => o.value !== "all"),
    [branchOptions],
  );

  const canManageDocuments = useMemo(
    () => vaultCanManageDocuments({ vaultRole, rbacRole: profile?.role }),
    [vaultRole, profile?.role],
  );

  const canDeleteDocuments = useMemo(
    () => vaultCanDeleteDocuments({ vaultRole, rbacRole: profile?.role }),
    [vaultRole, profile?.role],
  );

  const documentManagementRows = useMemo(
    () => files.map((row) => ({
      ...formatVaultDocumentManagementRow(row),
      title: row.title || row.original_filename,
    })),
    [files],
  );

  const knowledgeStats = useMemo(() => {
    const documentsStored = files.length;
    const reportsParsed = files.filter((row) => {
      const tier = row.knowledgeTier || computeVaultKnowledgeTier(row);
      return (
        tier.tier === VAULT_KNOWLEDGE_TIER.PARSED ||
        tier.tier === VAULT_KNOWLEDGE_TIER.ASK_NAC_READY
      );
    }).length;
    const foldersRegistered = (driveStatus?.folders || []).length;
    const connectedSources = driveStatus?.connected ? 1 : 0;
    const lastUpdated = files.reduce((latest, row) => {
      if (!row.created_at) return latest;
      return !latest || row.created_at > latest ? row.created_at : latest;
    }, null);
    const branchScores = ["khobar", "riyadh", "jeddah"].map((id) => coverageData?.[id]?.overallScore ?? 0);
    const coveragePct = branchScores.length
      ? Math.round(branchScores.reduce((a, b) => a + b, 0) / branchScores.length)
      : 0;
    const searchIndex = computeVaultSearchIndexStats(files);
    return {
      documentsStored,
      reportsParsed,
      foldersRegistered,
      connectedSources,
      lastUpdated,
      coveragePct,
      searchIndexLabel: searchIndex.label,
      searchableFiles: searchIndex.searchableFiles,
      totalChunks: searchIndex.totalChunks,
    };
  }, [files, driveStatus, coverageData]);

  const driveLastSyncAt = useMemo(() => {
    const folders = driveStatus?.folders || [];
    if (!folders.length) return driveStatus?.connection?.connected_at || null;
    return folders.reduce((latest, folder) => {
      if (!folder.last_sync_at) return latest;
      return !latest || folder.last_sync_at > latest ? folder.last_sync_at : latest;
    }, null);
  }, [driveStatus]);

  const driveSyncStats = useMemo(
    () => ({
      discovered: lastDriveSyncSummary?.discovered ?? 0,
      changed: lastDriveSyncSummary?.changed ?? 0,
      skipped: lastDriveSyncSummary?.skipped ?? 0,
    }),
    [lastDriveSyncSummary],
  );

  const driveIngestStats = useMemo(() => {
    const run = driveIngestRun || {};
    return {
      discovered: run.discovered_count ?? run.files_discovered ?? 0,
      foldersScanned: run.stats?.folders_scanned ?? run.stats?.foldersScanned ?? run.folders_scanned ?? 0,
      maxDepth: run.stats?.max_depth ?? run.stats?.maxDepth ?? run.max_depth ?? 0,
      newCount: run.new_count ?? run.files_new ?? 0,
      changed: run.changed_count ?? run.files_changed ?? 0,
      skipped: run.skipped_count ?? run.files_skipped ?? 0,
      downloaded: run.downloaded_count ?? 0,
      extracted: run.extracted_count ?? 0,
      parsed: run.parsed_count ?? 0,
      indexed: run.indexed_count ?? 0,
      failed: run.failed_count ?? run.files_failed ?? 0,
      currentFile: run.current_file,
      runtimeStage: run.runtime_stage || run.stats?.runtimeStage || null,
      errorMessage: run.error_message || run.error || run.stats?.exception || null,
      selectedFoldersCount: run.selected_folders_count ?? run.stats?.selectedFoldersCount ?? 0,
      selectedDriveFolderIds: run.selected_drive_folder_ids || run.stats?.selectedDriveFolderIds || [],
      status: run.status || "idle",
    };
  }, [driveIngestRun]);

  const statusClass = (status) => {
    if (status === "completed") return "is-completed";
    if (status === "failed") return "is-failed";
    if (status === "processing") return "is-processing";
    return "is-registered";
  };

  const formatConfidence = (value) => {
    if (value == null || Number.isNaN(Number(value))) return "—";
    return `${Math.round(Number(value) * 100)}%`;
  };

  const loadRegistry = useCallback(async () => {
    if (!isSupabaseConfigured() || !supabase) {
      setSchemaReady(false);
      setRegistryAttempted(true);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [{ files: rows, error: listError }, staff] = await Promise.all([
        listVaultFiles(supabase),
        fetchVaultStaffRole(supabase),
      ]);

      if (listError?.includes("does not exist") || listError?.includes("ask_nac_files")) {
        setSchemaReady(false);
        setError("Data Vault schema not applied yet. Run the Supabase migration.");
      } else if (listError) {
        setSchemaReady(true);
        setError(listError);
        setStatusNotice("Document registry could not be loaded.");
      } else {
        setSchemaReady(true);
        setError("");
        setStatusNotice("");
      }

      setFiles(rows || []);
      setVaultRole(staff?.role ?? null);
    } catch {
      setSchemaReady(true);
      setStatusNotice("Document registry could not be loaded.");
      setFiles([]);
    } finally {
      setLoading(false);
      setRegistryAttempted(true);
    }
  }, []);

  useEffect(() => {
    loadRegistry();
  }, [loadRegistry]);

  const loadCoverage = useCallback(async () => {
    if (!supabase) {
      setCoverageAttempted(true);
      return;
    }
    try {
      const result = await fetchCoverageDashboardData(supabase);
      setCoverageData(result.branches || {});
      if (result.error) {
        setCoverageData({});
        setStatusNotice((prev) => prev || "Coverage summary unavailable — showing counts only.");
      }
    } catch {
      setCoverageData({});
      setStatusNotice((prev) => prev || "Coverage summary unavailable — showing counts only.");
    } finally {
      setCoverageAttempted(true);
    }
  }, []);

  const loadDriveStatus = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const status = await fetchDriveSyncStatus(supabase, session);
      setDriveStatus(status);
    } catch {
      setDriveStatus({ connected: false, folders: [], error: "Drive status unavailable" });
    }
  }, [session]);

  useEffect(() => {
    if (schemaReady === false) {
      setCoverageAttempted(true);
      return;
    }
    loadCoverage();
    if (schemaReady) {
      loadDriveStatus();
    }
  }, [schemaReady, loadCoverage, loadDriveStatus]);

  useEffect(() => {
    if (!session?.access_token || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) return;

    let cancelled = false;
    (async () => {
      const result = await completeDriveOAuth(session, { code });
      if (cancelled) return;
      window.history.replaceState({}, "", `${window.location.origin}${window.location.pathname}`);
      if (!result.ok) {
        setError(result.error || "Google Drive connection failed.");
        return;
      }
      setNotice(`Google Drive connected${result.googleAccountEmail ? `: ${result.googleAccountEmail}` : ""}.`);
      await loadDriveStatus();
    })();

    return () => {
      cancelled = true;
    };
  }, [session, loadDriveStatus]);

  useEffect(() => {
    setForm((prev) => ({
      ...defaultVaultUploadForm(profile),
      department: prev.department,
      reportType: prev.reportType,
      sensitivity: prev.sensitivity,
      dataLayer: prev.dataLayer,
    }));
  }, [profile]);

  const onFieldChange = (key, value) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "branch") {
        next.brandWide = value === "brand";
      }
      if (key === "reportType") {
        if (value === "brand_brain_sop") next.dataLayer = "brand_brain";
        if (value === "cash_up") next.sensitivity = "management";
        if (value === "ccm_reconciliation") {
          next.sensitivity = "finance";
          next.department = "admin";
        }
      }
      return next;
    });
  };

  const uploadQueueStats = useMemo(() => summarizeUploadQueue(uploadQueue), [uploadQueue]);

  const reportSelectionRejections = useCallback((legacyRejected, unsupportedRejected) => {
    if (legacyRejected.length) {
      setError(LEGACY_DOC_MESSAGE);
      return true;
    }
    if (unsupportedRejected.length) {
      setError("Unsupported file type. Use PDF, XLSX, XLS, CSV, DOCX, or TXT.");
      return true;
    }
    return false;
  }, []);

  const refreshKnowledgeStatus = useCallback(async () => {
    await loadRegistry();
    await loadCoverage();
  }, [loadRegistry, loadCoverage]);

  useEffect(() => {
    if (!driveIngestRun?.id || !session?.access_token) return undefined;
    let cancelled = false;
    let timer = null;
    let staleTimer = null;

    const poll = async () => {
      const result = await fetchDriveIngestionRunStatus(session, driveIngestRun.id);
      if (cancelled) return;
      if (!result.ok) {
        setDriveIngestRun((prev) => (prev ? { ...prev, status: "failed", error: result.error } : prev));
        setDriveActionKey(null);
        setError(result.error || "Drive run status failed.");
        return;
      }
      setDriveIngestRun(result.run);
      setDriveRunFiles(result.files || []);
      const updatedAt = result.run?.updated_at || result.run?.created_at;
      if (updatedAt && Date.now() - new Date(updatedAt).getTime() > 90000) {
        setDriveRunStale(true);
        setDriveActionKey(null);
        setError("Drive ingestion has not updated for over 90 seconds. Check run diagnostics in System Details.");
      } else {
        setDriveRunStale(false);
      }
      if (["queued", "running", "processing"].includes(result.run?.status)) {
        timer = window.setTimeout(poll, 2500);
      } else {
        setDriveActionKey(null);
        if (result.run?.status === "failed") {
          setError(result.run.error_message || result.run.error || "Drive ingestion failed.");
        } else if (result.run?.status === "completed_empty") {
          setNotice(
            result.run.error_message ||
              result.run.error ||
              "Drive folder scanned successfully but no child files/folders were returned.",
          );
        } else if (result.run?.status === "partial") {
          setNotice("Drive ingestion partially completed. Review skipped/failed files and run again to continue.");
        }
        await loadDriveStatus();
        await refreshKnowledgeStatus();
      }
    };

    timer = window.setTimeout(poll, 1000);
    staleTimer = window.setTimeout(() => {
      if (!cancelled) {
        setDriveRunStale(true);
        setDriveActionKey(null);
      }
    }, 120000);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      if (staleTimer) window.clearTimeout(staleTimer);
    };
  }, [driveIngestRun?.id, session, loadDriveStatus, refreshKnowledgeStatus]);

  const runBulkImport = useCallback(
    async (fileList, { label = "Bulk import", source = "bulk" } = {}) => {
      if (!fileList?.length || !session?.user) return;

      const { legacyDocFiles, entries } = partitionVaultUploadFiles(fileList);
      if (!entries.length) {
        if (legacyDocFiles.length) setError(LEGACY_DOC_MESSAGE);
        else setError("No supported files to import. Use PDF, XLSX, XLS, CSV, DOCX, or TXT.");
        return;
      }

      setSelectedFile(null);
      setBulkImporting(true);
      setUploadQueue(buildUploadQueueFromFiles(fileList));
      setBulkProgress({
        processed: 0,
        total: entries.length,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      });
      setError("");
      setNotice("");

      const result = await startFolderBulkImport(supabase, {
        fileList,
        label: `${label} (${entries.length} files)`,
        defaultBranch: form.branch === "brand" ? "khobar" : form.branch,
        defaultDepartment: form.department,
        session,
        profile,
        vaultRole,
        onProgress: (progress) => {
          setBulkProgress(progress);
          setUploadQueue((prev) => markUploadQueueProcessing(prev, progress));
        },
      });

      setBulkImporting(false);
      setUploadQueue((prev) => applyBulkResultsToUploadQueue(prev, entries, result.results || []));

      if (source === "folder" && folderInputRef.current) {
        folderInputRef.current.value = "";
      }
      if (source === "file" && fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      if (!result.ok && !result.succeeded) {
        setError(result.error || "Bulk import failed.");
        await refreshKnowledgeStatus();
        return;
      }

      const legacyLine =
        result.legacyDocSkipped > 0
          ? `${result.legacyDocSkipped} legacy .doc file(s) skipped — DOCX required.`
          : "";

      const searchLine =
        result.searchIndexingFailed > 0
          ? `${result.searchIndexingFailed} file(s) stored but search indexing failed — re-upload or re-index to enable Ask NAC document search.`
          : "";

      setNotice(
        [
          `${label} complete: ${result.succeeded} succeeded, ${result.skipped} skipped, ${result.failed} failed.`,
          legacyLine,
          searchLine,
        ]
          .filter(Boolean)
          .join(" "),
      );
      await refreshKnowledgeStatus();
    },
    [session, form.branch, form.department, profile, vaultRole, refreshKnowledgeStatus],
  );

  const onFilesChosen = useCallback(
    async (fileList) => {
      const selection = resolveUploadFileSelection(fileList);
      if (selection.mode === "none") {
        if (reportSelectionRejections(selection.legacyRejected, selection.unsupportedRejected)) {
          if (fileInputRef.current) fileInputRef.current.value = "";
        }
        return;
      }

      if (selection.legacyRejected.length || selection.unsupportedRejected.length) {
        setNotice(
          [
            selection.unsupportedRejected.length
              ? `${selection.unsupportedRejected.length} unsupported file(s) skipped.`
              : "",
            selection.legacyRejected.length
              ? `${selection.legacyRejected.length} legacy .doc file(s) skipped.`
              : "",
          ]
            .filter(Boolean)
            .join(" "),
        );
      }

      if (selection.mode === "single") {
        setError("");
        setUploadQueue([]);
        setSelectedFile(selection.files[0]);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      await runBulkImport(selection.files, { label: "File upload", source: "file" });
    },
    [reportSelectionRejections, runBulkImport],
  );

  const toggleDocSelection = useCallback((fileId) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }, []);

  const toggleSelectAllDocs = useCallback(() => {
    setSelectedDocIds((prev) => {
      if (prev.size === documentManagementRows.length) return new Set();
      return new Set(documentManagementRows.map((row) => row.id));
    });
  }, [documentManagementRows]);

  const onReindexDocument = useCallback(
    async (fileId) => {
      if (!fileId || managementBusy) return;
      setManagementBusy(true);
      setError("");
      const result = await rebuildVaultDocumentSearchIndex(supabase, {
        fileId,
        session,
        profile,
        vaultRole,
        rbacRole: profile?.role,
      });
      setManagementBusy(false);
      if (!result.ok) {
        setError(result.error || "Search index rebuild failed.");
        return;
      }
      setNotice(`Search index rebuilt: ${result.chunkCount} chunk(s).`);
      await refreshKnowledgeStatus();
    },
    [managementBusy, session, profile, vaultRole, refreshKnowledgeStatus],
  );

  const onBulkReindexDocuments = useCallback(async () => {
    const fileIds = [...selectedDocIds];
    if (!fileIds.length || managementBusy) return;
    setManagementBusy(true);
    setBulkReindexResults([]);
    setBulkReindexProgress({ current: 0, total: fileIds.length });
    setError("");

    const result = await rebuildVaultDocumentSearchIndexBulk(supabase, {
      fileIds,
      session,
      profile,
      vaultRole,
      rbacRole: profile?.role,
      onProgress: (progress) => setBulkReindexProgress(progress),
    });

    setManagementBusy(false);
    setBulkReindexProgress(null);
    setBulkReindexResults(result.results || []);
    setSelectedDocIds(new Set());

    if (!result.ok && !result.results?.length) {
      setError(result.error || "Bulk re-index failed.");
      return;
    }

    setNotice(
      `Bulk re-index complete: ${result.succeeded ?? 0} succeeded, ${result.failed ?? 0} failed.`,
    );
    await refreshKnowledgeStatus();
  }, [selectedDocIds, managementBusy, session, profile, vaultRole, refreshKnowledgeStatus]);

  const onArchiveDocument = useCallback(
    async (fileId) => {
      if (!fileId || managementBusy) return;
      setManagementBusy(true);
      setError("");
      const result = await archiveVaultDocument(supabase, {
        fileId,
        session,
        profile,
        vaultRole,
        rbacRole: profile?.role,
      });
      setManagementBusy(false);
      setConfirmArchiveId(null);
      if (!result.ok) {
        setError(result.error || "Archive failed.");
        return;
      }
      setSelectedDocIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
      setNotice("Document archived. It will no longer appear in search.");
      await refreshKnowledgeStatus();
    },
    [managementBusy, session, profile, vaultRole, refreshKnowledgeStatus],
  );

  const onDeleteDocument = useCallback(
    async (fileId) => {
      if (!fileId || managementBusy) return;
      setManagementBusy(true);
      setError("");
      const result = await deleteVaultDocument(supabase, {
        fileId,
        session,
        profile,
        vaultRole,
        rbacRole: profile?.role,
      });
      setManagementBusy(false);
      setConfirmDeleteId(null);
      if (!result.ok) {
        setError(result.error || "Delete failed.");
        return;
      }
      setSelectedDocIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
      setNotice("Document removed from Company Knowledge.");
      await refreshKnowledgeStatus();
    },
    [managementBusy, session, profile, vaultRole, refreshKnowledgeStatus],
  );

  const onReindexDuplicate = useCallback(async () => {
    if (!duplicatePrompt?.fileId) return;
    setManagementBusy(true);
    setError("");
    const result = await reindexExistingVaultDocument(supabase, {
      fileId: duplicatePrompt.fileId,
      session,
      profile,
      vaultRole,
      rbacRole: profile?.role,
    });
    setManagementBusy(false);
    setDuplicatePrompt(null);
    if (!result.ok) {
      setError(result.error || "Re-index failed.");
      return;
    }
    setNotice(`Existing document re-indexed: ${result.chunkCount} chunk(s).`);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await refreshKnowledgeStatus();
  }, [duplicatePrompt, session, profile, vaultRole, refreshKnowledgeStatus]);

  const onUpload = async () => {
    if (!selectedFile) {
      setError("Select a file before uploading.");
      return;
    }
    if (isLegacyDocFile(selectedFile)) {
      setError(LEGACY_DOC_MESSAGE);
      return;
    }
    if (!isSupportedVaultUploadFile(selectedFile)) {
      setError("Unsupported file type. Use PDF, XLSX, XLS, CSV, DOCX, or TXT.");
      return;
    }
    if (!session?.user) {
      setError("Sign in to register files in the Data Vault.");
      return;
    }

    setUploading(true);
    setError("");
    setNotice("");
    setUploadPreview(null);

    const result = await registerVaultUpload(supabase, {
      file: selectedFile,
      metadata: form,
      session,
      profile,
    });

    setUploading(false);

    if (!result.ok) {
      setError(result.error || "Upload failed.");
      return;
    }

    if (result.skipped) {
      if (result.canReindex) {
        setDuplicatePrompt({
          fileId: result.fileId,
          reason: result.reason,
          skipMessage: result.skipMessage,
          existingFile: result.existingFile,
        });
      } else {
        setNotice(result.reason || "Duplicate file skipped.");
      }
      await refreshKnowledgeStatus();
      return;
    }

    if (result.storedOnly) {
      setNotice(
        [
          "Document stored. No structured parser for this report type — Ask NAC uses parsed operational reports today.",
          result.warning,
        ]
          .filter(Boolean)
          .join(" "),
      );
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refreshKnowledgeStatus();
      return;
    }

    const ingest = result.ingestion;
    const ingestLine = ingest
      ? ingest.ok
        ? `Imported: ${ingest.factsPersisted} operational fact(s) saved${ingest.publish ? "" : " (low confidence — raw extract)"}.`
        : `Document saved; parser ${ingest.status || "failed"}: ${ingest.error || "unknown error"}.`
      : "Document saved. No parser for this report type yet.";

    setNotice([ingestLine, result.warning].filter(Boolean).join(" "));
    if (ingest?.preview) setUploadPreview(ingest.preview);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await refreshKnowledgeStatus();
  };

  const onFolderSelected = async (fileList) => {
    if (!fileList?.length || !session?.user) return;
    await runBulkImport(fileList, { label: "Folder import", source: "folder" });
  };

  const onFolderDrop = async (event) => {
    event.preventDefault();
    if (!session?.user) {
      setError("Sign in to register files in the Data Vault.");
      return;
    }

    try {
      const dropped = await collectFilesFromDataTransfer(event.dataTransfer);
      if (!dropped.length) {
        setError("No supported files found in the drop.");
        return;
      }
      await runBulkImport(dropped, { label: "Drop import", source: "drop" });
    } catch (err) {
      setError(err?.message || "Could not read dropped files.");
    }
  };

  const onConnectDrive = async () => {
    setDriveActionKey("connect");
    const result = await startDriveOAuth(session);
    if (!result.ok) {
      setDriveActionKey(null);
      setError(result.error || "Could not start Google Drive connection.");
      return;
    }
    window.location.href = result.authorizeUrl;
  };

  const onBrowseDriveFolder = async ({ recursive = false, folderId = null } = {}) => {
    if (!driveConnected) {
      setError("Connect Google Drive before browsing folders.");
      return;
    }
    const targetFolderId = String(folderId || driveBrowserFolderId).trim() || "root";
    const key = recursive ? "browse:recursive" : "browse";
    setDriveActionKey(key);
    setError("");
    const result = await browseDriveFolder(session, {
      folderId: targetFolderId,
      recursive,
    });
    setDriveActionKey(null);
    if (!result.ok) {
      setError(result.error || "Drive browse failed.");
      return;
    }
    setDriveBrowserResult(result);
    setNotice(
      recursive
        ? `Drive scan found ${(result.files || []).length} file(s) across ${result.foldersScanned || 0} folder(s).`
        : `Drive folder loaded: ${(result.folders || []).length} folder(s), ${(result.files || []).length} file(s).`,
    );
  };

  const onUseDriveFolder = (folder) => {
    if (!folder?.id) return;
    setDriveFolderId(folder.id);
    setDriveFolderName(folder.name || folder.id);
    if (folder.likelyReportType && folder.likelyReportType !== "other") {
      onFieldChange("reportType", folder.likelyReportType);
    } else if (/\bweekly dashboards?\b|\bexecutive reports?\b/i.test(String(folder.name || ""))) {
      onFieldChange("reportType", "weekly_dashboard");
    }
  };

  const onRegisterDriveFolder = async () => {
    if (!driveFolderId.trim()) {
      setError("Enter a Google Drive folder ID.");
      return;
    }
    if (driveAutoIngest && form.branch === "brand") {
      setError("Select a branch before enabling Drive auto-ingest for a folder.");
      return;
    }
    const folderLabel = `${driveFolderName} ${driveBrowserResult?.folder?.name || ""}`.toLowerCase();
    const isDiscoveryRoot =
      /^(daily|weekly)$/.test(folderLabel.trim())
      || (/\bdaily\b|\bweekly\b/.test(folderLabel) && !/\bcash|\blogbook|\bbriefing\b/.test(folderLabel));
    const reportType = isDiscoveryRoot
      ? "discovery_root"
      : /\bcash[\s-]?up|cashup|daily cash report\b/i.test(folderLabel)
      ? "cash_up"
      : /\bweekly dashboards?\b|\bexecutive reports?\b.*\bweekly\b/i.test(folderLabel)
        ? "weekly_dashboard"
        : form.reportType;
    const result = await registerDriveSyncFolder(supabase, session, {
      folderId: driveFolderId.trim(),
      folderName: driveFolderName.trim() || driveFolderId.trim(),
      defaultBranchId: form.branch === "brand" ? null : form.branch,
      branchId: form.branch === "brand" ? null : form.branch,
      department: form.department,
      reportType,
      sensitivity: form.sensitivity,
      autoIngest: driveAutoIngest,
      isDiscoveryRoot,
      schedule: "daily",
    });
    if (!result.ok) {
      setError(result.error || "Could not register folder.");
      return;
    }
    setNotice("Drive folder registered for sync.");
    setDriveFolderId("");
    setDriveFolderName("");
    setDriveAutoIngest(false);
    await loadDriveStatus();
  };

  const onManualDriveSync = async (folderRowId, { quiet = false } = {}) => {
    if (!quiet) setDriveActionKey(`metadata:${folderRowId}`);
    const result = await triggerDriveSync(session, { folderRowId });
    if (!quiet) setDriveActionKey(null);
    if (!result.ok) {
      if (!quiet) setError(result.error || "Drive sync failed.");
      return result;
    }
    setLastDriveSyncSummary({
      at: new Date().toISOString(),
      discovered: result.discovered ?? 0,
      changed: result.changed ?? 0,
      skipped: result.skipped ?? 0,
    });
    if (!quiet) {
      setNotice(
        [
          result.note ||
            "Drive sync completed as metadata-only. Download and ingestion require the separate vault bulk pipeline.",
          `${result.discovered} discovered, ${result.changed} new/changed, ${result.skipped} skipped.`,
        ].join(" "),
      );
    }
    await loadDriveStatus();
    return result;
  };

  const onSyncAllDriveFolders = async () => {
    const folders = driveStatus?.folders || [];
    if (!folders.length) {
      setError("Register a Google Drive folder in Advanced Tools before syncing.");
      return;
    }
    setDriveActionKey("metadata:all");
    setError("");
    let lastResult = null;
    for (const folder of folders) {
      lastResult = await onManualDriveSync(folder.id, { quiet: true });
      if (!lastResult?.ok) break;
    }
    setDriveActionKey(null);
    if (lastResult?.ok) {
      setNotice(
        [
          lastResult.note ||
            "Drive sync completed as metadata-only. Download and ingestion require the separate vault bulk pipeline.",
          `${lastResult.discovered} discovered, ${lastResult.changed} new/changed, ${lastResult.skipped} skipped.`,
        ].join(" "),
      );
    }
  };

  const onSyncAndIngestDrive = async () => {
    const folders = (driveStatus?.folders || []).filter((folder) => folder.auto_ingest);
    if (!folders.length) {
      setError("Enable auto-ingest on at least one registered Drive folder before running ingestion.");
      return;
    }
    setDriveActionKey("ingest:all");
    setError("");
    setNotice("");
    const result = await triggerDriveSyncAndIngest(session, { onlyAutoIngest: true });
    if (!result.ok) {
      setDriveActionKey(null);
      setError(result.error || "Drive ingestion failed.");
      return;
    }
    const runIds = result.runIds?.length ? result.runIds : [result.runId].filter(Boolean);
    setDriveIngestRunIds(runIds);
    setDriveIngestRun({ id: result.runId, status: "queued" });
    setDriveRunFiles([]);
    setDriveRunStale(false);
    setNotice(`Drive ingestion queued. Run ID: ${result.runId}`);
    processDriveIngestionRuns(session, { runIds }).then((processed) => {
      if (!processed.ok) {
        setDriveActionKey(null);
        setError(processed.error || "Drive ingestion processing failed.");
      }
    });
  };

  const onRetryDriveFile = async (file) => {
    if (!file?.drive_file_id || !driveIngestRun?.folder_id) return;
    const key = `retry:${file.id}`;
    setDriveActionKey(key);
    setError("");
    const result = await retryDriveIngestionFile(session, {
      folderRowId: driveIngestRun.folder_id,
      driveFileId: file.drive_file_id,
    });
    if (!result.ok) {
      setDriveActionKey(null);
      setError(result.error || "Drive retry failed.");
      return;
    }
    const runIds = result.runIds?.length ? result.runIds : [result.runId].filter(Boolean);
    setDriveIngestRunIds(runIds);
    setDriveIngestRun({ id: result.runId, status: "queued" });
    setDriveRunFiles([]);
    setNotice(`Drive retry queued for ${file.file_name}.`);
    processDriveIngestionRuns(session, {
      runIds,
      maxFilesToProcess: 1,
      driveFileId: file.drive_file_id,
      force: true,
    }).then((processed) => {
      if (!processed.ok) {
        setDriveActionKey(null);
        setError(processed.error || "Drive retry processing failed.");
      }
    });
  };

  const onDisconnectDrive = () => {
    window.open("https://myaccount.google.com/permissions", "_blank", "noopener,noreferrer");
    setNotice(
      "To disconnect Google Drive, remove NAC OS access in your Google Account settings, then refresh this page.",
    );
  };

  const showUploadControls = Boolean(session?.user) && schemaReady !== false;
  const driveConnected = Boolean(driveStatus?.connected);
  const driveEmail = driveStatus?.connection?.google_account_email;
  const statusReady = registryAttempted;
  const driveRunActive = ["queued", "running", "processing"].includes(driveIngestRun?.status);

  const metadataFields = (
    <div className="nac-ask-vault__grid">
      <label>
        Branch
        <select
          value={form.branch}
          onChange={(e) => onFieldChange("branch", e.target.value)}
          disabled={uploading}
        >
          {uploadBranchOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Department
        <select
          value={form.department}
          onChange={(e) => onFieldChange("department", e.target.value)}
          disabled={uploading}
        >
          {VAULT_DEPARTMENTS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Report type
        <select
          value={form.reportType}
          onChange={(e) => onFieldChange("reportType", e.target.value)}
          disabled={uploading}
        >
          {VAULT_REPORT_TYPES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Sensitivity
        <select
          value={form.sensitivity}
          onChange={(e) => onFieldChange("sensitivity", e.target.value)}
          disabled={uploading}
        >
          {VAULT_SENSITIVITY_LEVELS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Data layer
        <select
          value={form.dataLayer}
          onChange={(e) => onFieldChange("dataLayer", e.target.value)}
          disabled={uploading}
        >
          {VAULT_DATA_LAYERS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Period start
        <input
          type="date"
          value={form.periodStart}
          onChange={(e) => onFieldChange("periodStart", e.target.value)}
          disabled={uploading}
        />
      </label>

      <label>
        Period end
        <input
          type="date"
          value={form.periodEnd}
          onChange={(e) => onFieldChange("periodEnd", e.target.value)}
          disabled={uploading}
        />
      </label>

      <label className="nac-ask-vault__span2">
        Title (optional)
        <input
          type="text"
          value={form.title}
          placeholder={selectedFile?.name || "Display title"}
          onChange={(e) => onFieldChange("title", e.target.value)}
          disabled={uploading}
        />
      </label>
    </div>
  );

  return (
    <section className="nac-glass-panel nac-ask-vault" aria-labelledby="ask-nac-vault-heading">
      <header className="nac-ask-vault__header">
        <div>
          <p className="nac-ask-nac-eyebrow">Operational knowledge</p>
          <h3 id="ask-nac-vault-heading">Company Knowledge</h3>
          <p className="nac-ask-vault__intro">
            Central place for reports, SOPs, audits, sales exports, training documents, and branch operational
            knowledge that powers Ask NAC answers.
          </p>
        </div>
        <button type="button" className="nac-ask-vault__refresh" onClick={loadRegistry} disabled={loading}>
          <RefreshCw size={14} className={loading ? "nac-bi-spin" : ""} />
          Refresh
        </button>
      </header>

      {!isSupabaseConfigured() ? (
        <p className="nac-ask-vault__warn" role="alert">
          Supabase is not configured — knowledge base unavailable.
        </p>
      ) : null}

      {schemaReady === false ? (
        <div className="nac-ask-vault__empty">
          <Database size={22} aria-hidden />
          <p>Knowledge base setup is pending. Expand System Details for migration guidance.</p>
        </div>
      ) : (
        <>
          {error ? (
            <div className="nac-ask-vault__error" role="alert">
              <AlertCircle size={16} />
              {error}
            </div>
          ) : null}

          {notice ? <p className="nac-ask-vault__notice">{notice}</p> : null}
          {duplicatePrompt ? (
            <div className="nac-vault-duplicate-prompt" role="status">
              <p>
                <strong>{duplicatePrompt.skipMessage || "Skipped: already exists"}</strong>
                {duplicatePrompt.existingFile?.title
                  ? ` — ${duplicatePrompt.existingFile.title}`
                  : ""}
                {duplicatePrompt.reason ? ` (${duplicatePrompt.reason})` : ""}
              </p>
              <div className="nac-vault-duplicate-prompt__actions">
                {duplicatePrompt.canReindex !== false ? (
                  <button
                    type="button"
                    className="nac-vault-action-btn nac-vault-action-btn--primary"
                    disabled={managementBusy}
                    onClick={onReindexDuplicate}
                  >
                    <RotateCw size={14} aria-hidden />
                    Re-index existing document
                  </button>
                ) : null}
                <button
                  type="button"
                  className="nac-vault-action-btn nac-vault-action-btn--secondary"
                  onClick={() => setDuplicatePrompt(null)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}

          {/* Section 1 — Company Knowledge */}
          <section className="nac-vault-knowledge" aria-labelledby="vault-knowledge-heading">
            <h4 id="vault-knowledge-heading" className="nac-vault-knowledge__title">
              <BookOpen size={18} aria-hidden />
              Add to company knowledge
            </h4>
            <p className="nac-vault-knowledge__desc">
              Add reports, SOPs, audits, sales exports, training documents and operational knowledge.
            </p>

            {showUploadControls ? (
              <>
                <div className="nac-vault-knowledge__actions">
                  <button
                    type="button"
                    className="nac-vault-action-btn nac-vault-action-btn--primary nac-vault-action-btn--hero"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || bulkImporting}
                  >
                    <Upload size={18} aria-hidden />
                    Upload Files
                  </button>
                  <div className="nac-vault-knowledge__secondary-actions">
                    <button
                      type="button"
                      className="nac-vault-action-btn nac-vault-action-btn--secondary"
                      onClick={() => folderInputRef.current?.click()}
                      disabled={uploading || bulkImporting}
                    >
                      <FolderInput size={16} aria-hidden />
                      Import Folder
                    </button>
                    {!driveConnected ? (
                      <button
                        type="button"
                        className="nac-vault-action-btn nac-vault-action-btn--secondary"
                        onClick={onConnectDrive}
                        disabled={driveActionKey === "connect"}
                      >
                        <Cloud size={16} aria-hidden />
                        Connect Google Drive
                      </button>
                    ) : (
                      <span className="nac-vault-knowledge__connected">
                        <Cloud size={14} aria-hidden />
                        Google Drive connected
                      </span>
                    )}
                  </div>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  className="nac-vault-hidden-input"
                  accept={VAULT_UPLOAD_ACCEPT}
                  multiple
                  onChange={(e) => onFilesChosen(e.target.files)}
                  disabled={uploading || bulkImporting}
                />
                <input
                  ref={folderInputRef}
                  type="file"
                  className="nac-vault-hidden-input"
                  multiple
                  webkitdirectory=""
                  directory=""
                  onChange={(e) => onFolderSelected(e.target.files)}
                  disabled={bulkImporting || uploading}
                />

                {selectedFile ? (
                  <div className="nac-vault-knowledge__pending">
                    <FileText size={16} aria-hidden />
                    <span>{selectedFile.name}</span>
                    <button
                      type="button"
                      className="nac-ask-vault__upload-btn"
                      onClick={onUpload}
                      disabled={uploading}
                    >
                      {uploading ? <Loader2 size={16} className="nac-bi-spin" /> : <Upload size={16} />}
                      {uploading ? "Uploading…" : "Upload now"}
                    </button>
                    <button
                      type="button"
                      className="nac-ask-vault__refresh"
                      onClick={() => {
                        setSelectedFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      disabled={uploading}
                    >
                      Clear
                    </button>
                  </div>
                ) : null}

                {uploadQueue.length > 0 ? (
                  <div className="nac-ask-vault__upload-queue" role="status" aria-live="polite">
                    <div className="nac-ask-vault__upload-queue-summary">
                      <span>Pending: {uploadQueueStats.pending}</span>
                      <span>Processing: {uploadQueueStats.processing}</span>
                      <span>Completed: {uploadQueueStats.completed}</span>
                      <span>Failed: {uploadQueueStats.failed}</span>
                      {uploadQueueStats.skipped > 0 ? (
                        <span>Skipped: {uploadQueueStats.skipped}</span>
                      ) : null}
                    </div>
                    <ul className="nac-ask-vault__upload-queue-list">
                      {uploadQueue.slice(0, 12).map((item) => (
                        <li key={item.id} className={`is-${item.status}`}>
                          <span className="nac-ask-vault__upload-queue-name">
                            {item.relativePath || item.name}
                          </span>
                          <span className="nac-ask-vault__upload-queue-status">{item.status}</span>
                        </li>
                      ))}
                      {uploadQueue.length > 12 ? (
                        <li className="nac-ask-vault__upload-queue-more">
                          +{uploadQueue.length - 12} more file(s)
                        </li>
                      ) : null}
                    </ul>
                  </div>
                ) : null}

                {bulkImporting && bulkProgress ? (
                  <div className="nac-ask-vault__bulk-progress" role="status">
                    <Loader2 size={14} className="nac-bi-spin" />
                    Importing {bulkProgress.processed}/{bulkProgress.total} —{" "}
                    {bulkProgress.currentFile || "Processing…"}
                  </div>
                ) : null}

                <div
                  className="nac-vault-knowledge__drop"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    onFolderDrop(e);
                  }}
                >
                  <FolderInput size={16} aria-hidden />
                  <span>Drop files or a folder here to import</span>
                </div>

                <CollapsibleSection
                  id="vault-advanced-upload"
                  title="Advanced options"
                  summary="Branch, department, report type, sensitivity, period"
                  open={showAdvancedUpload}
                  onToggle={() => setShowAdvancedUpload((v) => !v)}
                  className="nac-vault-knowledge__advanced"
                >
                  {metadataFields}
                  <p className="nac-ask-vault__hint">
                    Supported: PDF, XLSX, XLS, CSV, DOCX, TXT. Legacy .doc is not supported — save as
                    DOCX.
                  </p>
                  <p className="nac-ask-vault__hint">
                    Structured parsers: {PARSEABLE_REPORT_TYPES.join(", ")}. Other report types are
                    stored only until search indexing ships.
                  </p>
                </CollapsibleSection>
              </>
            ) : (
              <p className="nac-ask-vault__warn">Sign in with a mapped NAC staff account to add knowledge.</p>
            )}
          </section>

          {/* Section 2 — Connected Sources */}
          {showUploadControls ? (
            <section className="nac-vault-sources" aria-labelledby="vault-sources-heading">
              <h4 id="vault-sources-heading" className="nac-vault-section-heading">
                <Link2 size={16} aria-hidden />
                Connected Sources
              </h4>

              <article className={`nac-vault-source-card ${driveConnected ? "is-connected" : ""}`}>
                <div className="nac-vault-source-card__head">
                  <Cloud size={18} aria-hidden />
                  <div>
                    <strong>Google Drive</strong>
                    <span className={`nac-vault-source-card__status ${driveConnected ? "is-on" : "is-off"}`}>
                      {driveConnected ? "Connected" : "Not connected"}
                    </span>
                  </div>
                </div>

                <p className="nac-vault-source-card__note">
                  Drive can sync metadata or ingest files from folders where auto-ingest is enabled.
                </p>

                {driveConnected ? (
                  <>
                    <dl className="nac-vault-source-card__stats">
                      <div>
                        <dt>Status</dt>
                        <dd className="nac-vault-source-card__status is-on">Connected</dd>
                      </div>
                      <div>
                        <dt>Account email</dt>
                        <dd>{driveEmail || "Google account"}</dd>
                      </div>
                      <div>
                        <dt>Last sync</dt>
                        <dd>{formatLastSync(driveLastSyncAt)}</dd>
                      </div>
                      <div>
                        <dt>Files discovered</dt>
                        <dd>{driveSyncStats.discovered}</dd>
                      </div>
                      <div>
                        <dt>New / changed</dt>
                        <dd>{driveSyncStats.changed}</dd>
                      </div>
                      <div>
                        <dt>Skipped</dt>
                        <dd>{driveSyncStats.skipped}</dd>
                      </div>
                      <div>
                        <dt>Indexed by Drive</dt>
                        <dd>{driveIngestStats.indexed}</dd>
                      </div>
                      <div>
                        <dt>Folders registered</dt>
                        <dd>{knowledgeStats.foldersRegistered}</dd>
                      </div>
                    </dl>

                    {knowledgeStats.foldersRegistered === 0 ? (
                      <p className="nac-vault-source-card__hint">
                        No folders registered yet. Add a Google Drive folder ID in System Details to enable sync.
                      </p>
                    ) : null}

                    <div className="nac-vault-source-card__actions">
                      <button
                        type="button"
                        className="nac-ask-vault__upload-btn"
                        onClick={onSyncAllDriveFolders}
                        disabled={driveActionKey === "metadata:all" || !knowledgeStats.foldersRegistered}
                      >
                        {driveActionKey === "metadata:all" ? <Loader2 size={16} className="nac-bi-spin" /> : <RefreshCw size={16} />}
                        {driveActionKey === "metadata:all" ? "Syncing…" : "Sync Metadata"}
                      </button>
                      <button
                        type="button"
                        className="nac-ask-vault__upload-btn"
                        onClick={onSyncAndIngestDrive}
                        disabled={driveActionKey === "ingest:all" || !(driveStatus?.folders || []).some((folder) => folder.auto_ingest)}
                      >
                        {driveActionKey === "ingest:all" || driveRunActive ? <Loader2 size={16} className="nac-bi-spin" /> : <Cloud size={16} />}
                        {driveActionKey === "ingest:all" || driveRunActive ? "Ingesting…" : "Sync & Ingest Drive"}
                      </button>
                      <button
                        type="button"
                        className="nac-ask-vault__refresh"
                        onClick={onConnectDrive}
                        disabled={driveActionKey === "connect"}
                      >
                        Reconnect
                      </button>
                      <button type="button" className="nac-ask-vault__refresh" onClick={onDisconnectDrive}>
                        <Unplug size={14} aria-hidden />
                        Disconnect
                      </button>
                    </div>
                    {driveIngestRun ? (
                      <div className="nac-ask-vault__bulk-progress" role="status" aria-live="polite">
                        {driveRunActive ? <Loader2 size={14} className="nac-bi-spin" /> : <Cloud size={14} />}
                        Drive ingestion {driveIngestStats.status}
                        {driveIngestStats.runtimeStage ? ` (${driveIngestStats.runtimeStage})` : ""}: discovered{" "}
                        {driveIngestStats.discovered}, new{" "}
                        {driveIngestStats.newCount}, changed {driveIngestStats.changed}, downloaded{" "}
                        {driveIngestStats.downloaded}, extracted {driveIngestStats.extracted}, indexed{" "}
                        {driveIngestStats.indexed}, failed {driveIngestStats.failed}, folders scanned{" "}
                        {driveIngestStats.foldersScanned}, max depth {driveIngestStats.maxDepth}
                        {driveIngestStats.currentFile ? ` — ${driveIngestStats.currentFile}` : ""}
                        {driveRunStale ? " — no update in 90+ seconds" : ""}
                        {driveIngestStats.errorMessage ? ` — ${driveIngestStats.errorMessage}` : ""}
                        {driveIngestRunIds.length > 1 ? ` — ${driveIngestRunIds.length} runs queued` : ""}
                      </div>
                    ) : null}
                    {driveIngestRun && driveIngestStats.discovered === 0 && !driveRunActive ? (
                      <div className="nac-vault-source-card__hint">
                        Selected folders: {driveIngestStats.selectedFoldersCount || driveIngestRunIds.length || 0}.{" "}
                        {driveIngestStats.selectedDriveFolderIds?.length
                          ? `Drive folder IDs: ${driveIngestStats.selectedDriveFolderIds.join(", ")}.`
                          : "No selected Drive folder IDs were reported."}
                      </div>
                    ) : null}
                    {driveRunFiles.some((file) => file.status === "failed") ? (
                      <ul className="nac-ask-vault__qa">
                        {driveRunFiles.filter((file) => file.status === "failed").slice(0, 6).map((file) => {
                          const retryKey = `retry:${file.id}`;
                          return (
                            <li key={file.id} className="is-fail">
                              <span>{file.stats?.relativePath || file.file_name}</span>
                              <span>{file.error || "Drive ingestion failed"}</span>
                              <button
                                type="button"
                                className="nac-ask-vault__refresh"
                                onClick={() => onRetryDriveFile(file)}
                                disabled={driveActionKey === retryKey}
                              >
                                {driveActionKey === retryKey ? "Retrying…" : "Retry"}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </>
                ) : (
                  <>
                    <dl className="nac-vault-source-card__stats nac-vault-source-card__stats--compact">
                      <div>
                        <dt>Status</dt>
                        <dd className="nac-vault-source-card__status is-off">Not connected</dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      className="nac-ask-vault__upload-btn"
                      onClick={onConnectDrive}
                      disabled={driveActionKey === "connect"}
                    >
                      <Cloud size={16} aria-hidden />
                      Connect Google Drive
                    </button>
                  </>
                )}
              </article>
            </section>
          ) : null}

          {/* Section 3 — Knowledge Status */}
          <section className="nac-vault-status" aria-labelledby="vault-status-heading">
            <h4 id="vault-status-heading" className="nac-vault-section-heading">
              <BarChart3 size={16} aria-hidden />
              Knowledge Status
            </h4>

            {!statusReady ? (
              <div className="nac-ask-vault__loading" role="status" aria-live="polite">
                <Loader2 size={16} className="nac-bi-spin" />
                Loading status…
              </div>
            ) : (
              <>
                {statusNotice ? <p className="nac-vault-status__notice">{statusNotice}</p> : null}
                <div className="nac-vault-status__grid">
                  <div className="nac-vault-stat-card">
                    <span className="nac-vault-stat-card__label">Documents Stored</span>
                    <strong className="nac-vault-stat-card__value">{knowledgeStats.documentsStored}</strong>
                  </div>
                  <div className="nac-vault-stat-card">
                    <span className="nac-vault-stat-card__label">Reports Parsed</span>
                    <strong className="nac-vault-stat-card__value">{knowledgeStats.reportsParsed}</strong>
                  </div>
                  <div
                    className={`nac-vault-stat-card${knowledgeStats.searchableFiles > 0 ? "" : " nac-vault-stat-card--muted"}`}
                  >
                    <span className="nac-vault-stat-card__label">Search Index</span>
                    <strong className="nac-vault-stat-card__value nac-vault-stat-card__value--text">
                      {knowledgeStats.searchIndexLabel}
                    </strong>
                  </div>
                  <div className="nac-vault-stat-card">
                    <span className="nac-vault-stat-card__label">Folders registered</span>
                    <strong className="nac-vault-stat-card__value">{knowledgeStats.foldersRegistered}</strong>
                  </div>
                  <div className="nac-vault-stat-card">
                    <span className="nac-vault-stat-card__label">Connected sources</span>
                    <strong className="nac-vault-stat-card__value">{knowledgeStats.connectedSources}</strong>
                  </div>
                  <div className="nac-vault-stat-card">
                    <span className="nac-vault-stat-card__label">Last updated</span>
                    <strong className="nac-vault-stat-card__value nac-vault-stat-card__value--text">
                      {formatLastUpdated(knowledgeStats.lastUpdated)}
                    </strong>
                  </div>
                  <div className="nac-vault-stat-card nac-vault-stat-card--highlight">
                    <span className="nac-vault-stat-card__label">Knowledge coverage</span>
                    <strong className="nac-vault-stat-card__value">{knowledgeStats.coveragePct}%</strong>
                  </div>
                </div>
              </>
            )}
          </section>

          {/* Section 4 — System Details */}
          <CollapsibleSection
            id="vault-system-details"
            title="System Details"
            icon={Settings2}
            summary="Registry, diagnostics, folder setup, and troubleshooting"
            open={showAdvancedTools}
            onToggle={() => setShowAdvancedTools((v) => !v)}
            className="nac-vault-advanced"
          >
            <div className="nac-vault-advanced__toolbar">
              {vaultRole ? (
                <span className="nac-ask-vault__badge">Vault role: {vaultRole.replace(/_/g, " ")}</span>
              ) : null}
              <button type="button" className="nac-ask-vault__refresh" onClick={runRegistryQa} disabled={qaLoading}>
                {qaLoading ? <Loader2 size={14} className="nac-bi-spin" /> : <Database size={14} />}
                Registry QA
              </button>
            </div>

            {qaChecks?.checks?.length ? (
              <ul className="nac-ask-vault__qa">
                {qaChecks.checks.map((check) => (
                  <li key={check.id} className={check.pass ? "is-pass" : "is-fail"}>
                    <span>{check.label}</span>
                    <span>{check.detail}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="nac-ask-vault__coverage">
              <h5>Coverage diagnostics by branch</h5>
              <div className="nac-ask-vault__coverage-grid">
                {["khobar", "riyadh", "jeddah"].map((branchId) => {
                  const branch = coverageData?.[branchId];
                  return (
                    <div key={branchId} className="nac-ask-vault__coverage-card">
                      <div className="nac-ask-vault__coverage-head">
                        <span>{branchDashboardName(branchId)}</span>
                        <strong>{branch?.overallScore ?? 0}%</strong>
                      </div>
                      <ul>
                        {(branch?.categories || []).slice(0, 6).map((cat) => (
                          <li key={cat.key} className={`is-${cat.status}`}>
                            <span>{cat.label}</span>
                            <span>{cat.score}%</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>

            {showUploadControls ? (
              <div className="nac-ask-vault__drive">
                <h5>Google Drive folder setup</h5>
                <p className="nac-ask-vault__hint">
                  Browse the connected Drive, then register selected operational folders with branch and document
                  defaults. Auto-ingest folders can be downloaded and indexed server-side with Sync & Ingest Drive.
                </p>
                <div className="nac-ask-vault__drive-row">
                  <input
                    type="text"
                    placeholder="Drive folder ID to browse, or root"
                    value={driveBrowserFolderId}
                    onChange={(e) => setDriveBrowserFolderId(e.target.value)}
                    disabled={!driveConnected}
                  />
                  <button
                    type="button"
                    className="nac-ask-vault__refresh"
                    onClick={() => onBrowseDriveFolder({ recursive: false })}
                    disabled={!driveConnected || driveActionKey === "browse"}
                  >
                    {driveActionKey === "browse" ? "Browsing…" : "Browse folder"}
                  </button>
                  <button
                    type="button"
                    className="nac-ask-vault__refresh"
                    onClick={() => onBrowseDriveFolder({ recursive: true })}
                    disabled={!driveConnected || driveActionKey === "browse:recursive"}
                  >
                    {driveActionKey === "browse:recursive" ? "Scanning…" : "Scan recursively"}
                  </button>
                </div>
                {driveBrowserResult ? (
                  <div className="nac-vault-source-card__hint">
                    <strong>{driveBrowserResult.folder?.name || "Drive folder"}</strong>:{" "}
                    {driveBrowserResult.recursive
                      ? `${(driveBrowserResult.files || []).length} file(s), ${driveBrowserResult.foldersScanned || 0} folder(s) scanned.`
                      : `${(driveBrowserResult.folders || []).length} folder(s), ${(driveBrowserResult.files || []).length} file(s) visible.`}
                  </div>
                ) : null}
                {driveBrowserResult?.folders?.length ? (
                  <ul className="nac-ask-vault__drive-folders">
                    {driveBrowserResult.folders.slice(0, 12).map((folder) => (
                      <li key={folder.id}>
                        <span>{folder.name}</span>
                        <span>{folder.likelyReportType !== "other" ? folder.likelyReportType : "folder"}</span>
                        <button
                          type="button"
                          className="nac-ask-vault__refresh"
                          onClick={() => {
                            setDriveBrowserFolderId(folder.id);
                            onBrowseDriveFolder({ recursive: false, folderId: folder.id });
                          }}
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          className="nac-ask-vault__refresh"
                          onClick={() => onUseDriveFolder(folder)}
                        >
                          Use for sync
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {driveBrowserResult?.files?.length ? (
                  <p className="nac-ask-vault__hint">
                    Visible files: {driveBrowserResult.files.slice(0, 8).map((file) => file.name).join(", ")}
                    {driveBrowserResult.files.length > 8 ? "…" : ""}
                  </p>
                ) : null}
                <div className="nac-ask-vault__drive-row">
                  <input
                    type="text"
                    placeholder="Drive folder ID"
                    value={driveFolderId}
                    onChange={(e) => setDriveFolderId(e.target.value)}
                    disabled={!driveConnected}
                  />
                  <input
                    type="text"
                    placeholder="Folder label (optional)"
                    value={driveFolderName}
                    onChange={(e) => setDriveFolderName(e.target.value)}
                    disabled={!driveConnected}
                  />
                  <button
                    type="button"
                    className="nac-ask-vault__refresh"
                    onClick={onRegisterDriveFolder}
                    disabled={!driveConnected}
                  >
                    Add folder
                  </button>
                </div>
                <label className="nac-ask-vault__hint">
                  <input
                    type="checkbox"
                    checked={driveAutoIngest}
                    onChange={(e) => setDriveAutoIngest(e.target.checked)}
                    disabled={!driveConnected}
                  />{" "}
                  Auto-ingest this folder using the current advanced upload metadata.
                </label>
                {(driveStatus?.folders || []).length ? (
                  <ul className="nac-ask-vault__drive-folders">
                    {driveStatus.folders.map((folder) => (
                      <li key={folder.id}>
                        <span>{folder.label || folder.folder_name || folder.drive_folder_id}</span>
                        <span>{folder.branch_id ? branchDashboardName(folder.branch_id) : "No branch"}</span>
                        <span>{folder.department || "operations"} / {folder.report_type || "other"}</span>
                        <span>{folder.auto_ingest ? "Auto-ingest on" : "Metadata only"}</span>
                        <span>{formatLastSync(folder.last_sync_at)}</span>
                        <button
                          type="button"
                          className="nac-ask-vault__refresh"
                          onClick={() => onManualDriveSync(folder.id)}
                          disabled={driveActionKey === `metadata:${folder.id}`}
                        >
                          {driveActionKey === `metadata:${folder.id}` ? "Syncing…" : "Sync metadata"}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {uploadPreview ? (
              <div className="nac-ask-vault__preview">
                <h5>Import diagnostics — parse preview</h5>
                <div className="nac-ask-vault__preview-grid">
                  <div>
                    <span className="nac-ask-vault__parse-label">File type</span>
                    <span>
                      {uploadPreview.detectedFileType}.{uploadPreview.detectedExtension}
                    </span>
                  </div>
                  <div>
                    <span className="nac-ask-vault__parse-label">Report type</span>
                    <span>{uploadPreview.reportType}</span>
                  </div>
                  <div>
                    <span className="nac-ask-vault__parse-label">Confidence</span>
                    <span>
                      {formatConfidence(uploadPreview.confidence)} ({uploadPreview.confidenceLevel})
                    </span>
                  </div>
                  <div>
                    <span className="nac-ask-vault__parse-label">Status</span>
                    {uploadPreview.needsMapping ? (
                      <span className="nac-ask-vault__needs-mapping">Needs mapping</span>
                    ) : (
                      <span>{uploadPreview.confidenceExplanation}</span>
                    )}
                  </div>
                </div>
                {uploadPreview.sections?.length ? (
                  <p className="nac-ask-vault__hint">Sections: {uploadPreview.sections.join(", ")}</p>
                ) : null}
                {uploadPreview.warnings?.length ? (
                  <ul className="nac-ask-vault__preview-warns">
                    {uploadPreview.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                ) : null}
                {uploadPreview.sampleFacts?.length ? (
                  <ul className="nac-ask-vault__sample-facts">
                    {uploadPreview.sampleFacts.map((fact) => (
                      <li key={`${fact.metric_key}-${fact.metric_value}`}>
                        <code>{fact.metric_key}</code>
                        {fact.metric_value != null ? `: ${fact.metric_value}` : ""}
                        {fact.dimensions?.text_value
                          ? `: ${String(fact.dimensions.text_value).slice(0, 80)}…`
                          : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="nac-ask-vault__list">
              <h5>
                <FolderOpen size={16} aria-hidden />
                {canManageDocuments ? "Document management" : "Document registry"}
              </h5>

              {loading ? (
                <div className="nac-ask-vault__loading">
                  <Loader2 size={18} className="nac-bi-spin" />
                  Loading registry…
                </div>
              ) : files.length === 0 ? (
                <div className="nac-ask-vault__empty">
                  <FileText size={20} aria-hidden />
                  <p>No documents yet. Upload a report to create the first entry.</p>
                </div>
              ) : canManageDocuments ? (
                <>
                  <div className="nac-vault-doc-mgmt__toolbar">
                    <label className="nac-vault-doc-mgmt__select-all">
                      <input
                        type="checkbox"
                        checked={
                          documentManagementRows.length > 0
                          && selectedDocIds.size === documentManagementRows.length
                        }
                        onChange={toggleSelectAllDocs}
                      />
                      Select all
                    </label>
                    <button
                      type="button"
                      className="nac-vault-action-btn nac-vault-action-btn--secondary"
                      disabled={managementBusy || selectedDocIds.size === 0}
                      onClick={onBulkReindexDocuments}
                    >
                      <RotateCw size={14} aria-hidden />
                      Rebuild search index ({selectedDocIds.size || 0})
                    </button>
                  </div>

                  {bulkReindexProgress ? (
                    <div className="nac-ask-vault__bulk-progress" role="status">
                      <Loader2 size={14} className="nac-bi-spin" />
                      Re-indexing {bulkReindexProgress.current}/{bulkReindexProgress.total}…
                    </div>
                  ) : null}

                  {bulkReindexResults.length ? (
                    <ul className="nac-vault-doc-mgmt__results">
                      {bulkReindexResults.map((item) => (
                        <li key={item.fileId} className={item.ok ? "is-ok" : "is-fail"}>
                          <span>{item.fileId.slice(0, 8)}…</span>
                          <span>
                            {item.ok
                              ? `${item.chunkCount} chunk(s)`
                              : item.error || "Failed"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="nac-vault-doc-mgmt__table-wrap">
                    <table className="nac-vault-doc-mgmt__table">
                      <thead>
                        <tr>
                          <th scope="col" aria-label="Select" />
                          <th scope="col">Filename</th>
                          <th scope="col">Report type</th>
                          <th scope="col">Branch</th>
                          <th scope="col">Uploaded</th>
                          <th scope="col">Searchable</th>
                          <th scope="col">Chunks</th>
                          <th scope="col">Parsed</th>
                          <th scope="col">Last indexed</th>
                          <th scope="col">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {documentManagementRows.map((row) => (
                          <tr key={row.id}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedDocIds.has(row.id)}
                                onChange={() => toggleDocSelection(row.id)}
                                aria-label={`Select ${row.filename}`}
                              />
                            </td>
                            <td title={row.filename}>
                              {row.filename}
                              {row.isJunk ? (
                                <span className="nac-vault-tier-badge is-search-pending"> test file</span>
                              ) : null}
                            </td>
                            <td>{row.reportType}</td>
                            <td>{branchLabel({ primary_branch_id: row.branch === "brand" ? null : row.branch, brand_wide: row.branch === "brand" })}</td>
                            <td>{formatDate(row.uploadedAt)}</td>
                            <td>{row.searchable ? "Yes" : "No"}</td>
                            <td>{row.chunkCount}</td>
                            <td>{row.parsed ? "Yes" : "No"}</td>
                            <td>{formatDate(row.lastIndexedAt)}</td>
                            <td>
                              <div className="nac-vault-doc-mgmt__row-actions">
                                <button
                                  type="button"
                                  className="nac-vault-doc-mgmt__icon-btn"
                                  title="Rebuild search index"
                                  disabled={managementBusy}
                                  onClick={() => onReindexDocument(row.id)}
                                >
                                  <RotateCw size={14} aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  className="nac-vault-doc-mgmt__icon-btn"
                                  title="Archive document"
                                  disabled={managementBusy}
                                  onClick={() => setConfirmArchiveId(row.id)}
                                >
                                  <Archive size={14} aria-hidden />
                                </button>
                                {canDeleteDocuments ? (
                                  <button
                                    type="button"
                                    className="nac-vault-doc-mgmt__icon-btn is-danger"
                                    title="Delete document"
                                    disabled={managementBusy}
                                    onClick={() => setConfirmDeleteId(row.id)}
                                  >
                                    <Trash2 size={14} aria-hidden />
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {confirmArchiveId ? (
                    <div className="nac-vault-doc-mgmt__confirm" role="dialog" aria-modal="true">
                      <p>Archive this document? It will be removed from search but kept for audit.</p>
                      <div className="nac-vault-duplicate-prompt__actions">
                        <button
                          type="button"
                          className="nac-vault-action-btn nac-vault-action-btn--primary"
                          disabled={managementBusy}
                          onClick={() => onArchiveDocument(confirmArchiveId)}
                        >
                          Archive
                        </button>
                        <button
                          type="button"
                          className="nac-vault-action-btn nac-vault-action-btn--secondary"
                          onClick={() => setConfirmArchiveId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {confirmDeleteId ? (
                    <div className="nac-vault-doc-mgmt__confirm" role="dialog" aria-modal="true">
                      <p>
                        Permanently remove this document from Company Knowledge? Storage and search
                        chunks will be deleted. This cannot be undone.
                      </p>
                      <div className="nac-vault-duplicate-prompt__actions">
                        <button
                          type="button"
                          className="nac-vault-action-btn nac-vault-action-btn--primary"
                          disabled={managementBusy}
                          onClick={() => onDeleteDocument(confirmDeleteId)}
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          className="nac-vault-action-btn nac-vault-action-btn--secondary"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <ul className="nac-ask-vault__files">
                  {files.map((row) => {
                    const tier = row.knowledgeTier || computeVaultKnowledgeTier(row);
                    const mgmt = formatVaultDocumentManagementRow(row);
                    return (
                    <li key={row.id} className="nac-ask-vault__file-card">
                      <div className="nac-ask-vault__file-title-row">
                        <div className="nac-ask-vault__file-title">{row.title || row.original_filename}</div>
                        <div className="nac-vault-tier-badges">
                          <span className={`nac-vault-tier-badge is-${tier.tier}`}>{tier.label}</span>
                          {!tier.searchable ? (
                            <span className="nac-vault-tier-badge is-search-pending">
                              Search index: {tier.searchableLabel}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="nac-ask-vault__file-meta">
                        <span>{branchLabel(row)}</span>
                        <span>{row.department}</span>
                        <span>{row.report_type}</span>
                        <span>{row.data_layer}</span>
                        <span>{row.sensitivity_level}</span>
                      </div>
                      <div className="nac-ask-vault__parse-grid">
                        <div>
                          <span className="nac-ask-vault__parse-label">Parsing</span>
                          <span className={`nac-ask-vault__status ${statusClass(row.parsingStatus)}`}>
                            {VAULT_INGESTION_STATUS_LABELS[row.parsingStatus] || row.parsingStatus}
                          </span>
                        </div>
                        <div>
                          <span className="nac-ask-vault__parse-label">Parsed</span>
                          <span>{mgmt.parsed ? "Yes" : "No"}</span>
                        </div>
                        <div>
                          <span className="nac-ask-vault__parse-label">Search</span>
                          <span className={`nac-ask-vault__status ${tier.searchable ? "is-completed" : "is-registered"}`}>
                            {mgmt.searchable
                              ? `Yes (${mgmt.chunkCount} chunks)`
                              : "No"}
                          </span>
                        </div>
                        <div>
                          <span className="nac-ask-vault__parse-label">Last indexed</span>
                          <span>{formatDate(mgmt.lastIndexedAt)}</span>
                        </div>
                        <div>
                          <span className="nac-ask-vault__parse-label">Uploaded</span>
                          <span>{formatDate(row.created_at)}</span>
                        </div>
                        <div>
                          <span className="nac-ask-vault__parse-label">Confidence</span>
                          <span>{formatConfidence(row.parserConfidence)}</span>
                        </div>
                      </div>
                      {row.needsMapping ? (
                        <span className="nac-ask-vault__needs-mapping">Needs mapping</span>
                      ) : null}
                      {row.parseWarning ? (
                        <p className="nac-ask-vault__parse-warn" role="status">
                          <AlertCircle size={14} aria-hidden />
                          {row.parseWarning}
                        </p>
                      ) : null}
                      <div className="nac-ask-vault__file-foot">
                        <span>{formatDate(row.created_at)}</span>
                        <span>{row.original_filename}</span>
                        <span>{row.readinessStatus || "registered"}</span>
                      </div>
                    </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </CollapsibleSection>
        </>
      )}
    </section>
  );
}
