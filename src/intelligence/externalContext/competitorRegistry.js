/**
 * Competitor registry helpers — normalization and lookup utilities.
 * Competitors are DB-configured; never hardcoded in reasoning logic.
 */

import { normalizeCompetitorName } from "./externalContextContract";

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
export function normalizeCompetitorRecord(row = {}) {
  const name = String(row.name || "").trim();
  return {
    ...row,
    name,
    normalized_name: row.normalized_name || normalizeCompetitorName(name),
    is_active: row.is_active !== false,
  };
}

/**
 * @param {Array<Record<string, unknown>>} competitors
 * @param {string} branchId
 * @returns {Array<Record<string, unknown>>}
 */
export function filterActiveCompetitorsForBranch(competitors = [], branchId = null) {
  return competitors.filter((c) => {
    if (c.is_active === false) return false;
    if (!branchId) return true;
    return c.branch_id == null || c.branch_id === branchId;
  });
}

/**
 * @param {Array<Record<string, unknown>>} competitors
 * @param {string} needle
 * @returns {Record<string, unknown>|null}
 */
export function findCompetitorByName(competitors = [], needle = "") {
  const key = normalizeCompetitorName(needle);
  if (!key) return null;
  return competitors.find((c) => normalizeCompetitorName(c.normalized_name || c.name) === key) || null;
}

/**
 * Dev/reference seed names for Khobar area (registry only — not reasoning constants).
 */
export const KHOBAR_COMPETITOR_SEED_NAMES = Object.freeze([
  "HOUSE OF AGAPI",
  "San Carlo Cicchetti",
  "Café Lilou",
  "Urth Caffé",
  "Patio Mall restaurants / concepts",
]);
