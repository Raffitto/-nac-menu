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
  startDriveOAuth,
  completeDriveOAuth,
  registerDriveSyncFolder,
  triggerDriveSync,
} from "../../lib/askNacVaultApi";
import {
  VAULT_DEPARTMENTS,
  VAULT_REPORT_TYPES,
  VAULT_SENSITIVITY_LEVELS,
  VAULT_DATA_LAYERS,
  VAULT_INGESTION_STATUS_LABELS,
  defaultVaultUploadForm,
  vaultBranchOptionsForProfile,
} from "../../intelligence/askNac/vault/vaultConstants";
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
  const [coverageData, setCoverageData] = useState(null);
  const [coverageAttempted, setCoverageAttempted] = useState(false);
  const [registryAttempted, setRegistryAttempted] = useState(false);
  const [statusNotice, setStatusNotice] = useState("");
  const [driveStatus, setDriveStatus] = useState(null);
  const [driveFolderId, setDriveFolderId] = useState("");
  const [driveFolderName, setDriveFolderName] = useState("");
  const [driveSyncing, setDriveSyncing] = useState(false);
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

  const knowledgeStats = useMemo(() => {
    const documentsStored = files.length;
    const reportsImported = files.filter((row) => row.report_type && row.report_type !== "other").length;
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
    return { documentsStored, reportsImported, foldersRegistered, connectedSources, lastUpdated, coveragePct };
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

  const statusClass = (status) => {
    if (status === "completed") return "is-completed";
    if (status === "failed") return "is-failed";
    if (status === "processing") return "is-processing";
    return "is-registered";
  };

  const formatPeriod = (start, end) => {
    if (start && end && start !== end) return `${start} → ${end}`;
    return start || end || "—";
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

  const onUpload = async () => {
    if (!selectedFile) {
      setError("Select a file before uploading.");
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
      setNotice(result.reason || "Duplicate file skipped.");
      await loadRegistry();
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
    await loadRegistry();
    await loadCoverage();
  };

  const onFolderSelected = async (fileList) => {
    if (!fileList?.length || !session?.user) return;

    setBulkImporting(true);
    setBulkProgress({ processed: 0, total: fileList.length, succeeded: 0, failed: 0, skipped: 0 });
    setError("");
    setNotice("");

    const result = await startFolderBulkImport(supabase, {
      fileList,
      label: `Folder import (${fileList.length} files)`,
      defaultBranch: form.branch === "brand" ? "khobar" : form.branch,
      defaultDepartment: form.department,
      session,
      profile,
      vaultRole,
      onProgress: setBulkProgress,
    });

    setBulkImporting(false);
    if (folderInputRef.current) folderInputRef.current.value = "";

    if (!result.ok && !result.succeeded) {
      setError(result.error || "Bulk import failed.");
      return;
    }

    setNotice(
      `Folder import complete: ${result.succeeded} succeeded, ${result.skipped} skipped, ${result.failed} failed.`,
    );
    await loadRegistry();
    await loadCoverage();
  };

  const onFolderDrop = (event) => {
    event.preventDefault();
    const items = event.dataTransfer?.items;
    if (!items?.length) return;
    const dropped = [];
    for (const item of items) {
      if (item.kind === "file") {
        const entry = item.webkitGetAsEntry?.();
        if (entry?.isFile) {
          const file = item.getAsFile();
          if (file) dropped.push(file);
        }
      }
    }
    if (dropped.length) onFolderSelected(dropped);
  };

  const onConnectDrive = async () => {
    const result = await startDriveOAuth(session);
    if (!result.ok) {
      setError(result.error || "Could not start Google Drive connection.");
      return;
    }
    window.location.href = result.authorizeUrl;
  };

  const onRegisterDriveFolder = async () => {
    if (!driveFolderId.trim()) {
      setError("Enter a Google Drive folder ID.");
      return;
    }
    const result = await registerDriveSyncFolder(supabase, session, {
      folderId: driveFolderId.trim(),
      folderName: driveFolderName.trim() || driveFolderId.trim(),
      defaultBranchId: form.branch === "brand" ? null : form.branch,
      schedule: "daily",
    });
    if (!result.ok) {
      setError(result.error || "Could not register folder.");
      return;
    }
    setNotice("Drive folder registered for sync.");
    setDriveFolderId("");
    setDriveFolderName("");
    await loadDriveStatus();
  };

  const onManualDriveSync = async (folderRowId, { quiet = false } = {}) => {
    if (!quiet) setDriveSyncing(true);
    const result = await triggerDriveSync(session, { folderRowId });
    if (!quiet) setDriveSyncing(false);
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
    setDriveSyncing(true);
    setError("");
    let lastResult = null;
    for (const folder of folders) {
      lastResult = await onManualDriveSync(folder.id, { quiet: true });
      if (!lastResult?.ok) break;
    }
    setDriveSyncing(false);
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

  const onDisconnectDrive = () => {
    window.open("https://myaccount.google.com/permissions", "_blank", "noopener,noreferrer");
    setNotice(
      "To disconnect Google Drive, remove NAC OS access in your Google Account settings, then refresh this page.",
    );
  };

  const showUploadControls = Boolean(session?.user) && schemaReady !== false;
  const driveConnected = Boolean(driveStatus?.connected);
  const driveEmail = driveStatus?.connection?.google_account_email;
  const statusReady = registryAttempted && coverageAttempted;

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
                        disabled={driveSyncing}
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
                  accept=".pdf,.xlsx,.xls,.csv,.doc,.docx,.txt"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  disabled={uploading}
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
                  onDrop={onFolderDrop}
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
                    Supported: XLSX, CSV, PDF, DOCX, TXT. Parsers: cash-up, reception, logbook, CCM, weekly sales,
                    P&amp;L.
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
                  Metadata-only sync — file names, types, and dates. No automatic download or ingestion.
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
                        disabled={driveSyncing || !knowledgeStats.foldersRegistered}
                      >
                        {driveSyncing ? <Loader2 size={16} className="nac-bi-spin" /> : <RefreshCw size={16} />}
                        {driveSyncing ? "Syncing…" : "Sync Now"}
                      </button>
                      <button type="button" className="nac-ask-vault__refresh" onClick={onConnectDrive}>
                        Reconnect
                      </button>
                      <button type="button" className="nac-ask-vault__refresh" onClick={onDisconnectDrive}>
                        <Unplug size={14} aria-hidden />
                        Disconnect
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <dl className="nac-vault-source-card__stats nac-vault-source-card__stats--compact">
                      <div>
                        <dt>Status</dt>
                        <dd className="nac-vault-source-card__status is-off">Not connected</dd>
                      </div>
                    </dl>
                    <button type="button" className="nac-ask-vault__upload-btn" onClick={onConnectDrive}>
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
                    <span className="nac-vault-stat-card__label">Documents stored</span>
                    <strong className="nac-vault-stat-card__value">{knowledgeStats.documentsStored}</strong>
                  </div>
                  <div className="nac-vault-stat-card">
                    <span className="nac-vault-stat-card__label">Reports imported</span>
                    <strong className="nac-vault-stat-card__value">{knowledgeStats.reportsImported}</strong>
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
                  Register Google Drive folder IDs for metadata-only sync. Folder count and Sync Now appear in
                  Connected Sources once added.
                </p>
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
                {(driveStatus?.folders || []).length ? (
                  <ul className="nac-ask-vault__drive-folders">
                    {driveStatus.folders.map((folder) => (
                      <li key={folder.id}>
                        <span>{folder.folder_name || folder.drive_folder_id}</span>
                        <span>{folder.schedule}</span>
                        <span>{formatLastSync(folder.last_sync_at)}</span>
                        <button
                          type="button"
                          className="nac-ask-vault__refresh"
                          onClick={() => onManualDriveSync(folder.id)}
                          disabled={driveSyncing}
                        >
                          {driveSyncing ? "Syncing…" : "Sync folder"}
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
                Document registry
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
              ) : (
                <ul className="nac-ask-vault__files">
                  {files.map((row) => (
                    <li key={row.id} className="nac-ask-vault__file-card">
                      <div className="nac-ask-vault__file-title">{row.title || row.original_filename}</div>
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
                          <span className="nac-ask-vault__parse-label">Facts</span>
                          <span>{row.factsPersisted ?? 0} saved</span>
                        </div>
                        <div>
                          <span className="nac-ask-vault__parse-label">Confidence</span>
                          <span>{formatConfidence(row.parserConfidence)}</span>
                        </div>
                        <div>
                          <span className="nac-ask-vault__parse-label">Coverage</span>
                          <span>{formatPeriod(row.coveragePeriodStart, row.coveragePeriodEnd)}</span>
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
                  ))}
                </ul>
              )}
            </div>
          </CollapsibleSection>
        </>
      )}
    </section>
  );
}
