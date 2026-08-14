/**
 * Temporal intelligence service — LLM may understand "Ramadan last year";
 * deterministic adapters return exact dates (or unresolved).
 */

import {
  parseVaultComparePeriodsFromQuestion,
  parseVaultPeriodFromQuestion,
} from "../vaultPeriodParser.ts";
import {
  resolveHolidayTemporalBundle,
  type HolidayTemporalBundle,
} from "./holidayCalendar.ts";
import type { DateRange, IsoDate } from "./types.ts";

export type TemporalResolutionStatus = "resolved" | "partial" | "unresolved";

export type TemporalResolution = {
  status: TemporalResolutionStatus;
  expression: string;
  range: DateRange | null;
  compareRange: DateRange | null;
  forecastRange?: DateRange | null;
  nextHolidayDate?: IsoDate | null;
  eventWindow?: {
    holidayId: string;
    convention: string;
    conventionLabel: string;
    anchorDate: IsoDate;
    year: number;
    weekdaySignature: string;
  } | null;
  holidayBundle?: HolidayTemporalBundle | null;
  calendarSystem: "gregorian" | "hijri" | "business" | "mixed";
  capability: string;
  reasons: string[];
};

export interface TemporalIntelligenceService {
  resolveExpression(expression: string, referenceDate?: Date): TemporalResolution;
  resolveFromQuestion(question: string, referenceDate?: Date): TemporalResolution;
}

/**
 * Seeded Islamic/Gregorian periods for known years only.
 * Not a full Hijri engine — unresolved outside this table.
 */
export const SEEDED_NAMED_PERIODS: Record<string, DateRange> = Object.freeze({
  "ramadan:2025": {
    startDate: "2025-03-01",
    endDate: "2025-03-29",
    label: "Ramadan 2025",
    semantic: "ramadan_2025",
  },
  "ramadan:2026": {
    startDate: "2026-02-18",
    endDate: "2026-03-19",
    label: "Ramadan 2026",
    semantic: "ramadan_2026",
  },
  "eid_al_fitr:2025": {
    startDate: "2025-03-30",
    endDate: "2025-04-01",
    label: "Eid al-Fitr 2025",
    semantic: "eid_al_fitr_2025",
  },
  "eid_al_fitr:2026": {
    startDate: "2026-03-20",
    endDate: "2026-03-22",
    label: "Eid al-Fitr 2026",
    semantic: "eid_al_fitr_2026",
  },
});

function toRange(period: { startDate?: string; endDate?: string; label?: string; periodType?: string } | null): DateRange | null {
  if (!period?.startDate || !period?.endDate) return null;
  return {
    startDate: period.startDate as IsoDate,
    endDate: period.endDate as IsoDate,
    label: period.label || null,
    semantic: period.periodType || null,
  };
}

function resolveRamadanCompare(question: string, referenceDate: Date): TemporalResolution | null {
  const q = question.toLowerCase();
  if (!/\bramadan\b/.test(q)) return null;

  const year = referenceDate.getFullYear();
  const wantsYoY = /\b(last year|previous year|vs|versus|compare|compared|this year|year before)\b/.test(q);
  if (!wantsYoY && !/\bramadan\b/.test(q)) return null;

  const thisYear = year;
  const lastYear = year - 1;
  const current = SEEDED_NAMED_PERIODS[`ramadan:${thisYear}`] || null;
  const previous = SEEDED_NAMED_PERIODS[`ramadan:${lastYear}`] || null;

  if (!current || !previous) {
    return {
      status: "unresolved",
      expression: "ramadan_yoy",
      range: current,
      compareRange: previous,
      calendarSystem: "hijri",
      capability: "calendar.resolve_period",
      reasons: ["hijri_calendar_dataset_incomplete"],
    };
  }

  return {
    status: "resolved",
    expression: "ramadan_yoy",
    range: current,
    compareRange: previous,
    calendarSystem: "hijri",
    capability: "calendar.resolve_period",
    reasons: ["seeded_islamic_calendar"],
  };
}

function holidayBundleToResolution(bundle: HolidayTemporalBundle): TemporalResolution {
  const hist = bundle.historicalWindow;
  return {
    status: hist || bundle.nextOccurrence ? "resolved" : "unresolved",
    expression: bundle.expression,
    range: bundle.intent.wantsHistoricalPerformance ? bundle.historicalRange : bundle.historicalRange,
    compareRange: null,
    forecastRange: bundle.forecastRange,
    nextHolidayDate: bundle.nextOccurrence?.anchorDate || null,
    eventWindow: hist
      ? {
        holidayId: hist.holidayId,
        convention: hist.convention,
        conventionLabel: hist.conventionLabel,
        anchorDate: hist.anchorDate,
        year: hist.year,
        weekdaySignature: hist.weekdayComposition.signature,
      }
      : null,
    holidayBundle: bundle,
    calendarSystem: "gregorian",
    capability: "calendar.resolve_period",
    reasons: bundle.reasons,
  };
}

