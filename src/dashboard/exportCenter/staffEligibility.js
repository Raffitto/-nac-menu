import { canonicalStaffName, isManagerRole, isWaiterRole } from "../config/staffRoles";

/** Always excluded from waiter rankings. First names cover Foodics variants. */
export const EXCLUDED_MANAGER_NAMES = ["Raffi", "Bashar", "Fady", "Raffi Azarian", "Fady Aly", "Bashar Ahmed"];

/**
 * Period-specific sales-ranking exclusions.
 * Do not treat these as global. Reviews stay included unless listed in scopes.
 */
export const PERIOD_SALES_EXCLUSIONS = [
  {
    staff: ["Sujan"],
    from: "2026-08-01",
    to: "2026-08-31",
    reason: "vacation / partial month",
    scopes: ["sales_ranking", "upsell", "matrix"],
  },
];

export const STAFF_MATRIX_ORDER = [
  "Abu Sofian",
  "Rabbi",
  "Azhar",
  "Rana",
  "Ronald",
  "Kayum",
];

function rangeOverlaps(from, to, start, end) {
  if (!from || !to || !start || !end) return false;
  return from <= end && to >= start;
}

export function managerExclusionNote() {
  return "Managers excluded: Raffi, Bashar and Fady";
}

export function periodExclusionNotes(from, to, scope = "sales_ranking") {
  return PERIOD_SALES_EXCLUSIONS
    .filter((rule) => rule.scopes.includes(scope) && rangeOverlaps(from, to, rule.from, rule.to))
    .map((rule) => `${rule.staff.join(", ")} excluded from sales ranking: ${rule.reason}`);
}

export function isPeriodExcluded(staff, { from, to, scope } = {}) {
  const name = canonicalStaffName(staff);
  return PERIOD_SALES_EXCLUSIONS.some(
    (rule) =>
      rule.staff.some((s) => canonicalStaffName(s) === name) &&
      rule.scopes.includes(scope) &&
      rangeOverlaps(from, to, rule.from, rule.to),
  );
}

export function isEligibleStaff(staff, { from, to, scope = "sales_ranking" } = {}) {
  const name = canonicalStaffName(staff);
  if (!name || name === "Unassigned") return false;
  if (isManagerRole(name)) return false;
  if (!isWaiterRole(name)) return false;
  if (EXCLUDED_MANAGER_NAMES.some((m) => canonicalStaffName(m) === name)) return false;
  if (scope !== "reviews" && isPeriodExcluded(name, { from, to, scope })) return false;
  return true;
}

export function sortMatrixStaff(names = []) {
  const known = STAFF_MATRIX_ORDER.filter((n) => names.includes(n));
  const rest = names.filter((n) => !STAFF_MATRIX_ORDER.includes(n)).sort((a, b) => a.localeCompare(b));
  return [...known, ...rest];
}
