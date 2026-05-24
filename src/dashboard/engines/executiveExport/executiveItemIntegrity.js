/**
 * Executive export item integrity — exclude masked, corrupt, and zero-noise rows.
 */

import { FOODICS_CLASS } from "../../utils/foodicsClassifier";
import { isModifierOrAddonRow } from "../../../platform/engines/reportTruthEngine";

const PROMO = new Set(["promo_campaign", "promo"]);

const IGNORED_IMPORT_STATUS = new Set([
  "ignored",
  "ignored_selection",
  "ignored_free_modifier",
  "corrupt",
  "unmapped",
  "placeholder",
]);

const OPERATIONAL_NOISE_EXACT = new Set(
  [
    "ice",
    "lemon slice",
    "olive oil",
    "honey",
    "spicy mayo",
    "packaging",
    "bag",
    "utensil",
    "straw",
    "napkin",
    "water",
  ].map((s) => s.toLowerCase()),
);

export function normalizeExecutiveItemName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Masked / symbol-only / too-short names — never executive-safe. */
export function isSymbolOrMaskedItemName(name) {
  const raw = normalizeExecutiveItemName(name);
  if (!raw || raw.toLowerCase() === "unknown") return true;

  const letters = raw.replace(/[^\p{L}\p{N}]/gu, "");
  if (letters.length < 3) return true;

  const compact = raw.replace(/\s/g, "");
  if (/^[*#_=\-.]+$/.test(compact)) return true;
  if (compact.length >= 6 && /^(.)\1+$/.test(compact)) return true;

  const symbolChars = raw.length - letters.length;
  if (raw.length >= 8 && symbolChars / raw.length > 0.75) return true;

  return false;
}

function isOperationalNoiseName(name) {
  const n = normalizeExecutiveItemName(name).toLowerCase();
  return OPERATIONAL_NOISE_EXACT.has(n);
}

function isOperationalClass(row) {
  const cls = String(row.foodics_class || row.semantic_class || "").toLowerCase();
  return cls === FOODICS_CLASS.OPERATIONAL || cls === "operational";
}

/** Raw waiter-import line eligible for executive rollups. */
export function isExecutiveEligibleImportLine(row = {}) {
  const net = Number(row.net_sales);
  const qty = Number(row.quantity_sold);
  if (!Number.isFinite(net) || net <= 0) return false;
  if (!Number.isFinite(qty) || qty <= 0) return false;

  const name = row.matched_menu_item_name || row.raw_item_name || row.item_name;
  if (isSymbolOrMaskedItemName(name)) return false;

  const status = String(row.import_status || "").toLowerCase();
  if (IGNORED_IMPORT_STATUS.has(status) && !row.matched_menu_item_name) return false;
  if (isOperationalClass(row)) return false;

  if (isOperationalNoiseName(name) && !row.matched_menu_item_name) return false;

  return true;
}

/** Aggregated item row eligible for Top / Least / summaries. */
export function isExecutiveEligibleAggregatedItem(row = {}) {
  const net = Number(row.net_sales) || 0;
  const qty = Number(row.quantity) || 0;
  if (net <= 0 || qty <= 0) return false;

  if (isSymbolOrMaskedItemName(row.item_name)) return false;

  const status = String(row.import_status || "").toLowerCase();
  if (IGNORED_IMPORT_STATUS.has(status) && !row.matched_menu_item_name) return false;
  if (isOperationalClass(row)) return false;

  if (isOperationalNoiseName(row.item_name) && !row.matched_menu_item_name) {
    return false;
  }

  return true;
}

export function filterExecutiveImportLines(rows = []) {
  return (rows || []).filter(isExecutiveEligibleImportLine);
}

export function filterExecutiveAggregatedItems(rows = []) {
  return (rows || []).filter(isExecutiveEligibleAggregatedItem);
}

/** Least-10: paid sellable items with operational meaning. */
export function isExecutiveLeastItemCandidate(row = {}) {
  if (!isExecutiveEligibleAggregatedItem(row)) return false;

  const cls = String(row.foodics_class || "").toLowerCase();
  if (PROMO.has(cls)) return false;

  const mapped = Boolean(row.matched_menu_item_name);
  if (mapped) return true;

  if (isModifierOrAddonRow(row) && Number(row.net_sales) > 0) return true;

  if (["menu_item", "drink", "addon"].includes(cls)) return true;
  if (row.import_status === "matched" || row.import_status === "paid_modifier") return true;

  return false;
}