export function createTemporalIntelligenceService(): TemporalIntelligenceService {
  return {
    resolveExpression(expression, referenceDate = new Date()) {
      const expr = String(expression || "").trim().toLowerCase();
      if (!expr) {
        return {
          status: "unresolved",
          expression: expr,
          range: null,
          compareRange: null,
          calendarSystem: "gregorian",
          capability: "calendar.resolve_period",
          reasons: ["empty_expression"],
        };
      }

      const foundingYear = expr.match(/^(?:saudi[_ ]?)?founding[_ ]?day[:\s-]?(\d{4})$/);
      if (foundingYear || expr === "founding_day" || expr === "saudi_founding_day") {
        const year = foundingYear
          ? Number(foundingYear[1])
          : resolveHolidayTemporalBundle("Founding Day", referenceDate)?.historicalWindow?.year;
        const q = year ? `Saudi Founding Day ${year}` : "Saudi Founding Day three-day period";
        const bundle = resolveHolidayTemporalBundle(q, referenceDate);
        if (bundle) return holidayBundleToResolution(bundle);
      }

      const ramadanKey = expr.match(/^ramadan[:\s-]?(\d{4})$/);
      if (ramadanKey) {
        const range = SEEDED_NAMED_PERIODS[`ramadan:${ramadanKey[1]}`] || null;
        return {
          status: range ? "resolved" : "unresolved",
          expression: expr,
          range,
          compareRange: null,
          calendarSystem: "hijri",
          capability: "calendar.resolve_period",
          reasons: range ? ["seeded_islamic_calendar"] : ["hijri_calendar_dataset_incomplete"],
        };
      }

      if (expr === "ramadan_yoy" || expr === "ramadan last year vs this year") {
        return resolveRamadanCompare("compare last year's ramadan with this year's ramadan", referenceDate)
          || {
            status: "unresolved",
            expression: expr,
            range: null,
            compareRange: null,
            calendarSystem: "hijri",
            capability: "calendar.resolve_period",
            reasons: ["hijri_calendar_dataset_incomplete"],
          };
      }

      const parsed = parseVaultPeriodFromQuestion(expr.replace(/_/g, " "), referenceDate);
      const range = toRange(parsed);
      return {
        status: range ? "resolved" : "unresolved",
        expression: expr,
        range,
        compareRange: null,
        calendarSystem: "gregorian",
        capability: "calendar.resolve_period",
        reasons: range ? ["vault_period_parser"] : ["unsupported_temporal_expression"],
      };
    },

    resolveFromQuestion(question, referenceDate = new Date()) {
      const holiday = resolveHolidayTemporalBundle(question, referenceDate);
      if (holiday) return holidayBundleToResolution(holiday);

      const ramadan = resolveRamadanCompare(question, referenceDate);
      if (ramadan) return ramadan;

      const q = String(question || "").toLowerCase();
      if (/\b(lately|recently|these days|last few days)\b/.test(q)) {
        const cmp = parseVaultComparePeriodsFromQuestion(
          "last 14 days vs previous 14 days",
          referenceDate,
        );
        const range = toRange(cmp?.current || parseVaultPeriodFromQuestion("last 14 days", referenceDate));
        if (range) {
          return {
            status: "resolved",
            expression: "last_14_days",
            range,
            compareRange: toRange(cmp?.previous || null),
            calendarSystem: "gregorian",
            capability: "calendar.resolve_period",
            reasons: ["semantic_recent_default"],
          };
        }
      }

      const compare = parseVaultComparePeriodsFromQuestion(question, referenceDate);
      if (compare?.current?.startDate && compare?.previous?.startDate) {
        return {
          status: "resolved",
          expression: "question_compare",
          range: toRange(compare.current),
          compareRange: toRange(compare.previous),
          calendarSystem: "gregorian",
          capability: "calendar.resolve_period",
          reasons: ["vault_compare_parser"],
        };
      }

      const period = parseVaultPeriodFromQuestion(question, referenceDate);
      const range = toRange(period);
      return {
        status: range ? "resolved" : "unresolved",
        expression: "question",
        range,
        compareRange: null,
        calendarSystem: "gregorian",
        capability: "calendar.resolve_period",
        reasons: range ? ["vault_period_parser"] : ["no_period_detected"],
      };
    },
  };
}

export const defaultTemporalService = createTemporalIntelligenceService();
