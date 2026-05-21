/**
 * Luxury executive export palette — PDF + snapshot PNG.
 * Warm off-white hierarchy; avoids washed-out gray on dark surfaces.
 */

import { COLOR_PERFORMANCE, COLOR_BENCHMARK, COLOR_RISK } from "../config/executiveVisualLanguage";

export const EXPORT_PRIMARY = [245, 241, 232];
export const EXPORT_SECONDARY = [235, 230, 218];
export const EXPORT_MUTED = [176, 171, 162];
export const EXPORT_TEAL = COLOR_PERFORMANCE;
export const EXPORT_GOLD = COLOR_BENCHMARK;
export const EXPORT_RISK = COLOR_RISK;

export const TABLE_HEAD_BG = [36, 40, 48];
export const TABLE_ROW_A = [14, 16, 20];
export const TABLE_ROW_B = [22, 25, 30];
export const CONTENT_PANEL_BG = [14, 15, 17];

/** Conversion % accent: ≥70 teal, 40–70 gold, <40 soft red */
export function convPctAccent(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return EXPORT_MUTED;
  if (n >= 70) return EXPORT_TEAL;
  if (n >= 40) return EXPORT_GOLD;
  return EXPORT_RISK;
}

export function parsePctValue(val) {
  const n = Number(String(val ?? "").replace("%", "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** Executive delta with arrow and semantic color */
export function formatMomentumDelta(n, suffix = "") {
  if (n == null || !Number.isFinite(Number(n))) {
    return { text: "—", accent: EXPORT_MUTED };
  }
  const num = Number(n);
  const arrow = num > 0 ? "↑" : num < 0 ? "↓" : "→";
  const sign = num > 0 ? "+" : "";
  const label = suffix ? ` ${suffix}` : "";
  const text = `${sign}${num}${label} ${arrow}`.trim();
  const accent = num > 0 ? EXPORT_TEAL : num < 0 ? EXPORT_RISK : EXPORT_MUTED;
  return { text, accent };
}
