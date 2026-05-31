/**
 * Resolve review QR staff from review_portal_staff.url_slug.
 * Printed cards may pass the slug via ?s=, ?staff=, or ?slug=.
 */

/** Normalize slug keys for case-insensitive matching. */
export function normalizeStaffSlug(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

/**
 * Value to match against review_portal_staff.url_slug (not display name).
 * Prefers ?s= / staff params, then ?slug=.
 */
export function getStaffLookupKey(portalParams = {}) {
  const fromStaffParam = portalParams.employeeName?.trim();
  if (fromStaffParam) return fromStaffParam;
  const fromSlugParam = portalParams.slug?.trim();
  if (fromSlugParam) return fromSlugParam;
  return null;
}

/** @param {Array<{ url_slug?: string, employee_name?: string, role?: string, active?: boolean }>} rows */
export function findReviewPortalStaffBySlug(rows, lookupKey) {
  const key = normalizeStaffSlug(lookupKey);
  if (!key) return null;
  return (
    (rows || []).find(
      (row) => row.active !== false && normalizeStaffSlug(row.url_slug) === key,
    ) || null
  );
}

/**
 * Pure resolution: DB row by url_slug wins over URL literal name/role.
 * @returns {{ employeeName: string|null, employeeRole: string|null, matched: boolean, lookupKey: string|null }}
 */
export function resolveReviewPortalStaff(portalParams = {}, staffRows = []) {
  const lookupKey = getStaffLookupKey(portalParams);
  const match = findReviewPortalStaffBySlug(staffRows, lookupKey);

  if (match) {
    return {
      employeeName: match.employee_name || null,
      employeeRole: match.role || null,
      matched: true,
      lookupKey,
    };
  }

  return {
    employeeName: portalParams.employeeName || null,
    employeeRole: portalParams.employeeRole || null,
    matched: false,
    lookupKey,
  };
}
