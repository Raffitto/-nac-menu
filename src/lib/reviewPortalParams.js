/** Parse review QR URL params and normalize branch / staff fields. */

const BRANCH_KEYS = ["khobar", "riyadh", "jeddah"];

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

/** True when URL looks like a staff review QR (existing cards use `s=`). */
export function isReviewQrUrl(search) {
  const qs =
    search != null
      ? search
      : typeof window !== "undefined"
        ? window.location.search
        : "";
  const params = new URLSearchParams(qs);
  if (params.get("app") === "review") return true;
  if (params.get("s") || params.get("staff") || params.get("slug")) return true;
  if (params.get("store") && params.get("role")) return true;
  return false;
}
