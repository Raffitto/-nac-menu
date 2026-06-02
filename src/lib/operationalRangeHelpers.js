/**
 * Operational Dashboard range semantics — month-to-date vs 7D (client-only, no DB).
 */

import { getRangeBounds } from "../dashboard/utils/rangeState";

const SEVEN_DAY_QR_CACHE_KEY = "nac_ops_seven_day_menu_qr";

/** True when the rolling 7D window starts on or after the 1st of the current calendar month. */
export function sevenDayWindowFullyInsideCalendarMonth(referenceDate = new Date()) {
  const monthStart = getRangeBounds("month", referenceDate).since.getTime();
  const sevenDStart = getRangeBounds("7d", referenceDate).since.getTime();
  return sevenDStart >= monthStart;
}

export const SEVEN_DAY_VS_MONTH_HELPER =
  "Month-to-date starts on the 1st of the current month. Early in the month, 7D may be higher because it includes the last days of the previous month.";

/** Customer-facing note when 7D and month-to-date are easy to compare side-by-side. */
export function operationalRangeContextNote(selectedRange, referenceDate = new Date()) {
  const id = String(selectedRange || "").toLowerCase();
  if (id === "7d" || id === "month") {
    if (id === "month" && sevenDayWindowFullyInsideCalendarMonth(referenceDate)) {
      return null;
    }
    return SEVEN_DAY_VS_MONTH_HELPER;
  }
  return null;
}

/** When the full 7D window sits inside the month, MTD menu QR should not trail 7D (uses cached 7D load). */
export function monthSevenDayIntegrityWarning({
  selectedRange,
  monthQr,
  sevenDayQr,
  referenceDate = new Date(),
} = {}) {
  if (String(selectedRange || "").toLowerCase() !== "month") return null;
  if (!sevenDayWindowFullyInsideCalendarMonth(referenceDate)) return null;
  const m = Number(monthQr) || 0;
  const s = Number(sevenDayQr) || 0;
  if (s > 0 && m > 0 && m < s * 0.98) {
    return "Month-to-date menu QR is lower than 7D even though the full 7-day window is inside this month — data may still be syncing.";
  }
  return null;
}

export function rememberSevenDayMenuQr(menuQr) {
  if (typeof window === "undefined") return;
  const n = Number(menuQr) || 0;
  if (n <= 0) return;
  try {
    window.sessionStorage.setItem(SEVEN_DAY_QR_CACHE_KEY, String(n));
  } catch {
    /* ignore quota */
  }
}

export function readCachedSevenDayMenuQr() {
  if (typeof window === "undefined") return 0;
  try {
    return Number(window.sessionStorage.getItem(SEVEN_DAY_QR_CACHE_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Session Quality subtitle — avoid implying live sample covers full rollup period.
 */
export function sessionQualityCaption({
  isPartial,
  classifiedCount,
  totalSessions,
  selectedRange,
  fromLivePatch = false,
} = {}) {
  const count = Number(classifiedCount) || 0;
  if (!isPartial || count <= 0) return null;

  const rangeId = String(selectedRange || "today").toLowerCase();
  const isRollup = rangeId === "7d" || rangeId === "month";
  const sessions = Number(totalSessions) || 0;
  const liveSample =
    fromLivePatch ||
    (isRollup && sessions > 0 && count < sessions * 0.5);

  if (liveSample) {
    return `Based on ${count.toLocaleString()} recent classified session${count === 1 ? "" : "s"} (live sample; not the full selected range).`;
  }

  return `Based on ${count.toLocaleString()} classified session${count === 1 ? "" : "s"}.`;
}
