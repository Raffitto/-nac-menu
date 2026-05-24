/**
 * Canonical branch IDs for NAC network intelligence (single source of truth).
 */

export const CANONICAL_BRANCH_IDS = ["khobar", "riyadh", "jeddah"];

const ALIAS_RULES = [
  { id: "khobar", test: (s) => /khobar|alkhobar|الخبر/.test(s) },
  { id: "riyadh", test: (s) => /riyadh|رياض/.test(s) },
  { id: "jeddah", test: (s) => /jeddah|jedda|جدة|jiddah/.test(s) },
];

/**
 * Normalize any branch label to khobar | riyadh | jeddah, or null if unknown.
 * Never defaults null/empty to Khobar — use null for unassigned.
 */
export function normalizeBranchId(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (lower === "all") return null;
  if (CANONICAL_BRANCH_IDS.includes(lower)) return lower;

  const stripped = lower.replace(/^nac\s*[-_]?\s*/, "").trim();
  if (CANONICAL_BRANCH_IDS.includes(stripped)) return stripped;

  for (const rule of ALIAS_RULES) {
    if (rule.test(lower) || rule.test(stripped)) return rule.id;
  }

  return null;
}

/** RPC / Supabase filter param — null means all branches. */
export function normalizeBranchForRpc(branch) {
  if (branch == null || branch === "" || branch === "all" || branch === "All") {
    return null;
  }
  return normalizeBranchId(branch);
}

export function branchDisplayName(branch) {
  const id = normalizeBranchId(branch);
  if (!id) return "Unassigned";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * Menu-facing / operational brand label — Khobar displays as "NAC".
 * Internal branch_id remains khobar for RBAC, imports, and analytics.
 */
export function operationalBrandDisplay(branch) {
  const id = normalizeBranchId(branch);
  if (id === "khobar") return "NAC";
  if (id === "riyadh") return "NAC Riyadh";
  if (id === "jeddah") return "NAC Jeddah";
  return branchDisplayName(branch);
}

/** Normalize legacy labels like "NAC Khobar" → operational brand where shown in dashboards. */
export function normalizeOperationalBrandLabel(label) {
  if (label == null) return label;
  const raw = String(label).trim();
  if (!raw) return raw;
  const lower = raw.toLowerCase();
  if (/^nac\s*[-_]?\s*khobar$/i.test(lower) || lower === "nac khobar") return "NAC";
  if (/^nac\s*[-_]?\s*riyadh$/i.test(lower)) return "NAC Riyadh";
  if (/^nac\s*[-_]?\s*jeddah$/i.test(lower)) return "NAC Jeddah";
  return raw;
}

export function defaultBranchId() {
  return normalizeBranchId(process.env.REACT_APP_NAC_BRANCH_ID) || "khobar";
}

/** Merge raw branch metric rows into canonical branch buckets. */
export function aggregateByCanonicalBranch(rows = [], valueKeys = ["count"]) {
  const buckets = Object.fromEntries(
    CANONICAL_BRANCH_IDS.map((id) => [id, { branch_id: id }]),
  );

  for (const row of rows || []) {
    const id = normalizeBranchId(row.branch_id ?? row.branch);
    if (!id) continue;
    const bucket = buckets[id];
    for (const key of valueKeys) {
      bucket[key] = (Number(bucket[key]) || 0) + (Number(row[key]) || 0);
    }
  }

  return CANONICAL_BRANCH_IDS.map((id) => buckets[id]);
}

/** Build full comparison rows with zeros for missing branches. */
export function buildCanonicalBranchComparison(rawRows = [], defaults = {}) {
  const map = {};
  for (const row of rawRows || []) {
    const id = normalizeBranchId(row.branch_id ?? row.branch);
    if (!id) continue;
    if (!map[id]) map[id] = { branch_id: id, ...defaults };
    for (const [key, val] of Object.entries(row)) {
      if (key === "branch_id" || key === "branch") continue;
      if (typeof val === "number" && Number.isFinite(val)) {
        map[id][key] = (Number(map[id][key]) || 0) + val;
      } else if (map[id][key] == null && val != null) {
        map[id][key] = val;
      }
    }
  }

  return CANONICAL_BRANCH_IDS.map((id) => ({
    branch_id: id,
    ...defaults,
    ...(map[id] || {}),
  }));
}
