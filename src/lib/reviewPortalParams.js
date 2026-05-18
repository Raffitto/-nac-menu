/** Parse review QR URL params and normalize branch / staff fields. */

const BRANCH_KEYS = ["khobar", "riyadh", "jeddah"];

const STAFF_PARAM_KEYS = [
  "s",
  "staff",
  "staff_name",
  "employee",
  "employee_name",
  "emp",
  "name",
];

/** Printed QR/NFC card domains — serve ReviewPortal in place (no canonical redirect). */
export const PRINTED_QR_REVIEW_HOSTS = new Set([
  "nac-khobar-reviews.netlify.app",
]);

const REVIEW_ONLY_HOST_PATTERNS = [
  /-reviews\.netlify\.app$/i,
  /reviews\.netlify\.app$/i,
];

export function isReviewOnlyHostname(hostname) {
  const h = (hostname || "").toLowerCase();
  if (PRINTED_QR_REVIEW_HOSTS.has(h)) return true;
  return REVIEW_ONLY_HOST_PATTERNS.some((re) => re.test(h));
}

export function isReviewDomain(hostname) {
  return isReviewOnlyHostname(hostname);
}

function paramHasValue(params, key) {
  const val = params.get(key);
  return val != null && String(val).trim() !== "";
}

export function branchFromHostname(hostname) {
  const h = (hostname || "").toLowerCase();
  if (h.includes("khobar")) return "khobar";
  if (h.includes("jeddah")) return "jeddah";
  if (h.includes("riyadh")) return "riyadh";
  return null;
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

/**
 * True when URL must load ReviewPortal (staff review QR), not the menu app.
 * Must match public/review-routing.js.
 */
export function detectReviewQrMode(search, hostname) {
  if (
    typeof window !== "undefined" &&
    typeof window.__NAC_DETECT_REVIEW_QR_MODE__ === "function"
  ) {
    return window.__NAC_DETECT_REVIEW_QR_MODE__(
      search != null ? search : window.location.search,
      hostname != null ? hostname : window.location.hostname,
    );
  }

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
  if (isReviewOnlyHostname(host)) return true;

  if (STAFF_PARAM_KEYS.some((key) => paramHasValue(params, key))) return true;

  if (
    paramHasValue(params, "role") &&
    (paramHasValue(params, "store") || paramHasValue(params, "branch"))
  ) {
    return true;
  }

  return false;
}

export function isReviewQrUrl(search, hostname) {
  return detectReviewQrMode(search, hostname);
}

export function parseReviewPortalParams(search) {
  const qs =
    search != null
      ? search
      : typeof window !== "undefined"
        ? window.location.search
        : "";
  const params = new URLSearchParams(qs);
  const hostname =
    typeof window !== "undefined" ? window.location.hostname : "";

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
    branchFromHostname(hostname) ||
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

/** Set global flag so menu analytics never runs on review QR visits. */
export function applyReviewRoutingMode(isReviewQr) {
  if (typeof window === "undefined") return;
  window.__NAC_REVIEW_MODE__ = Boolean(isReviewQr);
  console.log(
    "ROUTING MODE",
    isReviewQr ? "review" : "menu",
    window.location.hostname,
    window.location.search,
  );
}
