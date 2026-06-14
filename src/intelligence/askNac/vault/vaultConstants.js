/** Ask NAC Data Vault — registry metadata options (P1 shell). */

export const VAULT_STORAGE_BUCKET = "ask-nac-vault-originals";

export const VAULT_BRANCH_OPTIONS = [
  { value: "khobar", label: "Khobar" },
  { value: "riyadh", label: "Riyadh" },
  { value: "jeddah", label: "Jeddah" },
  { value: "brand", label: "Brand-wide" },
];

export const VAULT_DEPARTMENTS = [
  { value: "admin", label: "Admin" },
  { value: "operations", label: "Operations" },
  { value: "sales", label: "Sales" },
  { value: "reception", label: "Reception" },
  { value: "cost_control", label: "Cost Control" },
  { value: "purchasing", label: "Purchasing" },
  { value: "inventory", label: "Inventory" },
  { value: "ffe", label: "FFE / OS&E" },
  { value: "foh", label: "FOH" },
  { value: "kitchen", label: "Kitchen" },
  { value: "hr", label: "Human Resources" },
  { value: "marketing", label: "Marketing / PR" },
  { value: "design", label: "Graphic Design" },
  { value: "brand", label: "Brand Standards" },
];

export const VAULT_REPORT_TYPES = [
  { value: "cash_up", label: "Cash Up" },
  { value: "reception_daily_report", label: "Reception Daily Report" },
  { value: "daily_logbook", label: "Daily Logbook" },
  { value: "ccm_reconciliation", label: "CCM Reconciliation" },
  { value: "weekly_sales_overview", label: "Weekly Sales Overview" },
  { value: "foodics_export", label: "Foodics Export" },
  { value: "pnl", label: "P&L" },
  { value: "budget", label: "Budget" },
  { value: "forecast", label: "Forecast" },
  { value: "gm_report", label: "GM Report" },
  { value: "audit_report", label: "Audit Report" },
  { value: "brand_brain_sop", label: "Brand Brain SOP" },
  { value: "other", label: "Other (unsorted)" },
];

export const VAULT_SENSITIVITY_LEVELS = [
  { value: "public", label: "Public" },
  { value: "internal", label: "Internal" },
  { value: "management", label: "Management" },
  { value: "finance", label: "Finance" },
  { value: "hr_restricted", label: "HR Restricted" },
];

export const VAULT_DATA_LAYERS = [
  { value: "operational", label: "Operational Data Vault" },
  { value: "brand_brain", label: "Brand Brain" },
  { value: "mixed", label: "Mixed" },
  { value: "unknown", label: "Unknown / To classify" },
];

export const VAULT_INGESTION_STATUS_LABELS = {
  registered: "Registered (stored)",
  queued: "Queued",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
};

/** Report types with structured parsers (numeric / operational facts). */
export const PARSEABLE_REPORT_TYPES = [
  "cash_up",
  "reception_daily_report",
  "daily_logbook",
  "ccm_reconciliation",
  "weekly_sales_overview",
  "pnl",
];

/** Registry-only report types until chunk search ships (CK-2+). */
export const STORED_ONLY_REPORT_TYPES = VAULT_REPORT_TYPES.map((item) => item.value).filter(
  (value) => !PARSEABLE_REPORT_TYPES.includes(value),
);

export const VAULT_UPLOAD_ACCEPT = ".pdf,.xlsx,.xls,.csv,.docx,.txt";

export const LEGACY_DOC_EXTENSION = ".doc";

export const LEGACY_DOC_MESSAGE =
  "Legacy Word .doc files are not supported. Save as DOCX and upload again.";

export const VAULT_SUPPORTED_UPLOAD_EXTENSIONS = new Set([
  ".pdf",
  ".xlsx",
  ".xls",
  ".csv",
  ".docx",
  ".txt",
]);

export function getVaultFileExtension(fileOrName) {
  const name = String(typeof fileOrName === "string" ? fileOrName : fileOrName?.name || "").toLowerCase();
  if (!name.includes(".")) return "";
  return name.slice(name.lastIndexOf("."));
}

export function isLegacyDocFile(fileOrName) {
  return getVaultFileExtension(fileOrName) === LEGACY_DOC_EXTENSION;
}

export function isSupportedVaultUploadFile(fileOrName) {
  return VAULT_SUPPORTED_UPLOAD_EXTENSIONS.has(getVaultFileExtension(fileOrName));
}

export function isVaultReportTypeParseable(reportType) {
  return PARSEABLE_REPORT_TYPES.includes(String(reportType || ""));
}

/** Map client RBAC role → vault role hint for UI branch options. */
export function vaultBranchOptionsForProfile(profile) {
  if (!profile?.authenticated || profile.allBranches) {
    return [{ value: "all", label: "All branches (filter)" }, ...VAULT_BRANCH_OPTIONS];
  }
  if (profile.branchScope) {
    const hit = VAULT_BRANCH_OPTIONS.find((o) => o.value === profile.branchScope);
    return hit ? [hit] : VAULT_BRANCH_OPTIONS.slice(0, 3);
  }
  return VAULT_BRANCH_OPTIONS.slice(0, 3);
}

export function defaultVaultUploadForm(profile) {
  const branch =
    profile?.allBranches ? "khobar" : profile?.branchScope || "khobar";
  return {
    branch,
    brandWide: false,
    department: "operations",
    reportType: "daily_logbook",
    sensitivity: "internal",
    dataLayer: "operational",
    periodStart: "",
    periodEnd: "",
    title: "",
  };
}
