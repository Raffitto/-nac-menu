/**
 * Staff role map — managers excluded from waiter competitions by default.
 * Unknown creators default to waiter (auto-includes future staff e.g. Kaium, Rabbi).
 */

export const STAFF_ROLE_MAP = {
  "Abu Sofian": "waiter",
  Azhar: "waiter",
  Rana: "waiter",
  Ronald: "waiter",
  Saiful: "waiter",
  Sujan: "waiter",

  "Raffi Azarian": "manager",
  "Fady Aly": "manager",
  "Bashar Ahmed": "manager",
};

export const STAFF_ROLE_LABELS = {
  waiter: "Waiter",
  manager: "Manager",
  admin: "Admin",
};

/** Normalize creator name for map lookup */
function norm(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Resolve role: mapped → use map; unmapped → waiter (future staff auto-included).
 */
export function resolveStaffRole(creatorName) {
  const raw = norm(creatorName);
  if (!raw) return "waiter";

  if (STAFF_ROLE_MAP[raw]) return STAFF_ROLE_MAP[raw];

  const lower = raw.toLowerCase();
  for (const [key, role] of Object.entries(STAFF_ROLE_MAP)) {
    const kl = key.toLowerCase();
    if (lower === kl || lower.includes(kl) || kl.includes(lower)) {
      return role;
    }
  }

  return "waiter";
}

export function isWaiterRole(creatorName) {
  return resolveStaffRole(creatorName) === "waiter";
}

export function isManagerRole(creatorName) {
  const r = resolveStaffRole(creatorName);
  return r === "manager" || r === "admin";
}

export function staffRoleLabel(creatorName) {
  return STAFF_ROLE_LABELS[resolveStaffRole(creatorName)] || "Waiter";
}

/**
 * Split aggregated staff list into competition waiters vs managers.
 */
export function partitionStaffByRole(staffList = [], { includeManagers = false } = {}) {
  const all = (staffList || []).map((s) => ({
    ...s,
    role: s.role || resolveStaffRole(s.waiter),
    roleLabel: staffRoleLabel(s.waiter),
  }));

  const waiters = all.filter((s) => s.role === "waiter");
  const managers = all.filter((s) => s.role === "manager" || s.role === "admin");
  const competition = includeManagers ? all : waiters;

  return {
    all,
    waiters,
    managers,
    competition,
    waiterCount: waiters.length,
    managerCount: managers.length,
  };
}
