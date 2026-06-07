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
  registered: "Registered (no parser)",
  queued: "Queued",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
};

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
