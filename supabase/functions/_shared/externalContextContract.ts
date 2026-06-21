/**
 * External context contracts (Edge mirror).
 */

import { NIL_DOMAINS } from "./nil/nilContract.ts";

export const EXTERNAL_SIGNAL_TYPES = Object.freeze({
  WEATHER: "weather",
  COMPETITOR: "competitor",
  MALL_EVENT: "mall_event",
  PUBLIC_HOLIDAY: "public_holiday",
  SCHOOL_CALENDAR: "school_calendar",
  LOCAL_EVENT: "local_event",
  TRAFFIC: "traffic",
  ROAD_CLOSURE: "road_closure",
  NEWS: "news",
  TOURISM: "tourism",
  MACRO: "macro",
  MANUAL_OBSERVATION: "manual_observation",
});

export const EXTERNAL_CONFIDENCE_LEVELS = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});

export const SIGNAL_TYPE_TO_NIL_DOMAIN: Record<string, string> = Object.freeze({
  [EXTERNAL_SIGNAL_TYPES.WEATHER]: NIL_DOMAINS.WEATHER,
  [EXTERNAL_SIGNAL_TYPES.COMPETITOR]: NIL_DOMAINS.COMPETITIVE,
  [EXTERNAL_SIGNAL_TYPES.MALL_EVENT]: NIL_DOMAINS.LOCATION,
  [EXTERNAL_SIGNAL_TYPES.PUBLIC_HOLIDAY]: NIL_DOMAINS.CALENDAR,
  [EXTERNAL_SIGNAL_TYPES.SCHOOL_CALENDAR]: NIL_DOMAINS.CALENDAR,
  [EXTERNAL_SIGNAL_TYPES.LOCAL_EVENT]: NIL_DOMAINS.LOCATION,
  [EXTERNAL_SIGNAL_TYPES.TRAFFIC]: NIL_DOMAINS.LOCATION,
  [EXTERNAL_SIGNAL_TYPES.ROAD_CLOSURE]: NIL_DOMAINS.LOCATION,
  [EXTERNAL_SIGNAL_TYPES.NEWS]: NIL_DOMAINS.MACROECONOMIC,
  [EXTERNAL_SIGNAL_TYPES.TOURISM]: NIL_DOMAINS.MACROECONOMIC,
  [EXTERNAL_SIGNAL_TYPES.MACRO]: NIL_DOMAINS.MACROECONOMIC,
  [EXTERNAL_SIGNAL_TYPES.MANUAL_OBSERVATION]: NIL_DOMAINS.COMPETITIVE,
});

export const EXTERNAL_CONTEXT_UNAVAILABLE_NOTE =
  "No external context sources are connected yet.";

export function mapSignalTypeToNilDomain(signalType: string) {
  return SIGNAL_TYPE_TO_NIL_DOMAIN[signalType] || null;
}

export function scoreSignalPeriodOverlap(
  signal: { start_at?: string; end_at?: string; signal_date?: string } = {},
  period: { startDate?: string; endDate?: string } = {},
) {
  const start = signal.start_at || signal.signal_date;
  const end = signal.end_at || signal.signal_date;
  const pStart = period.startDate;
  const pEnd = period.endDate;
  if (!start || !pStart || !pEnd) return "low";
  const s = new Date(start).getTime();
  const e = new Date(end || start).getTime();
  const ps = new Date(pStart).getTime();
  const pe = new Date(pEnd).getTime();
  if (Number.isNaN(s) || Number.isNaN(ps) || Number.isNaN(pe)) return "low";
  if (s <= pe && e >= ps) return "high";
  const dayMs = 86400000;
  if (Math.abs(s - ps) <= dayMs * 2 || Math.abs(e - pe) <= dayMs * 2) return "medium";
  return "none";
}
