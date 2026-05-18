/** Parse review QR URL params and normalize branch / staff fields. */

const BRANCH_KEYS = ["khobar", "riyadh", "jeddah"];

const STAFF_PARAM_KEYS = [
  "s",
  "staff",
  "staff_name",
  "employee",
  "employee_name",
  "emp",
  "slug",
];

export function isReviewDomain(hostname) {
  const h = (hostname || "").toLowerCase();
  return h.includes("review");
}

function paramHasValue(params, key) {
  const val = params.get(key);
  return val != null && String(val).trim() !== "";
}

export function normalizeBranchFromStore(storeName) {
  if (!storeName) return null;
  const raw = decodeURIComponent(String(storeName)).trim();
  const s = raw.toLowerCase();
  if (s.includes("khobar")) return "khobar";
  if (s.includes("jeddah")) return "jeddah";
  if (s.includes("riyadh")) return "riyadh";
  if (BRANCH_KEYS.includes(s)) return s;
  return null;
}

export function parseReviewPortalParams(search) {
  const qs =
    search != null
      ? search
      : typeof window !== "undefined"
        ? window.location.search
        : "";
  const params = new URLSearchParams(qs);

  const employeeName =
    params.get("s") ||
    params.get("staff") ||
    params.get("staff_name") ||
    params.get("employee") ||
    params.get("employee_name") ||
    params.get("name") ||
    params.get("emp") ||
    null;

  const employeeRole = params.get("role") || null;

  const storeName = params.get("store") || params.get("branch") || null;

  const normalizedBranch =
    normalizeBranchFromStore(storeName) ||
    normalizeBranchFromStore(params.get("branch")) ||
    (process.env.REACT_APP_NAC_BRANCH_ID || "khobar").toLowerCase();

  const cleanName = employeeName
    ? decodeURIComponent(String(employeeName)).trim()
    : null;
  const cleanRole = employeeRole
    ? decodeURIComponent(String(employeeRole)).trim()
    : null;

  return {
    employeeName: cleanName || null,
    employeeRole: cleanRole || null,
    storeName: storeName ? decodeURIComponent(String(storeName)).trim() : null,
    normalizedBranch,
    slug: params.get("slug") || "",
    lang: params.get("lang") || "en",
  };
}

/**
 * True when URL must load ReviewPortal (staff review QR), not the menu app.
 * Checked before menu analytics / App bundle initializes.
 */
export function isReviewQrUrl(search, hostname) {
  if (typeof window === "undefined" && search == null) return false;

  const params = new URLSearchParams(
    search != null
      ? search
      : typeof window !== "undefined"
        ? window.location.search
        : "",
  );
  const host = (
    hostname != null
      ? hostname
      : typeof window !== "undefined"
        ? window.location.hostname
        : ""
  ).toLowerCase();

  if (params.get("app") === "review") return true;

  if (STAFF_PARAM_KEYS.some((key) => paramHasValue(params, key))) return true;

  if (
    paramHasValue(params, "role") &&
    (paramHasValue(params, "store") || paramHasValue(params, "branch"))
  ) {
    return true;
  }

  if (
    isReviewDomain(host) &&
    (paramHasValue(params, "store") ||
      paramHasValue(params, "branch") ||
      paramHasValue(params, "s"))
  ) {
    return true;
  }

  return false;
}

/** Set global flag so menu analytics never runs on review QR visits. */
export function applyReviewRoutingMode(isReviewQr) {
  if (typeof window === "undefined") return;
  window.__NAC_REVIEW_MODE__ = Boolean(isReviewQr);
  console.log("ROUTING MODE", isReviewQr ? "review" : "menu");
}
