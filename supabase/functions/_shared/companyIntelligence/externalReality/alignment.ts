import { enumerateInclusiveDates, isKsaWeekend } from "../businessCalendar.ts";
import type { DateRange, IsoDate } from "../types.ts";

/** Compare the same aligned calendar dates, not a longer baseline month. */
export function alignedComparisonWindow(current: DateRange, comparison: DateRange): {
  currentDates: IsoDate[];
  comparisonDates: IsoDate[];
  current: DateRange;
  comparison: DateRange;
} {
  const currentDates = enumerateInclusiveDates(current.startDate, current.endDate);
  const comparisonDates = enumerateInclusiveDates(comparison.startDate, comparison.endDate);
  const n = Math.min(currentDates.length, comparisonDates.length);
  const cur = currentDates.slice(currentDates.length - n);
  const prev = comparisonDates.slice(comparisonDates.length - n);
  return {
    currentDates: cur,
    comparisonDates: prev,
    current: {
      ...current,
      startDate: cur[0],
      endDate: cur[cur.length - 1],
      semantic: current.semantic || "aligned_current",
    },
    comparison: {
      ...comparison,
      startDate: prev[0],
      endDate: prev[prev.length - 1],
      semantic: comparison.semantic || "aligned_comparison",
    },
  };
}

export function weekendDates(dates: IsoDate[]): IsoDate[] {
  return dates.filter((d) => isKsaWeekend(d));
}

export function overlapRatio(windowStart: IsoDate, windowEnd: IsoDate, eventStart: IsoDate, eventEnd: IsoDate): number {
  const a = enumerateInclusiveDates(windowStart, windowEnd);
  if (!a.length) return 0;
  const hit = a.filter((d) => d >= eventStart && d <= eventEnd).length;
  return hit / a.length;
}
