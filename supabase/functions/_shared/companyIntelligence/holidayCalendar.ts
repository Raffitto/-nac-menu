/**
 * Deterministic public-holiday / named-event registry for Company Intelligence.
 * Dates are never invented by the LLM — resolve here or return unresolved.
 */

import {
  addUtcDays,
  enumerateInclusiveDates,
  weekdayComposition,
  type WeekdayComposition,
} from "./businessCalendar.ts";
import type { DateRange, IsoDate } from "./types.ts";

export type HolidayId = "saudi_founding_day";

export type EventWindowConventionId = "day_before_anchor_day_after";

export type HolidayDefinition = {
  id: HolidayId;
  name: string;
  aliases: string[];
  /** Fixed Gregorian month/day (1-based). */
  gregorianMonth: number;
  gregorianDay: number;
  calendarSystem: "gregorian";
  source: string;
};

export type ResolvedHolidayOccurrence = {
  holidayId: HolidayId;
  year: number;
  anchorDate: IsoDate;
  label: string;
};

export type ResolvedEventWindow = {
  holidayId: HolidayId;
  convention: EventWindowConventionId;
  conventionLabel: string;
  anchorDate: IsoDate;
  range: DateRange;
  dates: IsoDate[];
  weekdayComposition: WeekdayComposition;
  year: number;
};

export type HolidayQuestionIntent = {
  detected: boolean;
  holidayId: HolidayId | null;
  wantsHistoricalPerformance: boolean;
  wantsForecast: boolean;
  wantsNextDate: boolean;
  wantsThreeDayWindow: boolean;
  explicitYear: number | null;
};

export const EVENT_WINDOW_CONVENTIONS: Record<EventWindowConventionId, {
  id: EventWindowConventionId;
  label: string;
  description: string;
  offsetStart: number;
  offsetEnd: number;
}> = Object.freeze({
  day_before_anchor_day_after: {
    id: "day_before_anchor_day_after",
    label: "three_day_inclusive_adjacent",
    description: "Day before + holiday + day after",
    offsetStart: -1,
    offsetEnd: 1,
  },
});

/** Trusted fixed Gregorian holidays relevant to NAC KSA operations. */
export const HOLIDAY_REGISTRY: Record<HolidayId, HolidayDefinition> = Object.freeze({
  saudi_founding_day: {
    id: "saudi_founding_day",
    name: "Saudi Founding Day",
    aliases: [
      "founding day",
      "saudi founding day",
      "foundation day",
      "saudi foundation day",
      "yawm al-ta'sis",
      "يوم التأسيس",
    ],
    gregorianMonth: 2,
    gregorianDay: 22,
    calendarSystem: "gregorian",
    source: "trusted_ksa_holiday_registry",
  },
});

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function foundingDayDateForYear(year: number): IsoDate {
  const def = HOLIDAY_REGISTRY.saudi_founding_day;
  return `${year}-${pad2(def.gregorianMonth)}-${pad2(def.gregorianDay)}` as IsoDate;
}

export function resolveHolidayOccurrence(
  holidayId: HolidayId,
  year: number,
): ResolvedHolidayOccurrence | null {
  const def = HOLIDAY_REGISTRY[holidayId];
  if (!def) return null;
  if (!Number.isFinite(year) || year < 1900 || year > 2100) return null;
  const anchorDate = `${year}-${pad2(def.gregorianMonth)}-${pad2(def.gregorianDay)}` as IsoDate;
  return {
    holidayId,
    year,
    anchorDate,
    label: `${def.name} ${year}`,
  };
}

export function resolveEventWindow(input: {
  holidayId: HolidayId;
  year: number;
  convention?: EventWindowConventionId;
}): ResolvedEventWindow | null {
  const occurrence = resolveHolidayOccurrence(input.holidayId, input.year);
  if (!occurrence) return null;
  const conventionId = input.convention || "day_before_anchor_day_after";
  const convention = EVENT_WINDOW_CONVENTIONS[conventionId];
  const startDate = addUtcDays(occurrence.anchorDate, convention.offsetStart);
  const endDate = addUtcDays(occurrence.anchorDate, convention.offsetEnd);
  const dates = enumerateInclusiveDates(startDate, endDate);
  const range: DateRange = {
    startDate,
    endDate,
    label: `${occurrence.label} (${convention.label})`,
    semantic: `${input.holidayId}_window_${occurrence.year}`,
  };
  return {
    holidayId: input.holidayId,
    convention: conventionId,
    conventionLabel: convention.description,
    anchorDate: occurrence.anchorDate,
    range,
    dates,
    weekdayComposition: weekdayComposition(dates),
    year: occurrence.year,
  };
}

