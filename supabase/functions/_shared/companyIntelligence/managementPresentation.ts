/**
 * Manager-facing numeric and magnitude language — formatting only.
 * Does not change stored facts.
 */

export const MAGNITUDE_FLAT_PCT = 2;
export const MAGNITUDE_SLIGHT_PCT = 5;
export const MAGNITUDE_MODERATE_PCT = 12;
export const MAGNITUDE_MATERIAL_PCT = 25;

export type MagnitudeBand = "flat" | "slight" | "moderate" | "material" | "sharp";

export function classifyMagnitude(percentChange: number | null | undefined): MagnitudeBand | null {
  if (percentChange == null || !Number.isFinite(Number(percentChange))) return null;
  const mag = Math.abs(Number(percentChange));
  if (mag < MAGNITUDE_FLAT_PCT) return "flat";
  if (mag < MAGNITUDE_SLIGHT_PCT) return "slight";
  if (mag < MAGNITUDE_MODERATE_PCT) return "moderate";
  if (mag < MAGNITUDE_MATERIAL_PCT) return "material";
  return "sharp";
}

export function isEffectivelyFlat(percentChange: number | null | undefined): boolean {
  return classifyMagnitude(percentChange) === "flat";
}

/** Signed percent using the same policy as Cash Up comparison (delta / previous). */
export function percentDelta(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null) return null;
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
  return ((c - p) / p) * 100;
}

export function formatPercent(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const abs = Math.abs(Number(value));
  const shown = abs < 0.05
    ? "0.0"
    : (Math.abs(abs - Math.round(abs)) < 0.05 && abs >= 10 ? String(Math.round(abs)) : abs.toFixed(1));
  return `${shown}%`;
}

export function formatSignedPercent(value: number | null | undefined): string | null {
  const formatted = formatPercent(value);
  if (!formatted || value == null) return null;
  if (Math.abs(Number(value)) < MAGNITUDE_FLAT_PCT) return formatted;
  return formatted;
}

export function formatMoney(value: number | null | undefined, _opts: { exact?: boolean } = {}): string {
  if (value == null || !Number.isFinite(Number(value))) return "SAR —";
  const n = Number(value);
  const keepCents = Math.abs(n - Math.round(n)) >= 0.005;
  if (keepCents) {
    return `SAR ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `SAR ${Math.round(n).toLocaleString("en-US")}`;
}

export function formatCount(value: number | null | undefined, unit: string): string {
  if (value == null || !Number.isFinite(Number(value))) return `— ${unit}`;
  const n = Number(value);
  const shown = Math.abs(n - Math.round(n)) < 0.05
    ? Math.round(n).toLocaleString("en-US")
    : n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return `${shown} ${unit}`;
}

export function magnitudePhrase(percentChange: number | null | undefined): string | null {
  const band = classifyMagnitude(percentChange);
  if (band == null || percentChange == null) return null;
  if (band === "flat") return "effectively unchanged";
  const up = percentChange >= 0;
  if (band === "slight") return up ? "slightly higher" : "slightly lower";
  if (band === "moderate") return up ? "moderately higher" : "moderately lower";
  if (band === "material") return up ? "materially higher" : "materially lower";
  return up ? "sharply higher" : "sharply lower";
}

export function directionWord(percentChange: number | null | undefined): "up" | "down" | "flat" {
  if (percentChange == null || isEffectivelyFlat(percentChange)) return "flat";
  return Number(percentChange) > 0 ? "up" : "down";
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function parseIsoUtc(iso: string): Date | null {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function addIsoDays(iso: string, days: number): string {
  const dt = parseIsoUtc(iso);
  if (!dt) return iso;
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function maxIsoDate(a: string, b: string): string {
  return a >= b ? a : b;
}

export function isoWeekdayIndex(iso: string): number | null {
  const dt = parseIsoUtc(iso);
  return dt ? dt.getUTCDay() : null;
}

export function isoWeekdayName(iso: string): string {
  const idx = isoWeekdayIndex(iso);
  return idx == null ? "" : WEEKDAYS[idx];
}

export function isKsaWeekendIso(iso: string): boolean {
  const idx = isoWeekdayIndex(iso);
  return idx === 5 || idx === 6;
}

/** Manager-facing date: Friday, 1 August */
export function formatManagerDate(iso: string | null | undefined): string {
  if (!iso) return "the requested day";
  const dt = parseIsoUtc(iso);
  if (!dt) return iso;
  const weekday = WEEKDAYS[dt.getUTCDay()];
  const day = dt.getUTCDate();
  const month = MONTHS[dt.getUTCMonth()];
  return `${weekday}, ${day} ${month}`;
}

export function formatManagerPeriod(period: {
  startDate?: string | null;
  endDate?: string | null;
  label?: string | null;
} | null | undefined): string {
  if (!period) return "the requested period";
  const start = period.startDate || null;
  const end = period.endDate || null;
  if (start && end && start === end) return formatManagerDate(start);
  if (start && end) {
    const a = parseIsoUtc(start);
    const b = parseIsoUtc(end);
    if (a && b) {
      const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
      if (sameMonth) {
        const last = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 0)).getUTCDate();
        if (a.getUTCDate() === 1 && b.getUTCDate() === last) {
          return `${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
        }
        return `${a.getUTCDate()}–${b.getUTCDate()} ${MONTHS[a.getUTCMonth()]}`;
      }
      return `${formatManagerDate(start)} – ${formatManagerDate(end)}`;
    }
  }
  const label = String(period.label || "").trim();
  const iso = label.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return formatManagerDate(iso[1]);
  if (label && !/\d{4}-\d{2}-\d{2}/.test(label)) return label;
  return label || "the requested period";
}

export function metricCopula(label: string): "was" | "were" {
  const l = String(label || "").toLowerCase();
  if (/\b(spend|average check|aov)\b/.test(l)) return "was";
  return "were";
}
