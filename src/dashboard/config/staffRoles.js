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
  Kayum: "waiter",
  Rabbi: "waiter",
  Boyboy: "waiter",
  Lyn: "waiter",
  Marwan: "waiter",

  "Raffi Azarian": "manager",
  "Fady Aly": "manager",
  "Bashar Ahmed": "manager",
};

/** Foodics / review name variants → canonical roster name (lowercase keys). */
export const WAITER_NAME_ALIASES = {
  "mohamed azhar": "Azhar",
  azhar: "Azhar",
  saif: "Saiful",
  saiful: "Saiful",
  kaium: "Kayum",
  kayum: "Kayum",
  "boy boy": "Boyboy",
  boyboy: "Boyboy",
  lyn: "Lyn",
  "abu sufiyan": "Abu Sofian",
  "abu sofian": "Abu Sofian",
  raffi: "Raffi Azarian",
  "raffi azarian": "Raffi Azarian",
  bashar: "Bashar Ahmed",
  "bashar ahmed": "Bashar Ahmed",
  fady: "Fady Aly",
  "fady aly": "Fady Aly",
  marwan: "Marwan",
  rabbi: "Rabbi",
};

/** Core competition waiters — used to ensure export completeness */
export const EXPECTED_WAITERS = [
  "Abu Sofian",
  "Azhar",
  "Rana",
  "Ronald",
  "Saiful",
  "Sujan",
];

export const STAFF_ROLE_LABELS = {
  waiter: "Waiter",
  manager: "Manager",
  admin: "Admin",
};

const CANONICAL_KEYS = Object.keys(STAFF_ROLE_MAP);

/** Normalize creator name for map lookup */
export function normStaffName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Map Foodics creator variants to canonical roster name (exact / case / first-token).
 */
export function canonicalStaffName(creatorName) {
  const raw = normStaffName(creatorName);
  if (!raw) return "Unassigned";

  const lower = raw.toLowerCase();
  if (WAITER_NAME_ALIASES[lower]) return WAITER_NAME_ALIASES[lower];

  for (const [aliasKey, canonical] of Object.entries(WAITER_NAME_ALIASES)) {
    if (lower === aliasKey) return canonical;
    if (lower.endsWith(` ${aliasKey}`) || lower.startsWith(`${aliasKey} `)) return canonical;
    if (aliasKey.includes(" ") && lower.includes(aliasKey)) return canonical;
  }

  if (STAFF_ROLE_MAP[raw]) return raw;
  for (const key of CANONICAL_KEYS) {
    const kl = key.toLowerCase();
    if (lower === kl) return key;
    if (lower.startsWith(`${kl} `) || lower.startsWith(`${kl}.`)) return key;
  }

  const first = lower.split(/\s+/)[0];
  for (const key of CANONICAL_KEYS) {
    if (key.toLowerCase().split(/\s+/)[0] === first && first.length >= 3) return key;
  }

  return raw;
}

export function staffNamesMatch(a, b) {
  return canonicalStaffName(a).toLowerCase() === canonicalStaffName(b).toLowerCase();
}

/**
 * Resolve role: mapped canonical name → use map; unmapped → waiter.
 * Uses exact match only (no substring includes — prevents misclassification).
 */
export function resolveStaffRole(creatorName) {
  const canonical = canonicalStaffName(creatorName);
  if (STAFF_ROLE_MAP[canonical]) return STAFF_ROLE_MAP[canonical];
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
    waiter: canonicalStaffName(s.waiter),
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
