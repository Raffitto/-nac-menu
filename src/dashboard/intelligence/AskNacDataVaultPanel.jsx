import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  FolderOpen,
  Loader2,
  Database,
  FileText,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { useRbacOptional } from "../context/RbacContext";
import {
  listVaultFiles,
  registerVaultUpload,
  fetchVaultStaffRole,
  runVaultRegistryQaChecks,
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

function branchLabel(row) {
  if (row.brand_wide) return "Brand-wide";
  if (row.primary_branch_id) return branchDashboardName(row.primary_branch_id);
  return "—";
}

export default function AskNacDataVaultPanel({ session }) {
  const rbac = useRbacOptional();
  const profile = rbac?.profile ?? null;
  const fileInputRef = useRef(null);

  const [form, setForm] = useState(() => defaultVaultUploadForm(profile));
  const [selectedFile, setSelectedFile] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [vaultRole, setVaultRole] = useState(null);
  const [schemaReady, setSchemaReady] = useState(null);
  const [qaChecks, setQaChecks] = useState(null);
  const [qaLoading, setQaLoading] = useState(false);
  const [uploadPreview, setUploadPreview] = useState(null);

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
      return;
    }

    setLoading(true);
    setError("");

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
    } else {
      setSchemaReady(true);
      setError("");
    }

    setFiles(rows);
    setVaultRole(staff.role);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadRegistry();
  }, [loadRegistry]);

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
        const template = VAULT_REPORT_TYPES.find((t) => t.value === value);
        if (value === "brand_brain_sop") next.dataLayer = "brand_brain";
        if (value === "cash_up") next.sensitivity = "management";
        if (value === "ccm_reconciliation") {
          next.sensitivity = "finance";
          next.department = "admin";
        }
        if (template && value !== "other") {
          /* keep user overrides */
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

    const ingest = result.ingestion;
    const ingestLine = ingest
      ? ingest.ok
        ? `Parsed: ${ingest.factsPersisted} fact(s) saved${ingest.publish ? "" : " (low confidence — raw extract)"}.`
        : `Registry saved; parser ${ingest.status || "failed"}: ${ingest.error || "unknown error"}.`
      : "Registry saved. No prototype parser for this report type yet.";

    setNotice(
      [ingestLine, result.warning].filter(Boolean).join(" "),
    );
    if (ingest?.preview) setUploadPreview(ingest.preview);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await loadRegistry();
  };

  const showUploadControls = Boolean(session?.user) && schemaReady !== false;

  return (
    <section className="nac-glass-panel nac-ask-vault" aria-labelledby="ask-nac-vault-heading">
      <header className="nac-ask-vault__header">
        <div>
          <p className="nac-ask-nac-eyebrow">Company archive foundation</p>
          <h3 id="ask-nac-vault-heading">Data Vault</h3>
          <p className="nac-ask-vault__intro">
            Upload NAC operational reports (XLSX, CSV, PDF, DOCX, TXT). Prototype parsers extract structured
            facts — not connected to Ask NAC answers yet. Foodics stays on Sales Intelligence.
          </p>
        </div>
        <div className="nac-ask-vault__meta">
          {vaultRole ? (
            <span className="nac-ask-vault__badge">Vault role: {vaultRole.replace(/_/g, " ")}</span>
          ) : null}
          <button type="button" className="nac-ask-vault__refresh" onClick={runRegistryQa} disabled={qaLoading}>
            {qaLoading ? <Loader2 size={14} className="nac-bi-spin" /> : <Database size={14} />}
            Registry QA
          </button>
          <button type="button" className="nac-ask-vault__refresh" onClick={loadRegistry} disabled={loading}>
            <RefreshCw size={14} className={loading ? "nac-bi-spin" : ""} />
            Refresh
          </button>
        </div>
      </header>

      {!isSupabaseConfigured() ? (
        <p className="nac-ask-vault__warn" role="alert">
          Supabase is not configured — registry unavailable.
        </p>
      ) : null}

      {schemaReady === false ? (
        <div className="nac-ask-vault__empty">
          <Database size={22} aria-hidden />
          <p>
            Apply migration <code>20260606120000_ask_nac_data_vault_foundation.sql</code> via{" "}
            <code>supabase db push</code>, then refresh.
          </p>
        </div>
      ) : (
        <>
          {showUploadControls ? (
            <div className="nac-ask-vault__upload">
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

              <div className="nac-ask-vault__file-row">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.xlsx,.xls,.csv,.doc,.docx,.txt"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  disabled={uploading}
                />
                <button
                  type="button"
                  className="nac-ask-vault__upload-btn"
                  onClick={onUpload}
                  disabled={uploading || !selectedFile}
                >
                  {uploading ? <Loader2 size={16} className="nac-bi-spin" /> : <Upload size={16} />}
                  {uploading ? "Uploading…" : "Upload data"}
                </button>
              </div>
              <p className="nac-ask-vault__hint">
                Supported: XLSX, CSV, PDF (text extract), DOCX (plain text), TXT. Parsers: cash-up, reception,
                logbook, CCM reconciliation.
              </p>
            </div>
          ) : (
            <p className="nac-ask-vault__warn">Sign in with a mapped NAC staff account to upload.</p>
          )}

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

          {error ? (
            <div className="nac-ask-vault__error" role="alert">
              <AlertCircle size={16} />
              {error}
            </div>
          ) : null}

          {notice ? <p className="nac-ask-vault__notice">{notice}</p> : null}

          {uploadPreview ? (
            <div className="nac-ask-vault__preview">
              <h4>Parse preview</h4>
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
                <p className="nac-ask-vault__hint">
                  Sections: {uploadPreview.sections.join(", ")}
                </p>
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
            <h4>
              <FolderOpen size={16} aria-hidden />
              Registry history
            </h4>

            {loading ? (
              <div className="nac-ask-vault__loading">
                <Loader2 size={18} className="nac-bi-spin" />
                Loading registry…
              </div>
            ) : files.length === 0 ? (
              <div className="nac-ask-vault__empty">
                <FileText size={20} aria-hidden />
                <p>No vault files yet. Upload a report to create the first registry entry.</p>
                <p className="nac-ask-vault__hint">Upload CSV/XLSX structured reports to run the prototype parser.</p>
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
        </>
      )}
    </section>
  );
}