/** Most recent holiday occurrence on or before referenceDate. */
export function resolveRelevantHistoricalHoliday(
  holidayId: HolidayId,
  referenceDate: Date | IsoDate,
): ResolvedHolidayOccurrence | null {
  const iso = typeof referenceDate === "string"
    ? referenceDate
    : referenceDate.toISOString().slice(0, 10);
  const year = Number(String(iso).slice(0, 4));
  const candidate = resolveHolidayOccurrence(holidayId, year);
  if (!candidate) return null;
  if (candidate.anchorDate <= iso) return candidate;
  return resolveHolidayOccurrence(holidayId, year - 1);
}

/** Next holiday occurrence strictly after referenceDate. */
export function resolveNextHoliday(
  holidayId: HolidayId,
  referenceDate: Date | IsoDate,
): ResolvedHolidayOccurrence | null {
  const iso = typeof referenceDate === "string"
    ? referenceDate
    : referenceDate.toISOString().slice(0, 10);
  const year = Number(String(iso).slice(0, 4));
  const thisYear = resolveHolidayOccurrence(holidayId, year);
  if (thisYear && thisYear.anchorDate > iso) return thisYear;
  return resolveHolidayOccurrence(holidayId, year + 1);
}

export function detectHolidayQuestionIntent(question: string): HolidayQuestionIntent {
  const q = String(question || "").toLowerCase();
  const founding = /\b(founding day|foundation day|saudi founding|saudi foundation)\b/.test(q)
    || q.includes("يوم التأسيس");
  if (!founding) {
    return {
      detected: false,
      holidayId: null,
      wantsHistoricalPerformance: false,
      wantsForecast: false,
      wantsNextDate: false,
      wantsThreeDayWindow: false,
      explicitYear: null,
    };
  }

  const yearMatch = q.match(/\b(20\d{2})\b/);
  const explicitYear = yearMatch ? Number(yearMatch[1]) : null;
  const wantsThreeDayWindow = /\b(three[- ]day|3[- ]day|around|over the|period|window|days that include|inclusive)\b/.test(q)
    || /\b(day before|day after)\b/.test(q)
    || /\bhow (did|were|was)\b/.test(q)
    || /\bsales\b/.test(q)
    || /\bmake\b/.test(q)
    || /\bperform/.test(q);

  const wantsForecast = /\b(expect|expectation|expectations|forecast|should (we|sales)|look like|next year|for next)\b/.test(q);
  const wantsNextDate = /\b(when is|next founding|next foundation|upcoming)\b/.test(q) || wantsForecast;
  const wantsHistoricalPerformance = wantsThreeDayWindow
    || /\b(how did|how were|how was|made|sales|perform|compare this)\b/.test(q)
    || Boolean(explicitYear && !wantsForecast);

  return {
    detected: true,
    holidayId: "saudi_founding_day",
    wantsHistoricalPerformance: wantsHistoricalPerformance || (!wantsForecast && !wantsNextDate),
    wantsForecast,
    wantsNextDate: wantsNextDate || wantsForecast,
    wantsThreeDayWindow: wantsThreeDayWindow || wantsHistoricalPerformance || wantsForecast,
    explicitYear,
  };
}

export type HolidayTemporalBundle = {
  intent: HolidayQuestionIntent;
  historicalWindow: ResolvedEventWindow | null;
  nextOccurrence: ResolvedHolidayOccurrence | null;
  nextWindow: ResolvedEventWindow | null;
  historicalRange: DateRange | null;
  forecastRange: DateRange | null;
  expression: string;
  reasons: string[];
};

export function resolveHolidayTemporalBundle(
  question: string,
  referenceDate: Date = new Date(),
): HolidayTemporalBundle | null {
  const intent = detectHolidayQuestionIntent(question);
  if (!intent.detected || !intent.holidayId) return null;

  const reasons: string[] = ["trusted_ksa_holiday_registry", "event_window_day_before_anchor_day_after"];
  let historicalYear: number | null = intent.explicitYear;
  if (historicalYear == null) {
    const hist = resolveRelevantHistoricalHoliday(intent.holidayId, referenceDate);
    historicalYear = hist?.year ?? null;
  }

  const historicalWindow = historicalYear != null
    ? resolveEventWindow({ holidayId: intent.holidayId, year: historicalYear })
    : null;

  const nextOccurrence = resolveNextHoliday(intent.holidayId, referenceDate);
  const nextWindow = nextOccurrence
    ? resolveEventWindow({ holidayId: intent.holidayId, year: nextOccurrence.year })
    : null;

  // If explicit year is in the future relative to ref, treat it as forecast target.
  const refIso = referenceDate.toISOString().slice(0, 10);
  if (
    intent.explicitYear
    && historicalWindow
    && historicalWindow.anchorDate > refIso
    && !intent.wantsHistoricalPerformance
  ) {
    reasons.push("explicit_year_is_future_occurrence");
  }

  return {
    intent,
    historicalWindow,
    nextOccurrence,
    nextWindow,
    historicalRange: historicalWindow?.range || null,
    forecastRange: nextWindow?.range || null,
    expression: intent.wantsThreeDayWindow
      ? `${intent.holidayId}_three_day_window`
      : intent.holidayId,
    reasons,
  };
}
