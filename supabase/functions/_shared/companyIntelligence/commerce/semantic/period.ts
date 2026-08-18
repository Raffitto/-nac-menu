/**
 * Unified commerce period resolution.
 * Named calendar periods beat default rolling windows. Boundaries are inclusive.
 */

import {
  parseVaultComparePeriodsFromQuestion,
  parseVaultPeriodFromQuestion,
  buildPreviousEquivalentVaultPeriod,
} from "../../../vaultPeriodParser.ts";
import { defaultTemporalService } from "../../temporalService.ts";
import { ksaCalendarIso, latestCompletedBusinessDay } from "../../calendarCompletion.ts";
import type { DateRange } from "../../types.ts";

export type CommercePeriodResolution = {
  range: DateRange | null;
  compareRange: DateRange | null;
  precedence: "named" | "relative" | "event" | "inherited" | "default_window" | "unresolved";
  inclusive: true;
  reasons: string[];
};

export function asCalendarDate(value: unknown, timeZone = "Asia/Riyadh"): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  const ymd = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (ymd && !/[T ]\d{2}:/.test(raw)) return ymd[1];
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return ymd ? ymd[1] : null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return y && m && day ? `${y}-${m}-${day}` : ymd ? ymd[1] : null;
}

export function exclusiveEndToInclusive(endExclusive: string): string {
  const start = Date.parse(`${endExclusive}T12:00:00Z`);
  return new Date(start - 86400000).toISOString().slice(0, 10);
}

export function clampInclusiveCompleted(input: {
  startDate: string;
  endDate: string;
  coverageStart?: string | null;
  coverageEnd?: string | null;
  referenceDate?: Date;
}): { startDate: string; endDate: string; clampedStart: boolean; clampedEnd: boolean; excludedToday: boolean } {
  const today = ksaCalendarIso(input.referenceDate || new Date());
  const yesterday = latestCompletedBusinessDay(input.referenceDate || new Date());
  let start = asCalendarDate(input.startDate) || input.startDate;
  let end = asCalendarDate(input.endDate) || input.endDate;
  const covStart = asCalendarDate(input.coverageStart);
  const covEnd = asCalendarDate(input.coverageEnd);
  let clampedStart = false;
  let clampedEnd = false;
  let excludedToday = false;
  if (end >= today) {
    end = yesterday;
    excludedToday = true;
    clampedEnd = true;
  }
  if (covEnd && end > covEnd) {
    end = covEnd;
    clampedEnd = true;
  }
  if (covStart && start < covStart) {
    start = covStart;
    clampedStart = true;
  }
  if (start > end) {
    start = end;
    clampedStart = true;
  }
  return { startDate: start, endDate: end, clampedStart, clampedEnd, excludedToday };
}

function toRange(period: { startDate?: string; endDate?: string; label?: string | null; periodType?: string; semantic?: string | null } | null): DateRange | null {
  if (!period?.startDate || !period?.endDate) return null;
  return {
    startDate: asCalendarDate(period.startDate) || period.startDate,
    endDate: asCalendarDate(period.endDate) || period.endDate,
    label: period.label || null,
    semantic: period.periodType || period.semantic || null,
  };
}

export function resolveCommercePeriod(input: {
  question: string;
  referenceDate?: Date;
  inherited?: DateRange | null;
  inheritedCompare?: DateRange | null;
}): CommercePeriodResolution {
  const ref = input.referenceDate || new Date();
  const q = String(input.question || "").trim();
  const reasons: string[] = [];

  const temporal = defaultTemporalService.resolveFromQuestion(q, ref);
  const compare = parseVaultComparePeriodsFromQuestion(q, ref);
  const parsed = parseVaultPeriodFromQuestion(q, ref);

  if (compare?.current?.startDate && compare?.previous?.startDate) {
    return {
      range: toRange(compare.current),
      compareRange: toRange(compare.previous),
      precedence: "relative",
      inclusive: true,
      reasons: ["named_or_relative_compare"],
    };
  }

  const named = toRange(parsed) || temporal.range;
  const periodType = parsed?.periodType || temporal.expression;
  const isNamed = Boolean(
    parsed?.isMonth
    || parsed?.periodType === "named_month"
    || parsed?.periodType === "this_month"
    || parsed?.periodType === "last_week"
    || parsed?.periodType === "this_week"
    || parsed?.periodType === "last_weekend"
    || parsed?.periodType === "named_year"
    || parsed?.isSingleDay
    || temporal.holidayBundle
    || temporal.eventWindow,
  );
  if (named && isNamed) {
    reasons.push("named_period_precedes_default");
    return {
      range: named,
      compareRange: temporal.compareRange || toRange(buildPreviousEquivalentVaultPeriod(parsed) || null),
      precedence: temporal.holidayBundle ? "event" : "named",
      inclusive: true,
      reasons,
    };
  }
  if (named && periodType && periodType !== "last_7_days" && periodType !== "question") {
    return {
      range: named,
      compareRange: temporal.compareRange,
      precedence: "relative",
      inclusive: true,
      reasons: ["relative_period"],
    };
  }
  if (input.inherited?.startDate) {
    return {
      range: input.inherited,
      compareRange: input.inheritedCompare || null,
      precedence: "inherited",
      inclusive: true,
      reasons: ["inherited_conversation_period"],
    };
  }
  if (named) {
    return {
      range: named,
      compareRange: temporal.compareRange,
      precedence: named.semantic === "last_7_days" || periodType === "last_7_days" ? "default_window" : "relative",
      inclusive: true,
      reasons: ["parser_range"],
    };
  }
  return {
    range: null,
    compareRange: null,
    precedence: "unresolved",
    inclusive: true,
    reasons: ["no_period_detected"],
  };
}
