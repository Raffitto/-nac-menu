/**
 * Pure display helpers for Company Knowledge status / coverage semantics.
 * Unavailable coverage must never render as a fake 0%.
 */

import { VAULT_BRANCH_IDS } from "./vaultCoverageDashboard";

export const KNOWLEDGE_TIMESTAMP_LABELS = Object.freeze({
  lastScheduledCheck: "Last scheduled check",
  lastSuccessfulIngest: "Last successful ingest",
  lastContentUpdate: "Last content update",
});

/**
 * @param {{ available?: boolean, score?: number|null }} opts
 * @returns {string} "Unavailable" | "0%" | "82%"
 */
export function formatCoveragePercentLabel({ available = false, score = null } = {}) {
  if (!available) return "Unavailable";
  if (score == null || Number.isNaN(Number(score))) return "Unavailable";
  return `${Math.round(Number(score))}%`;
}

/**
 * Average branch overall scores only when coverage calculation succeeded.
 * @returns {number|null} null when unavailable (never coerce to 0)
 */
export function averageBranchCoveragePercent(branches = {}, { available = false } = {}) {
  if (!available) return null;
  const scores = VAULT_BRANCH_IDS.map((id) => branches?.[id]?.overallScore)
    .filter((score) => score != null && !Number.isNaN(Number(score)))
    .map((score) => Number(score));
  if (!scores.length) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/**
 * Prefer searchable_at (index), then updated_at, then created_at.
 */
export function resolveKnowledgeContentUpdatedAt(row = {}) {
  return row.searchable_at || row.searchableAt || row.updated_at || row.updatedAt
    || row.created_at || row.createdAt || null;
}

/**
 * Latest non-null timestamp from a list of folder/sync records.
 */
export function latestTimestamp(values = []) {
  return values.reduce((latest, value) => {
    if (!value) return latest;
    return !latest || value > latest ? value : latest;
  }, null);
}

/**
 * Format a count for status cards — never show 0 when the value is unknown.
 */
export function formatStatusCount(value, { unavailable = false } = {}) {
  if (unavailable || value == null || Number.isNaN(Number(value))) return "Unavailable";
  return String(Number(value));
}
